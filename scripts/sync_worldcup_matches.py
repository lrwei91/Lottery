#!/usr/bin/env python3
"""
Sync the 2026 FIFA World Cup match schedule from FIFA's public calendar API.

The frontend is deployed as a static GitHub Pages app, so this script resolves
live schedule/result data at build time and writes data/worldcup_matches.json.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.client import RemoteDisconnected
from pathlib import Path


API_BASE = "https://api.fifa.com/api/v3"
COMPETITION_ID = "17"
SEASON_ID = "285023"
LANGUAGE = "en"
OUTPUT_FILE = Path("data/worldcup_matches.json")


TEAM_NAME_ALIASES = {
    "Bosnia and Herzegovina": "Bosnia-Herzegovina",
    "Cabo Verde": "Cape Verde",
    "Congo DR": "DR Congo",
    "Côte d'Ivoire": "Ivory Coast",
    "Czechia": "Czech Republic",
    "IR Iran": "Iran",
    "Korea Republic": "South Korea",
    "Türkiye": "Turkey",
}


STATUS_MAP = {
    0: "unknown",
    1: "scheduled",
    2: "scheduled",
    3: "live",
    4: "live",
    5: "live",
    6: "live",
    7: "live",
    8: "live",
    9: "live",
    10: "completed",
    11: "completed",
    12: "completed",
    13: "abandoned",
    15: "live",
    16: "live",
    17: "live",
}


def localized(values: list[dict] | None) -> str:
    if not values:
        return ""
    for item in values:
        if item.get("Locale", "").lower().startswith("en"):
            return item.get("Description", "")
    return values[0].get("Description", "")


def normalize_team(team: dict | None) -> str:
    if not team:
        return ""
    name = team.get("ShortClubName") or localized(team.get("TeamName")) or ""
    return TEAM_NAME_ALIASES.get(name, name)


def request_json(path: str, params: dict[str, str]) -> dict:
    """GET FIFA API JSON, with 3-retry + exponential backoff (1s/2s/4s).

    2026-06-28 加入: FIFA API 跑 72 场 h2h 时偶尔 RemoteDisconnected,需要 retry.
    """
    query = urllib.parse.urlencode(params)
    url = f"{API_BASE}{path}?{query}"
    last_exc = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "ticai-worldcup-match-sync",
                },
            )
            with urllib.request.urlopen(req, timeout=45) as res:
                return json.loads(res.read().decode("utf-8"))
        except (urllib.error.URLError, RemoteDisconnected, TimeoutError) as exc:
            last_exc = exc
            if attempt < 2:
                backoff = 1 * (2 ** attempt)  # 1s, 2s
                print(f"  retry {attempt + 1}/3 after {backoff}s: {type(exc).__name__}: {exc}")
                time.sleep(backoff)
                continue
            break
    # 3 次都失败,raise 让上层处理
    raise last_exc  # type: ignore[misc]


def fetch_head_to_head(home_id: str, away_id: str) -> dict | None:
    if not home_id or not away_id:
        return None

    try:
        payload = request_json(
            f"/statistics/headtohead/{home_id}/{away_id}",
            {"language": LANGUAGE, "count": "20"},
        )
    except Exception as exc:
        print(f"Skipping H2H {home_id}/{away_id}: {exc}")
        return None

    team_a = payload.get("TeamA") or {}
    matches = payload.get("MatchesList") or []
    total = team_a.get("MatchesPlayed") or len(matches)
    if not total:
        return None

    return {
        "source": "FIFA head-to-head statistics API",
        "wHome": team_a.get("Wins") or 0,
        "draws": team_a.get("Draws") or 0,
        "wAway": team_a.get("Losses") or 0,
        "total": total,
        "goalsHome": team_a.get("GoalsScored") or 0,
        "goalsAway": team_a.get("GoalsAgainst") or 0,
        "matches": [build_h2h_match(match) for match in matches[:5]],
    }


def fetch_matches() -> list[dict]:
    payload = request_json(
        "/calendar/matches",
        {
            "language": LANGUAGE,
            "count": "500",
            "idCompetition": COMPETITION_ID,
            "idSeason": SEASON_ID,
        },
    )
    return payload.get("Results", [])


def build_h2h_match(raw: dict) -> dict:
    date = ""
    if raw.get("Date"):
        date, _time = match_date_parts(raw["Date"])
    return {
        "date": date,
        "competition": localized(raw.get("CompetitionName")),
        "stage": localized(raw.get("StageName")),
        "home": normalize_team(raw.get("Home")),
        "away": normalize_team(raw.get("Away")),
        "homeScore": raw.get("HomeTeamScore"),
        "awayScore": raw.get("AwayTeamScore"),
    }


def match_date_parts(value: str) -> tuple[str, str]:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    return parsed.strftime("%Y-%m-%d"), parsed.strftime("%H:%M")


def build_match(raw: dict) -> dict:
    date, time = match_date_parts(raw.get("Date", ""))
    stadium = raw.get("Stadium") or {}
    venue_name = localized(stadium.get("Name"))
    city_name = localized(stadium.get("CityName"))
    venue = ", ".join(part for part in [venue_name, city_name] if part)
    status = STATUS_MAP.get(raw.get("MatchStatus"), "unknown")

    home = raw.get("Home") or {}
    away = raw.get("Away") or {}

    # 2026-06-21 修复：FIFA calendar/matches 在实战里更稳定的是嵌套 Home.Score / Away.Score，
    # 顶层 HomeTeamScore / AwayTeamScore 有时仍是 None，导致 finished 比赛被错误写成 scheduled。
    home_score = home.get("Score") if home.get("Score") is not None else raw.get("HomeTeamScore")
    away_score = away.get("Score") if away.get("Score") is not None else raw.get("AwayTeamScore")
    if home_score is not None and away_score is not None and status in {"unknown", "scheduled", "live"}:
        status = "completed"

    group_name = localized(raw.get("GroupName"))
    group = group_name.replace("Group ", "").strip()

    return {
        "id": str(raw.get("IdMatch") or ""),
        "matchNumber": raw.get("MatchNumber"),
        "group": group,
        "stage": localized(raw.get("StageName")),  # 2026-06-28 加入:支持 knockout 阶段显示
        "matchDay": raw.get("MatchDay"),
        "date": date,
        "time": time,
        "venue": venue,
        "home": normalize_team(home),
        "away": normalize_team(away),
        "homeId": str(home.get("IdTeam") or ""),
        "awayId": str(away.get("IdTeam") or ""),
        "homeScore": home_score,
        "awayScore": away_score,
        "status": status,
        "sourceStatus": raw.get("MatchStatus"),
    }


def build_output(raw_matches: list[dict]) -> dict:
    groups = {chr(ord("A") + i): {"teams": [], "matches": []} for i in range(12)}
    first_stage = [
        match for match in raw_matches
        if localized(match.get("StageName")) == "First Stage"
    ]
    # 2026-06-28 加入:knockout 阶段 (R32 / R16 / QF / SF / F) 单独落 knockout 段
    # 现有 groups A-L 字段不动,前端 0 改动即可
    knockout = {
        "roundOf32": [],   # Round of 32 (32 → 16)
        "roundOf16": [],   # Round of 16 (16 → 8)
        "quarterFinals": [],  # 8 → 4
        "semiFinals": [],     # 4 → 2
        "final": [],          # 决赛
        "thirdPlace": [],     # 季军赛
    }
    STAGE_TO_KEY = {
        "Round of 32": "roundOf32",
        "Round of 16": "roundOf16",
        "Quarter-finals": "quarterFinals",
        "Quarter-final": "quarterFinals",      # 2026-07-09 修正:FIFA API 实际用单数
        "Semi-finals": "semiFinals",
        "Semi-final": "semiFinals",             # 2026-07-09 修正
        "Final": "final",
        "Match for third place": "thirdPlace",
        "Play-off for third place": "thirdPlace",  # 2026-07-09 修正:FIFA API 实际用此名
    }

    for raw in sorted(first_stage, key=lambda item: item.get("MatchNumber") or 999):
        match = build_match(raw)
        match["headToHead"] = fetch_head_to_head(match["homeId"], match["awayId"])
        group = match["group"]
        if group not in groups:
            continue
        for team in [match["home"], match["away"]]:
            if team and team not in groups[group]["teams"]:
                groups[group]["teams"].append(team)
        groups[group]["matches"].append(match)

    # knockout 阶段:不拉 h2h (R32 阶段无历史交锋,等比赛打完才有)
    for raw in raw_matches:
        stage = localized(raw.get("StageName"))
        if stage in STAGE_TO_KEY:
            match = build_match(raw)
            # 不调 fetch_head_to_head (R32 阶段 h2h API 大概率空)
            knockout[STAGE_TO_KEY[stage]].append(match)
    # 各阶段按 date+time 排序
    for key in knockout:
        knockout[key].sort(key=lambda m: (m.get("date", ""), m.get("time", "")))

    # 统计:groups + knockout 一起
    knockout_match_count = sum(len(v) for v in knockout.values())
    knockout_team_count = len(set(
        team
        for stage_matches in knockout.values()
        for m in stage_matches
        for team in [m.get("home"), m.get("away")] if team
    ))

    now = datetime.now(timezone.utc)
    return {
        "metadata": {
            "lastUpdated": now.isoformat(),
            "generatedBy": "scripts/sync_worldcup_matches.py",
            "sourceName": "FIFA public calendar API",
            "sourceUrl": (
                f"{API_BASE}/calendar/matches?"
                f"language={LANGUAGE}&count=500&idCompetition={COMPETITION_ID}&idSeason={SEASON_ID}"
            ),
            "sourceDataDate": now.strftime("%Y-%m-%d"),
            "note": "Official FIFA World Cup 2026 fixtures (group stage + knockout rounds).",  # 2026-06-28 改:含 knockout
            "teamCount": sum(len(group["teams"]) for group in groups.values()) + knockout_team_count,
            "matchCount": sum(len(group["matches"]) for group in groups.values()) + knockout_match_count,
        },
        "groups": groups,
        "knockout": knockout,  # 2026-06-28 新增字段 (R32/R16/QF/SF/F/季军)
    }


def main() -> int:
    output = build_output(fetch_matches())
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT_FILE} "
        f"({output['metadata']['matchCount']} matches, {output['metadata']['teamCount']} teams)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
