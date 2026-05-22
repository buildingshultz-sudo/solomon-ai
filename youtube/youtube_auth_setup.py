#!/usr/bin/env python3
"""
YouTube OAuth2 Authorization Setup
===================================
Run this script ONCE to authorize the Building Shultz YouTube channel.
After completing the browser-based consent flow, tokens are saved to disk
and will auto-refresh forever — no further manual steps required.

Usage:
    python3 youtube_auth_setup.py

What it does:
    1. Reads client_secrets.json from /root/solomon-bot/credentials/
    2. Starts a local OAuth2 flow (opens a URL for Jed to visit)
    3. Saves the refresh token to /root/solomon-bot/credentials/youtube_token.json
"""

import os
import sys
import json
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
CREDENTIALS_DIR = Path("/root/solomon-bot/credentials")
CLIENT_SECRETS_FILE = CREDENTIALS_DIR / "client_secrets.json"
TOKEN_FILE = CREDENTIALS_DIR / "youtube_token.json"

# ── OAuth2 scopes needed ───────────────────────────────────────────────────────
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]


def check_dependencies():
    """Ensure required packages are installed."""
    missing = []
    try:
        import google_auth_oauthlib
    except ImportError:
        missing.append("google-auth-oauthlib")
    try:
        import googleapiclient
    except ImportError:
        missing.append("google-api-python-client")
    try:
        import google.auth.transport.requests
    except ImportError:
        missing.append("google-auth")

    if missing:
        print(f"[ERROR] Missing packages: {', '.join(missing)}")
        print(f"[INFO]  Run: pip3 install {' '.join(missing)}")
        sys.exit(1)


def run_auth_flow():
    """Execute the OAuth2 consent flow and save credentials."""
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.oauth2.credentials import Credentials

    if not CLIENT_SECRETS_FILE.exists():
        print(f"\n[ERROR] client_secrets.json not found at: {CLIENT_SECRETS_FILE}")
        print("\nTo get this file:")
        print("  1. Go to https://console.cloud.google.com/")
        print("  2. Select your project (or create one named 'BuildingShultz')")
        print("  3. Enable the YouTube Data API v3")
        print("  4. Go to APIs & Services → Credentials")
        print("  5. Create OAuth 2.0 Client ID (Desktop app type)")
        print("  6. Download JSON and save as:")
        print(f"     {CLIENT_SECRETS_FILE}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("  YouTube OAuth2 Authorization for Building Shultz")
    print("=" * 60)
    print("\nStarting OAuth2 flow...")
    print("A URL will be printed below. Open it in any browser,")
    print("sign in as buildingshultz@gmail.com, and grant access.\n")

    # Use console flow (no local server needed — works over SSH)
    flow = InstalledAppFlow.from_client_secrets_file(
        str(CLIENT_SECRETS_FILE),
        scopes=SCOPES,
        redirect_uri="urn:ietf:wg:oauth:2.0:oob",
    )

    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # Force refresh_token to be returned
    )

    print("=" * 60)
    print("AUTHORIZATION URL:")
    print(auth_url)
    print("=" * 60)
    print("\nAfter authorizing, you will see a code on screen.")
    print("Paste it here and press Enter:\n")

    code = input("Authorization code: ").strip()

    flow.fetch_token(code=code)
    creds = flow.credentials

    # Save token with all fields needed for refresh
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else SCOPES,
    }

    CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(token_data, indent=2))
    TOKEN_FILE.chmod(0o600)

    print(f"\n[SUCCESS] Token saved to: {TOKEN_FILE}")
    print("[INFO]    Tokens will auto-refresh. No further manual steps needed.")
    print("\nYou can now use youtube_uploader.py from Solomon's agents.")


if __name__ == "__main__":
    check_dependencies()
    run_auth_flow()
