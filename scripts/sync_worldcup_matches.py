#!/usr/bin/env python3
"""
Sync the 2026 FIFA World Cup match schedule from FIFA's public calendar API.

The frontend is deployed as a static GitHub Pages app, so this script resolves
live schedule/result data at build time and writes data/worldcup_matches.json.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
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
    query = urllib.parse.urlencode(params)
    url = f"{API_BASE}{path}?{query}"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "ticai-worldcup-match-sync",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as res:
        return json.loads(res.read().decode("utf-8"))


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
    home_score = raw.get("HomeTeamScore")
    away_score = raw.get("AwayTeamScore")
    if home_score is not None and away_score is not None and status == "scheduled":
        status = "completed"

    group_name = localized(raw.get("GroupName"))
    group = group_name.replace("Group ", "").strip()

    home = raw.get("Home") or {}
    away = raw.get("Away") or {}

    return {
        "id": str(raw.get("IdMatch") or ""),
        "matchNumber": raw.get("MatchNumber"),
        "group": group,
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
            "note": "Official FIFA World Cup 2026 group-stage fixtures and score status.",
            "teamCount": sum(len(group["teams"]) for group in groups.values()),
            "matchCount": sum(len(group["matches"]) for group in groups.values()),
        },
        "groups": groups,
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
