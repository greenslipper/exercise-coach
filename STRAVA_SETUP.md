# Strava API Setup Guide

One-time setup to connect your Strava account. Takes about 5 minutes.

---

## Step 1: Create a Strava API Application

1. Go to https://www.strava.com/settings/api
2. If you haven't created an app before, fill in the form:
   - **Application Name**: Exercise Coach (or anything you like)
   - **Category**: Other
   - **Club**: leave blank
   - **Website**: `http://localhost`
   - **Authorization Callback Domain**: `localhost`
3. Click **Create** (or update if app already exists)
4. You'll see your **Client ID** and **Client Secret** on the page

---

## Step 2: Copy Your Credentials

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Open `.env` and fill in your Client ID and Client Secret:

```
STRAVA_CLIENT_ID=12345
STRAVA_CLIENT_SECRET=abc123...
```

Leave the token fields empty — the setup script fills those in.

---

## Step 3: Run the OAuth Setup Script

```bash
pip install -r scripts/requirements.txt
python scripts/setup_strava.py
```

The script will:
1. Open your browser to Strava's authorization page
2. Ask you to authorize the app (read-only access to your activities)
3. Start a local server on port 8080 to catch the callback
4. Exchange the auth code for tokens and write them to `.env`

When you see `Tokens saved to .env` in the terminal, setup is complete.

---

## Step 4: Sync Your Activities

```bash
python scripts/sync_strava.py
```

This fetches your athlete profile and all activities, writing them to `data/`. Run this any time you want fresh data before a coaching session.

---

## Ongoing Token Refresh

Strava access tokens expire after 6 hours. `sync_strava.py` automatically refreshes the token using your refresh token, so you never need to re-authorize. Just run the sync script and it handles everything.

---

## Troubleshooting

**"Address already in use" on port 8080**: Another process is using the port. Run `lsof -i :8080` to find and kill it, then retry.

**"Authorization Error" on Strava page**: Check that your Client ID in `.env` matches what's shown at https://www.strava.com/settings/api.

**Tokens not saving**: Make sure `.env` exists (copied from `.env.example`) and is writable.
