#!/usr/bin/env python3
"""
One-time Google Calendar OAuth setup.

Before running:
1. Go to https://console.cloud.google.com
2. Create a project (or use an existing one)
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials (Desktop app type)
5. Download the credentials JSON and save as data/calendar_credentials.json

Then run: python scripts/setup_calendar.py
"""

import json
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

REPO_ROOT = Path(__file__).parent.parent
CREDENTIALS_FILE = REPO_ROOT / "data" / "calendar_credentials.json"
TOKEN_FILE = REPO_ROOT / "data" / "calendar_token.json"

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]


def main():
    if not CREDENTIALS_FILE.exists():
        print(f"ERROR: credentials file not found at {CREDENTIALS_FILE}")
        print()
        print("Steps to fix:")
        print("  1. Go to https://console.cloud.google.com")
        print("  2. Create a project and enable the Google Calendar API")
        print("  3. Create OAuth 2.0 credentials (Desktop app)")
        print("  4. Download credentials JSON → save as data/calendar_credentials.json")
        sys.exit(1)

    print("Opening Google authorization page in your browser...")
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=8081, open_browser=True)

    TOKEN_FILE.write_text(creds.to_json())
    print(f"\nTokens saved to {TOKEN_FILE}")
    print("\nSetup complete! Run `python scripts/sync_calendar.py` to fetch your calendar.")


if __name__ == "__main__":
    main()
