#!/usr/bin/env python3
"""
Pulls gym logs and weight entries from the Cloudflare Worker into local files.
Run this at the start of each Claude session alongside sync_strava.py.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).parent.parent
GYM_LOG_FILE = REPO_ROOT / "data" / "gym_log.json"
WEIGHT_FILE = REPO_ROOT / "data" / "weight_log.json"


def load_config():
    env_file = REPO_ROOT / ".env"
    config = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                config[k.strip()] = v.strip()

    url = config.get("COACH_WORKER_URL") or os.environ.get("COACH_WORKER_URL")
    secret = config.get("COACH_WORKER_SECRET") or os.environ.get("COACH_WORKER_SECRET")

    if not url or not secret:
        print("ERROR: COACH_WORKER_URL and COACH_WORKER_SECRET must be set in .env")
        sys.exit(1)

    return url.rstrip("/"), secret


def fetch(url, secret, path):
    r = requests.get(f"{url}{path}", headers={"Authorization": f"Bearer {secret}"})
    r.raise_for_status()
    return r.json()


def main():
    url, secret = load_config()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    gym_logs = fetch(url, secret, "/gym-log")
    GYM_LOG_FILE.write_text(json.dumps({"last_sync": now, "logs": gym_logs}, indent=2))
    print(f"Gym log sync complete. {len(gym_logs)} session(s).")

    weight_entries = fetch(url, secret, "/weight")
    WEIGHT_FILE.write_text(json.dumps({"last_sync": now, "entries": weight_entries}, indent=2))
    print(f"Weight log sync complete. {len(weight_entries)} entry/entries.")


if __name__ == "__main__":
    main()
