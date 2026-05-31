#!/usr/bin/env python3
"""
Export the upstream World Cup predictor data into this static app format.

The GitHub Pages app must stay static, so upstream network sources are resolved
at sync time instead of from the browser. By default this script downloads the
latest upstream release source archive, runs its existing Python analysis, and
writes data/worldcup_2026.json.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REPO = "mikobinbin/2026-world-cup-predictor"
SOURCE_REPO = f"https://github.com/{REPO}"
DEFAULT_OUTPUT = Path("data/worldcup_2026.json")


def request_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "ticai-worldcup-sync",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def latest_release() -> dict:
    return request_json(f"https://api.github.com/repos/{REPO}/releases/latest")


def tag_commit(tag: str) -> str:
    try:
        result = subprocess.run(
            ["git", "ls-remote", "--tags", "--refs", SOURCE_REPO, f"refs/tags/{tag}"],
            check=True,
            text=True,
            capture_output=True,
        )
        first = result.stdout.strip().splitlines()[0]
        return first.split("\t", 1)[0][:7]
    except Exception:
        ref = request_json(f"https://api.github.com/repos/{REPO}/git/ref/tags/{tag}")
        return ref.get("object", {}).get("sha", "")[:7] or "--"


def download_archive(url: str, target: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "ticai-worldcup-sync"})
    with urllib.request.urlopen(req, timeout=120) as res, target.open("wb") as fh:
        shutil.copyfileobj(res, fh)


def extract_archive(archive: Path, target_dir: Path) -> Path:
    with tarfile.open(archive, "r:gz") as tar:
        def is_safe(member: tarfile.TarInfo) -> bool:
            member_path = (target_dir / member.name).resolve()
            return str(member_path).startswith(str(target_dir.resolve()))

        members = tar.getmembers()
        if not all(is_safe(member) for member in members):
            raise RuntimeError("Upstream archive contains unsafe paths")
        tar.extractall(target_dir, members=members)

    roots = [item for item in target_dir.iterdir() if item.is_dir()]
    if not roots:
        raise RuntimeError("Upstream archive did not contain a source directory")
    return roots[0]


def read_upstream_fetch_date(source_dir: Path) -> str:
    data_path = source_dir / "data" / "wc2026_players_processed.json"
    try:
        payload = json.loads(data_path.read_text(encoding="utf-8"))
        return payload.get("metadata", {}).get("fetch_date", "")
    except Exception:
        return ""


def export_upstream_payload(source_dir: Path, python_bin: str) -> dict:
    output_path = Path(tempfile.mkstemp(prefix="worldcup-export-", suffix=".json")[1])
    helper = (
        "import json, sys\n"
        "from pathlib import Path\n"
        "sys.path.insert(0, str(Path.cwd()))\n"
        "from src.dashboard.mobile_ui import _load_analysis\n"
        "teams, ucl = _load_analysis()\n"
        "Path(sys.argv[1]).write_text(\n"
        "    json.dumps({'teams': teams, 'ucl': ucl}, ensure_ascii=False),\n"
        "    encoding='utf-8'\n"
        ")\n"
    )

    env = os.environ.copy()
    env["PYTHONHASHSEED"] = "0"
    try:
        subprocess.run(
            [python_bin, "-c", helper, str(output_path)],
            cwd=source_dir,
            env=env,
            check=True,
            text=True,
        )
        return json.loads(output_path.read_text(encoding="utf-8"))
    finally:
        output_path.unlink(missing_ok=True)


def build_static_payload(release: dict, commit: str, source_dir: Path, exported: dict) -> dict:
    tag = release.get("tag_name") or "latest"
    published_at = release.get("published_at") or ""
    release_date = published_at[:10] if published_at else ""
    source_data_date = read_upstream_fetch_date(source_dir) or release_date

    teams = exported.get("teams") or []
    ucl = exported.get("ucl") or {}
    generated_at = datetime.now(timezone.utc).isoformat()

    return {
        "metadata": {
            "title": "2026 FIFA World Cup Predictor",
            "sourceRepo": SOURCE_REPO,
            "sourceRelease": tag,
            "sourceCommit": commit,
            "sourceDataDate": source_data_date,
            "generatedAt": generated_at,
            "teamCount": len(teams),
            "model": "Elo-adjusted champion probability + mystic factor + Poisson H2H xG",
            "note": "Static export generated from upstream release for the Lottery pure HTML/CSS/JS app.",
        },
        "teams": teams,
        "ucl": ucl,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync World Cup predictor data from upstream release")
    parser.add_argument("--tag", help="Upstream release tag to sync. Defaults to GitHub latest release.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path")
    parser.add_argument("--python", default=sys.executable, help="Python executable used to run upstream analysis")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    release = latest_release()
    if args.tag:
        release = {
            "tag_name": args.tag,
            "tarball_url": f"{SOURCE_REPO}/archive/refs/tags/{args.tag}.tar.gz",
            "published_at": release.get("published_at", ""),
        }

    tag = release.get("tag_name")
    archive_url = release.get("tarball_url") or f"{SOURCE_REPO}/archive/refs/tags/{tag}.tar.gz"
    if not tag:
        raise RuntimeError("Could not resolve upstream release tag")

    with tempfile.TemporaryDirectory(prefix="ticai-worldcup-") as tmp:
        tmp_path = Path(tmp)
        archive = tmp_path / "source.tar.gz"
        print(f"Downloading {REPO} {tag}...")
        download_archive(archive_url, archive)
        source_dir = extract_archive(archive, tmp_path / "src")

        print("Running upstream analysis export...")
        exported = export_upstream_payload(source_dir, args.python)
        payload = build_static_payload(release, tag_commit(tag), source_dir, exported)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {output} "
        f"({payload['metadata']['teamCount']} teams, {payload['metadata']['sourceRelease']}, "
        f"{payload['metadata']['sourceCommit']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
