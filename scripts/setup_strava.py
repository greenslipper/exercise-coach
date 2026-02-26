#!/usr/bin/env python3
"""
One-time Strava OAuth setup. Reads CLIENT_ID and CLIENT_SECRET from .env,
opens the browser for authorization, catches the callback on port 8080,
and writes the resulting tokens back to .env.
"""

import os
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode, urlparse, parse_qs
from pathlib import Path

import requests
from dotenv import dotenv_values, set_key

ENV_PATH = Path(__file__).parent.parent / ".env"
REDIRECT_URI = "http://localhost:8080/callback"
AUTH_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"

auth_code = None


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"""
                <html><body style="font-family:sans-serif;padding:2rem">
                <h2>Authorization successful!</h2>
                <p>You can close this tab and return to the terminal.</p>
                </body></html>
            """)
        else:
            error = params.get("error", ["unknown"])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(f"""
                <html><body style="font-family:sans-serif;padding:2rem">
                <h2>Authorization failed</h2>
                <p>Error: {error}</p>
                </body></html>
            """.encode())

    def log_message(self, format, *args):
        pass  # Suppress request logs


def main():
    if not ENV_PATH.exists():
        print(f"ERROR: .env file not found at {ENV_PATH}")
        print("Copy .env.example to .env and fill in your Client ID and Secret.")
        sys.exit(1)

    env = dotenv_values(ENV_PATH)
    client_id = env.get("STRAVA_CLIENT_ID", "")
    client_secret = env.get("STRAVA_CLIENT_SECRET", "")

    if not client_id or client_id == "your_client_id_here":
        print("ERROR: STRAVA_CLIENT_ID not set in .env")
        sys.exit(1)
    if not client_secret or client_secret == "your_client_secret_here":
        print("ERROR: STRAVA_CLIENT_SECRET not set in .env")
        sys.exit(1)

    params = urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "approval_prompt": "auto",
        "scope": "activity:read_all",
    })
    auth_url = f"{AUTH_URL}?{params}"

    print("Opening Strava authorization page in your browser...")
    print(f"If it doesn't open automatically, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    print("Waiting for authorization callback on http://localhost:8080 ...")
    server = HTTPServer(("localhost", 8080), CallbackHandler)
    server.handle_request()  # Handle exactly one request then stop

    if not auth_code:
        print("ERROR: Did not receive authorization code.")
        sys.exit(1)

    print("Exchanging authorization code for tokens...")
    response = requests.post(TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": auth_code,
        "grant_type": "authorization_code",
    })

    if response.status_code != 200:
        print(f"ERROR: Token exchange failed ({response.status_code}): {response.text}")
        sys.exit(1)

    data = response.json()
    set_key(ENV_PATH, "STRAVA_ACCESS_TOKEN", data["access_token"])
    set_key(ENV_PATH, "STRAVA_REFRESH_TOKEN", data["refresh_token"])
    set_key(ENV_PATH, "STRAVA_TOKEN_EXPIRES_AT", str(data["expires_at"]))

    athlete = data.get("athlete", {})
    name = f"{athlete.get('firstname', '')} {athlete.get('lastname', '')}".strip()
    print(f"\nTokens saved to .env")
    if name:
        print(f"Authorized as: {name}")
    print("\nSetup complete! Run `python scripts/sync_strava.py` to fetch your activities.")


if __name__ == "__main__":
    main()
