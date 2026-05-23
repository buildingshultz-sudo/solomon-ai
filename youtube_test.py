#!/usr/bin/env python3
"""
YouTube Uploader Smoke Test
============================
Run after completing OAuth authorization to verify everything works.

Usage:
    python3 youtube_test.py

Tests:
    1. Token file exists and is readable
    2. OAuth credentials load and refresh successfully
    3. YouTube API service connects
    4. Channel info retrieves correctly
    5. (Optional) Test upload with a small dummy video
"""

import sys
import json
from pathlib import Path

# Add parent directory to path if running from different location
sys.path.insert(0, str(Path(__file__).parent))

from youtube_uploader import YouTubeUploader, TOKEN_FILE, CLIENT_SECRETS_FILE

PASS = "[PASS]"
FAIL = "[FAIL]"
WARN = "[WARN]"


def test_token_file():
    """Check token file exists and has required fields."""
    print(f"\n--- Test 1: Token file ---")
    if not TOKEN_FILE.exists():
        print(f"{FAIL} Token file not found: {TOKEN_FILE}")
        print(f"       Run: python3 youtube_auth_setup.py")
        return False

    try:
        data = json.loads(TOKEN_FILE.read_text())
        required_keys = ["refresh_token", "token_uri", "client_id", "client_secret"]
        missing = [k for k in required_keys if not data.get(k)]
        if missing:
            print(f"{FAIL} Token file missing fields: {missing}")
            return False
        print(f"{PASS} Token file found with all required fields")
        return True
    except Exception as e:
        print(f"{FAIL} Could not read token file: {e}")
        return False


def test_credentials_load():
    """Test that credentials load and refresh."""
    print(f"\n--- Test 2: Credentials load & refresh ---")
    try:
        uploader = YouTubeUploader()
        creds = uploader._get_credentials()
        if creds.valid:
            print(f"{PASS} Credentials loaded and are valid")
        else:
            print(f"{WARN} Credentials loaded but may need refresh")
        return True
    except FileNotFoundError as e:
        print(f"{FAIL} {e}")
        return False
    except Exception as e:
        print(f"{FAIL} Credentials failed: {e}")
        return False


def test_api_service():
    """Test that the YouTube API service can be built."""
    print(f"\n--- Test 3: YouTube API service ---")
    try:
        uploader = YouTubeUploader()
        service = uploader._get_service()
        print(f"{PASS} YouTube API service built successfully")
        return True
    except Exception as e:
        print(f"{FAIL} Service build failed: {e}")
        return False


def test_channel_info():
    """Test that channel info can be retrieved."""
    print(f"\n--- Test 4: Channel info ---")
    try:
        uploader = YouTubeUploader()
        info = uploader.get_channel_info()
        if "error" in info:
            print(f"{FAIL} Channel info error: {info['error']}")
            return False
        print(f"{PASS} Channel: {info.get('title', 'Unknown')}")
        print(f"       Channel ID: {info.get('channel_id', 'N/A')}")
        print(f"       Subscribers: {info.get('subscriber_count', 'N/A')}")
        print(f"       Videos: {info.get('video_count', 'N/A')}")
        return True
    except Exception as e:
        print(f"{FAIL} Channel info failed: {e}")
        return False


def test_crewai_tool():
    """Test that the CrewAI tool is importable."""
    print(f"\n--- Test 5: CrewAI tool ---")
    try:
        from youtube_uploader import youtube_upload_tool
        if youtube_upload_tool is not None:
            print(f"{PASS} CrewAI youtube_upload_tool is available")
        else:
            print(f"{WARN} CrewAI not installed — tool not available (OK if running standalone)")
        return True
    except Exception as e:
        print(f"{FAIL} CrewAI tool import failed: {e}")
        return False


if __name__ == "__main__":
    print("=" * 55)
    print("  YouTube Uploader Smoke Test — Building Shultz")
    print("=" * 55)

    results = [
        test_token_file(),
        test_credentials_load(),
        test_api_service(),
        test_channel_info(),
        test_crewai_tool(),
    ]

    passed = sum(results)
    total = len(results)

    print(f"\n{'=' * 55}")
    print(f"  Results: {passed}/{total} tests passed")
    print(f"{'=' * 55}")

    if passed == total:
        print("\n  All tests passed! Solomon is ready to upload videos.")
    else:
        print(f"\n  {total - passed} test(s) failed. Check errors above.")
        sys.exit(1)
