"""
Generate 2026 World Cup group stage match schedule from team data.

Produces data/worldcup_matches.json with group assignments, match dates,
venues, and status for all 72 group-stage matches (12 groups × 6 matches).

Run daily:  python3 scripts/generate_match_schedule.py
"""

import json
import os
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
TEAMS_FILE = os.path.join(DATA_DIR, 'worldcup_2026.json')
OUTPUT_FILE = os.path.join(DATA_DIR, 'worldcup_matches.json')

ALL_VENUES = [
    'MetLife Stadium (New York/New Jersey)', 'SoFi Stadium (Los Angeles)', "AT&T Stadium (Dallas)",
    'Mercedes-Benz Stadium (Atlanta)', 'NRG Stadium (Houston)', 'Arrowhead Stadium (Kansas City)',
    "Levi's Stadium (San Francisco)", 'Lumen Field (Seattle)', 'Gillette Stadium (Boston)',
    'Hard Rock Stadium (Miami)', 'Lincoln Financial Field (Philadelphia)',
    'Estadio Azteca (Mexico City)', 'Estadio BBVA (Monterrey)', 'Estadio Akron (Guadalajara)',
    'BC Place (Vancouver)', 'BMO Field (Toronto)',
]

TIME_SLOTS = ['13:00', '16:00', '19:00', '22:00']
GROUP_LABELS = [chr(ord('A') + i) for i in range(12)]

# Round-robin: 2 matches per match day × 3 match days = 6 per group
# (home_idx, away_idx), swap_home
MATCH_PAIRINGS = [
    [((0, 1), False), ((2, 3), False)],
    [((0, 2), True),  ((1, 3), True)],
    [((0, 3), False), ((1, 2), True)],
]


def generate_schedule():
    with open(TEAMS_FILE, encoding='utf-8') as f:
        data = json.load(f)

    metadata = data.get('metadata', {})
    teams_sorted = sorted(data['teams'], key=lambda t: t.get('elo', 0), reverse=True)
    qualified = teams_sorted[:48]  # top 48 by Elo

    # Serpentine draw: 4 pots → 12 groups
    groups = {l: {'teams': [], 'matches': []} for l in GROUP_LABELS}
    for pot in range(4):
        for i, t in enumerate(qualified[pot * 12:pot * 12 + 12]):
            idx = i if pot % 2 == 0 else 11 - i
            groups[GROUP_LABELS[idx]]['teams'].append(t['country'])

    BASE_DATE = datetime(2026, 6, 11, tzinfo=timezone.utc)
    WAVES = [GROUP_LABELS[0:4], GROUP_LABELS[4:8], GROUP_LABELS[8:12]]
    match_idx = 0

    for wave_num, wave_groups in enumerate(WAVES):
        for md in range(3):
            match_date = BASE_DATE.replace(day=BASE_DATE.day + wave_num + md * 3)
            slot_idx = 0
            for label in wave_groups:
                for (hi, ai), swap in MATCH_PAIRINGS[md]:
                    tg = groups[label]['teams']
                    home, away = (tg[ai], tg[hi]) if swap else (tg[hi], tg[ai])
                    groups[label]['matches'].append({
                        'id': f'{label.lower()}-md{md+1}-{slot_idx+1}',
                        'group': label, 'matchDay': md + 1,
                        'date': match_date.strftime('%Y-%m-%d'),
                        'time': TIME_SLOTS[slot_idx % len(TIME_SLOTS)],
                        'venue': ALL_VENUES[match_idx % len(ALL_VENUES)],
                        'home': home, 'away': away,
                        'homeScore': None, 'awayScore': None, 'status': 'scheduled',
                    })
                    match_idx += 1
                    slot_idx += 1

    now = datetime.now(timezone.utc)
    output = {
        'metadata': {
            'lastUpdated': now.isoformat(),
            'generatedBy': 'scripts/generate_match_schedule.py',
            'sourceDataDate': metadata.get('sourceDataDate', ''),
            'note': '2026 World Cup group stage match schedule',
            'teamCount': 48, 'matchCount': match_idx,
        },
        'groups': {l: groups[l] for l in GROUP_LABELS},
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"✓ {match_idx} matches generated for {len(GROUP_LABELS)} groups (48 teams)")
    print(f"  Last updated: {now.strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"  Saved to {OUTPUT_FILE}")


if __name__ == '__main__':
    generate_schedule()
