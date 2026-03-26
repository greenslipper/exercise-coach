#!/usr/bin/env python3
"""
Syncs upcoming Google Calendar events to data/calendar.json.
Fetches events from today through 6 weeks ahead across all calendars.
Run this at the start of each Claude session (alongside sync_strava.py).
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

REPO_ROOT = Path(__file__).parent.parent
CREDENTIALS_FILE = REPO_ROOT / "data" / "calendar_credentials.json"
TOKEN_FILE = REPO_ROOT / "data" / "calendar_token.json"
CALENDAR_FILE = REPO_ROOT / "data" / "calendar.json"

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
WEEKS_AHEAD = 6


def load_credentials():
    if not TOKEN_FILE.exists():
        print("ERROR: calendar not set up. Run `python scripts/setup_calendar.py` first.")
        sys.exit(1)

    creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_FILE.write_text(creds.to_json())

    if not creds.valid:
        print("ERROR: calendar credentials invalid. Re-run `python scripts/setup_calendar.py`.")
        sys.exit(1)

    return creds


def parse_event(event, calendar_name):
    start = event.get("start", {})
    end = event.get("end", {})
    title = event.get("summary", "(no title)")

    # All-day events use 'date', timed events use 'dateTime'
    if "date" in start:
        return {
            "date": start["date"],
            "start_time": None,
            "end_time": None,
            "title": title,
            "calendar": calendar_name,
            "all_day": True,
        }
    else:
        dt_start = datetime.fromisoformat(start["dateTime"])
        dt_end = datetime.fromisoformat(end["dateTime"])
        return {
            "date": dt_start.strftime("%Y-%m-%d"),
            "start_time": dt_start.strftime("%H:%M"),
            "end_time": dt_end.strftime("%H:%M"),
            "title": title,
            "calendar": calendar_name,
            "all_day": False,
        }


def main():
    creds = load_credentials()
    service = build("calendar", "v3", credentials=creds)

    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(weeks=WEEKS_AHEAD)).isoformat()

    # Get all calendars
    calendars_result = service.calendarList().list().execute()
    calendars = calendars_result.get("items", [])

    all_events = []
    for cal in calendars:
        cal_id = cal["id"]
        cal_name = cal.get("summary", cal_id)

        try:
            events_result = service.events().list(
                calendarId=cal_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
            ).execute()
            events = events_result.get("items", [])
            for event in events:
                all_events.append(parse_event(event, cal_name))
        except Exception as e:
            print(f"  Warning: could not read calendar '{cal_name}': {e}")

    # Sort by date then start_time
    all_events.sort(key=lambda e: (e["date"], e["start_time"] or ""))

    output = {
        "last_sync": now.strftime("%Y-%m-%d %H:%M UTC"),
        "events": all_events,
    }
    CALENDAR_FILE.write_text(json.dumps(output, indent=2))

    print(f"Calendar sync complete. {len(all_events)} events over next {WEEKS_AHEAD} weeks.")


if __name__ == "__main__":
    main()
