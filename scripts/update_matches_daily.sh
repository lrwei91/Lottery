#!/bin/bash
# Daily match schedule update script
# Run once per day via cron/launchd to refresh worldcup_matches.json
# Configurable: update score data can be added when WC starts

cd "$(dirname "$0")/.."
python3 scripts/generate_match_schedule.py
echo "Match schedule updated at $(date)"
