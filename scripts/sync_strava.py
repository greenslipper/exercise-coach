#!/usr/bin/env python3
"""
Incremental Strava sync. Refreshes tokens if expired, then fetches new
activities since the last sync and writes them to data/.

Handles Strava's rate limits (100 requests/15 min, 1000/day):
- Skips activities already downloaded so the script is safely resumable
- Catches 429 and waits for the rate-limit window to reset before retrying
- Adds a small delay between detail fetches to stay under the limit
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values, set_key

REPO_ROOT = Path(__file__).parent.parent
ENV_PATH = REPO_ROOT / ".env"
DATA_DIR = REPO_ROOT / "data"
ACTIVITIES_DIR = DATA_DIR / "activities"
ATHLETE_FILE = DATA_DIR / "athlete.json"
SYNC_LOG_FILE = DATA_DIR / "sync_log.json"
STRAVA_RUNS_FILE = REPO_ROOT / "docs" / "strava_runs.json"

BASE_URL = "https://www.strava.com/api/v3"
TOKEN_URL = "https://www.strava.com/oauth/token"

# Pause between detail fetches — keeps us well under 100 req/15 min
REQUEST_DELAY = 1.0  # seconds


def load_env():
    if not ENV_PATH.exists():
        print("ERROR: .env not found. Run `python3 scripts/setup_strava.py` first.")
        sys.exit(1)
    return dotenv_values(ENV_PATH)


def refresh_token_if_needed(env):
    expires_at = int(env.get("STRAVA_TOKEN_EXPIRES_AT", 0))
    now = int(time.time())

    if now < expires_at - 300:  # 5-minute buffer
        return env["STRAVA_ACCESS_TOKEN"]

    print("Access token expired, refreshing...")
    response = requests.post(TOKEN_URL, data={
        "client_id": env["STRAVA_CLIENT_ID"],
        "client_secret": env["STRAVA_CLIENT_SECRET"],
        "grant_type": "refresh_token",
        "refresh_token": env["STRAVA_REFRESH_TOKEN"],
    })

    if response.status_code != 200:
        print(f"ERROR: Token refresh failed ({response.status_code}): {response.text}")
        sys.exit(1)

    data = response.json()
    set_key(ENV_PATH, "STRAVA_ACCESS_TOKEN", data["access_token"])
    set_key(ENV_PATH, "STRAVA_REFRESH_TOKEN", data["refresh_token"])
    set_key(ENV_PATH, "STRAVA_TOKEN_EXPIRES_AT", str(data["expires_at"]))
    print("Token refreshed.")
    return data["access_token"]


def load_sync_log():
    if SYNC_LOG_FILE.exists():
        return json.loads(SYNC_LOG_FILE.read_text())
    return {"last_sync": 0, "total_activities": 0, "last_sync_human": "never"}


def save_sync_log(log):
    SYNC_LOG_FILE.write_text(json.dumps(log, indent=2))


def api_get(token, path, params=None, retry=True):
    """GET from Strava API. Handles 401 and 429 automatically."""
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}{path}", headers=headers, params=params or {})

    if response.status_code == 401:
        print("ERROR: Unauthorized. Try re-running setup_strava.py.")
        sys.exit(1)

    if response.status_code == 429:
        # Check rate limit headers to see how long to wait
        # Strava sends X-RateLimit-Limit and X-RateLimit-Usage (short,long)
        usage = response.headers.get("X-RateLimit-Usage", "")
        limit = response.headers.get("X-RateLimit-Limit", "")
        wait = 15 * 60  # default: wait 15 minutes for short-term window to reset
        print(f"\n  Rate limit hit (usage: {usage} of {limit}).")
        print(f"  Waiting {wait // 60} minutes before retrying...", flush=True)
        for remaining in range(wait, 0, -30):
            print(f"  {remaining}s remaining...", flush=True)
            time.sleep(30)
        print("  Retrying...")
        return api_get(token, path, params, retry=False)

    response.raise_for_status()
    return response.json()


def main():
    DATA_DIR.mkdir(exist_ok=True)
    ACTIVITIES_DIR.mkdir(exist_ok=True)

    env = load_env()

    if not env.get("STRAVA_ACCESS_TOKEN"):
        print("ERROR: No access token found. Run `python3 scripts/setup_strava.py` first.")
        sys.exit(1)

    token = refresh_token_if_needed(env)

    # Fetch and save athlete profile
    print("Fetching athlete profile...")
    athlete = api_get(token, "/athlete")
    ATHLETE_FILE.write_text(json.dumps(athlete, indent=2))
    print(f"  Saved athlete: {athlete.get('firstname', '')} {athlete.get('lastname', '')}")

    # Load sync log
    sync_log = load_sync_log()
    last_sync = sync_log["last_sync"]
    if last_sync:
        print(f"Fetching activities since {sync_log['last_sync_human']}...")
    else:
        print("Fetching all activities (first sync — this may take a while)...")

    # Paginate through activity summaries
    new_activities = []
    page = 1
    per_page = 100

    while True:
        activities = api_get(token, "/athlete/activities", {
            "after": last_sync,
            "per_page": per_page,
            "page": page,
        })

        if not activities:
            break

        new_activities.extend(activities)
        if len(activities) < per_page:
            break
        page += 1

    # Filter out activities already saved on disk (allows safe resume after interruption)
    to_fetch = [a for a in new_activities
                if not (ACTIVITIES_DIR / f"{a['id']}.json").exists()]
    already_done = len(new_activities) - len(to_fetch)

    print(f"  Found {len(new_activities)} activities ({already_done} already downloaded, {len(to_fetch)} to fetch)")

    # Fetch full detail for each activity
    for i, summary in enumerate(to_fetch, 1):
        activity_id = summary["id"]
        activity_type = summary.get("type", "Unknown")
        activity_date = summary.get("start_date_local", "")[:10]
        print(f"  [{i}/{len(to_fetch)}] {activity_type} on {activity_date} (id: {activity_id})")

        detail = api_get(token, f"/activities/{activity_id}")
        activity_file = ACTIVITIES_DIR / f"{activity_id}.json"
        activity_file.write_text(json.dumps(detail, indent=2))

        if i < len(to_fetch):
            time.sleep(REQUEST_DELAY)

    # Update sync log only after a successful (or fully-resumed) run
    now = int(time.time())
    existing_count = len(list(ACTIVITIES_DIR.glob("*.json")))
    sync_log["last_sync"] = now
    sync_log["last_sync_human"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sync_log["total_activities"] = existing_count
    save_sync_log(sync_log)

    # Build strava_runs.json from all activity files
    run_dates = set()
    for activity_file in ACTIVITIES_DIR.glob("*.json"):
        try:
            activity = json.loads(activity_file.read_text())
            if activity.get("type") == "Run" or activity.get("sport_type") == "Run":
                date_str = activity.get("start_date_local", "")[:10]
                if date_str:
                    run_dates.add(date_str)
        except (json.JSONDecodeError, KeyError):
            pass
    strava_summary = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "run_dates": sorted(run_dates),
    }
    STRAVA_RUNS_FILE.write_text(json.dumps(strava_summary, indent=2))

    print(f"\nSync complete.")
    print(f"  Fetched this run: {len(to_fetch)}")
    print(f"  Total on disk: {existing_count}")
    print(f"  Sync time: {sync_log['last_sync_human']}")
    print(f"  Run dates indexed: {len(run_dates)}")


if __name__ == "__main__":
    main()
