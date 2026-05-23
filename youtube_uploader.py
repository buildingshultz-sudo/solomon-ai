#!/usr/bin/env python3
"""
YouTube Uploader Module for Solomon CrewAI
==========================================
Provides a clean API for uploading videos to the Building Shultz YouTube channel.
Handles OAuth2 token refresh automatically — no manual intervention after initial setup.

Capabilities:
  - Upload video files (MP4, MOV, AVI, etc.)
  - Set title, description, tags, category, privacy
  - Set custom thumbnail
  - Schedule publish time (future date/time)
  - Resume interrupted uploads (resumable upload protocol)

Usage (standalone):
    from youtube_uploader import YouTubeUploader

    uploader = YouTubeUploader()
    result = uploader.upload_video(
        video_path="/path/to/video.mp4",
        title="My Video Title",
        description="Video description here",
        tags=["tag1", "tag2"],
        thumbnail_path="/path/to/thumb.jpg",   # optional
        publish_at="2025-12-25T18:00:00Z",      # optional ISO 8601 UTC
        privacy="private",                       # public | private | unlisted
        category_id="22",                        # 22 = People & Blogs
    )
    print(result)  # {"video_id": "abc123", "url": "https://youtu.be/abc123", ...}

Usage (as CrewAI tool):
    from youtube_uploader import youtube_upload_tool
    # Register youtube_upload_tool in your CrewAI agent's tools list
"""

import os
import sys
import json
import time
import math
import mimetypes
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

# ── Paths ──────────────────────────────────────────────────────────────────────
CREDENTIALS_DIR = Path("/root/solomon-bot/credentials")
TOKEN_FILE = CREDENTIALS_DIR / "youtube_token.json"
CLIENT_SECRETS_FILE = CREDENTIALS_DIR / "client_secrets.json"

# ── YouTube API constants ──────────────────────────────────────────────────────
YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
YOUTUBE_API_SERVICE_NAME = "youtube"
YOUTUBE_API_VERSION = "v3"

# Resumable upload chunk size: 10 MB
CHUNK_SIZE = 10 * 1024 * 1024

# YouTube video category IDs (common ones)
CATEGORY_IDS = {
    "film & animation": "1",
    "autos & vehicles": "2",
    "music": "10",
    "pets & animals": "15",
    "sports": "17",
    "travel & events": "19",
    "gaming": "20",
    "people & blogs": "22",
    "comedy": "23",
    "entertainment": "24",
    "news & politics": "25",
    "howto & style": "26",
    "education": "27",
    "science & technology": "28",
    "nonprofits & activism": "29",
}


class YouTubeUploader:
    """
    Manages authenticated YouTube Data API v3 sessions and video uploads.
    Tokens are loaded from disk and refreshed automatically.
    """

    def __init__(
        self,
        token_file: Optional[Path] = None,
        client_secrets_file: Optional[Path] = None,
    ):
        self.token_file = token_file or TOKEN_FILE
        self.client_secrets_file = client_secrets_file or CLIENT_SECRETS_FILE
        self._service = None

    # ── Authentication ─────────────────────────────────────────────────────────

    def _get_credentials(self):
        """Load and auto-refresh OAuth2 credentials from disk."""
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        if not self.token_file.exists():
            raise FileNotFoundError(
                f"Token file not found: {self.token_file}\n"
                "Run youtube_auth_setup.py first to complete the one-time OAuth authorization."
            )

        token_data = json.loads(self.token_file.read_text())

        creds = Credentials(
            token=token_data.get("token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=token_data.get("scopes"),
        )

        # Refresh if expired
        if creds.expired or not creds.valid:
            creds.refresh(Request())
            # Persist updated token back to disk
            token_data["token"] = creds.token
            self.token_file.write_text(json.dumps(token_data, indent=2))

        return creds

    def _get_service(self):
        """Return a cached (or newly built) YouTube API service object."""
        if self._service is None:
            from googleapiclient.discovery import build

            creds = self._get_credentials()
            self._service = build(
                YOUTUBE_API_SERVICE_NAME,
                YOUTUBE_API_VERSION,
                credentials=creds,
                cache_discovery=False,
            )
        return self._service

    # ── Core upload logic ──────────────────────────────────────────────────────

    def upload_video(
        self,
        video_path: str,
        title: str,
        description: str = "",
        tags: Optional[list] = None,
        category_id: str = "22",
        privacy: str = "private",
        thumbnail_path: Optional[str] = None,
        publish_at: Optional[str] = None,
        notify_subscribers: bool = True,
        language: str = "en",
    ) -> dict:
        """
        Upload a video to YouTube with full metadata.

        Args:
            video_path:          Absolute path to the video file.
            title:               Video title (max 100 chars).
            description:         Video description (max 5000 chars).
            tags:                List of tag strings (max 500 chars total).
            category_id:         YouTube category ID string (default "22" = People & Blogs).
            privacy:             "public", "private", or "unlisted".
            thumbnail_path:      Optional path to thumbnail image (JPG/PNG, max 2 MB).
            publish_at:          Optional ISO 8601 UTC datetime to schedule publish
                                 e.g. "2025-12-25T18:00:00Z". Forces privacy="private" until then.
            notify_subscribers:  Whether to notify channel subscribers (default True).
            language:            Default audio/caption language (default "en").

        Returns:
            dict with keys: video_id, url, title, privacy, status, thumbnail_uploaded
        """
        video_path = Path(video_path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # Validate title length
        if len(title) > 100:
            title = title[:97] + "..."

        # Validate description length
        if len(description) > 5000:
            description = description[:4997] + "..."

        # Build snippet
        snippet = {
            "title": title,
            "description": description,
            "tags": tags or [],
            "categoryId": category_id,
            "defaultLanguage": language,
            "defaultAudioLanguage": language,
        }

        # Build status
        status = {
            "privacyStatus": "private" if publish_at else privacy,
            "selfDeclaredMadeForKids": False,
            "notifySubscribers": notify_subscribers,
        }

        if publish_at:
            # Validate and normalize the datetime string
            publish_at = self._normalize_datetime(publish_at)
            status["publishAt"] = publish_at

        body = {"snippet": snippet, "status": status}

        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(str(video_path))
        if not mime_type:
            mime_type = "video/mp4"

        service = self._get_service()

        print(f"[YouTube] Starting upload: {video_path.name}")
        print(f"[YouTube] Title: {title}")
        print(f"[YouTube] Privacy: {status['privacyStatus']}")
        if publish_at:
            print(f"[YouTube] Scheduled publish: {publish_at}")

        from googleapiclient.http import MediaFileUpload

        media = MediaFileUpload(
            str(video_path),
            mimetype=mime_type,
            resumable=True,
            chunksize=CHUNK_SIZE,
        )

        insert_request = service.videos().insert(
            part=",".join(body.keys()),
            body=body,
            media_body=media,
        )

        video_id = self._resumable_upload(insert_request, video_path)

        result = {
            "video_id": video_id,
            "url": f"https://youtu.be/{video_id}",
            "studio_url": f"https://studio.youtube.com/video/{video_id}/edit",
            "title": title,
            "privacy": status["privacyStatus"],
            "publish_at": publish_at,
            "status": "uploaded",
            "thumbnail_uploaded": False,
        }

        # Upload thumbnail if provided
        if thumbnail_path:
            thumb_result = self.set_thumbnail(video_id, thumbnail_path)
            result["thumbnail_uploaded"] = thumb_result.get("success", False)
            result["thumbnail_url"] = thumb_result.get("url", "")

        print(f"[YouTube] Upload complete! Video ID: {video_id}")
        print(f"[YouTube] URL: {result['url']}")

        return result

    def _resumable_upload(self, insert_request, video_path: Path) -> str:
        """
        Execute a resumable upload with retry logic.
        Returns the video_id on success.
        """
        from googleapiclient.errors import HttpError

        response = None
        error = None
        retry = 0
        max_retries = 10
        file_size = video_path.stat().st_size

        while response is None:
            try:
                print(f"[YouTube] Uploading... ", end="", flush=True)
                status, response = insert_request.next_chunk()
                if status:
                    pct = int(status.resumable_progress / file_size * 100)
                    print(f"{pct}%", end="\r", flush=True)
                if response is not None:
                    print(f"\n[YouTube] Upload finished.")
                    if "id" in response:
                        return response["id"]
                    else:
                        raise RuntimeError(f"Unexpected upload response: {response}")
            except HttpError as e:
                if e.resp.status in [500, 502, 503, 504]:
                    error = e
                else:
                    raise
            except Exception as e:
                error = e

            if error is not None:
                retry += 1
                if retry > max_retries:
                    raise RuntimeError(f"Upload failed after {max_retries} retries: {error}")
                sleep_time = min(2 ** retry, 64)
                print(f"\n[YouTube] Retry {retry}/{max_retries} in {sleep_time}s... ({error})")
                time.sleep(sleep_time)
                error = None

    # ── Thumbnail ──────────────────────────────────────────────────────────────

    def set_thumbnail(self, video_id: str, thumbnail_path: str) -> dict:
        """
        Set a custom thumbnail for a video.

        Args:
            video_id:        YouTube video ID.
            thumbnail_path:  Path to JPG or PNG image (max 2 MB, min 1280x720 recommended).

        Returns:
            dict with keys: success, url, error
        """
        thumb_path = Path(thumbnail_path)
        if not thumb_path.exists():
            return {"success": False, "error": f"Thumbnail not found: {thumb_path}"}

        # Check file size (2 MB limit)
        if thumb_path.stat().st_size > 2 * 1024 * 1024:
            return {"success": False, "error": "Thumbnail exceeds 2 MB limit"}

        mime_type, _ = mimetypes.guess_type(str(thumb_path))
        if not mime_type:
            mime_type = "image/jpeg"

        try:
            from googleapiclient.http import MediaFileUpload

            service = self._get_service()
            media = MediaFileUpload(str(thumb_path), mimetype=mime_type)
            response = service.thumbnails().set(
                videoId=video_id, media_body=media
            ).execute()

            url = ""
            if "items" in response and response["items"]:
                url = response["items"][0].get("url", "")

            print(f"[YouTube] Thumbnail set for video {video_id}")
            return {"success": True, "url": url}

        except Exception as e:
            print(f"[YouTube] Thumbnail upload failed: {e}")
            return {"success": False, "error": str(e)}

    # ── Scheduling helper ──────────────────────────────────────────────────────

    def update_publish_time(self, video_id: str, publish_at: str) -> dict:
        """
        Update the scheduled publish time of an existing video.

        Args:
            video_id:    YouTube video ID.
            publish_at:  ISO 8601 UTC datetime string, e.g. "2025-12-25T18:00:00Z"

        Returns:
            dict with keys: success, video_id, publish_at, error
        """
        publish_at = self._normalize_datetime(publish_at)
        try:
            service = self._get_service()
            response = service.videos().update(
                part="status",
                body={
                    "id": video_id,
                    "status": {
                        "privacyStatus": "private",
                        "publishAt": publish_at,
                    },
                },
            ).execute()
            return {"success": True, "video_id": video_id, "publish_at": publish_at}
        except Exception as e:
            return {"success": False, "video_id": video_id, "error": str(e)}

    def make_public(self, video_id: str) -> dict:
        """Immediately publish a private/unlisted video."""
        try:
            service = self._get_service()
            response = service.videos().update(
                part="status",
                body={
                    "id": video_id,
                    "status": {"privacyStatus": "public"},
                },
            ).execute()
            return {"success": True, "video_id": video_id, "privacy": "public"}
        except Exception as e:
            return {"success": False, "video_id": video_id, "error": str(e)}

    # ── Utility ────────────────────────────────────────────────────────────────

    @staticmethod
    def _normalize_datetime(dt_str: str) -> str:
        """
        Normalize a datetime string to RFC 3339 / ISO 8601 UTC format.
        Accepts: "2025-12-25T18:00:00Z", "2025-12-25 18:00:00", "2025-12-25T18:00:00+00:00"
        """
        dt_str = dt_str.strip()
        # Already in correct format
        if dt_str.endswith("Z"):
            return dt_str
        # Replace space with T
        dt_str = dt_str.replace(" ", "T")
        # Add Z if no timezone info
        if "+" not in dt_str and dt_str.count("-") <= 2:
            dt_str += "Z"
        return dt_str

    def get_channel_info(self) -> dict:
        """Return basic info about the authenticated channel."""
        try:
            service = self._get_service()
            response = service.channels().list(part="snippet,statistics", mine=True).execute()
            if response.get("items"):
                item = response["items"][0]
                return {
                    "channel_id": item["id"],
                    "title": item["snippet"]["title"],
                    "subscriber_count": item["statistics"].get("subscriberCount", "hidden"),
                    "video_count": item["statistics"].get("videoCount", "0"),
                }
            return {"error": "No channel found"}
        except Exception as e:
            return {"error": str(e)}


# ── CrewAI Tool Integration ────────────────────────────────────────────────────

def _build_crewai_tool():
    """
    Conditionally build the CrewAI @tool decorator version.
    Falls back gracefully if crewai is not installed.
    """
    try:
        from crewai.tools import tool

        @tool("YouTube Upload")
        def youtube_upload_tool(params_json: str) -> str:
            """
            Upload a video to the Building Shultz YouTube channel.

            Input must be a JSON string with these fields:
              - video_path (required): Absolute path to the video file
              - title (required): Video title (max 100 chars)
              - description (optional): Video description
              - tags (optional): List of tag strings, e.g. ["construction", "DIY"]
              - thumbnail_path (optional): Absolute path to thumbnail image
              - publish_at (optional): ISO 8601 UTC datetime, e.g. "2025-12-25T18:00:00Z"
              - privacy (optional): "public", "private", or "unlisted" (default: "private")
              - category_id (optional): YouTube category ID (default: "22" = People & Blogs)
              - notify_subscribers (optional): true/false (default: true)

            Example input:
              {
                "video_path": "/root/solomon-bot/deliverables/my_video.mp4",
                "title": "Building a Deck - Part 1",
                "description": "Watch as we build a cedar deck from scratch.",
                "tags": ["deck building", "DIY", "construction"],
                "thumbnail_path": "/root/solomon-bot/deliverables/thumb.jpg",
                "publish_at": "2025-12-25T18:00:00Z",
                "privacy": "private"
              }

            Returns a JSON string with: video_id, url, studio_url, status, thumbnail_uploaded
            """
            try:
                params = json.loads(params_json)
            except json.JSONDecodeError as e:
                return json.dumps({"error": f"Invalid JSON input: {e}"})

            required = ["video_path", "title"]
            for field in required:
                if field not in params:
                    return json.dumps({"error": f"Missing required field: '{field}'"})

            try:
                uploader = YouTubeUploader()
                result = uploader.upload_video(
                    video_path=params["video_path"],
                    title=params["title"],
                    description=params.get("description", ""),
                    tags=params.get("tags", []),
                    category_id=str(params.get("category_id", "22")),
                    privacy=params.get("privacy", "private"),
                    thumbnail_path=params.get("thumbnail_path"),
                    publish_at=params.get("publish_at"),
                    notify_subscribers=params.get("notify_subscribers", True),
                )
                return json.dumps(result)
            except FileNotFoundError as e:
                return json.dumps({"error": str(e)})
            except Exception as e:
                return json.dumps({"error": f"Upload failed: {str(e)}"})

        return youtube_upload_tool

    except ImportError:
        return None


youtube_upload_tool = _build_crewai_tool()


# ── CLI entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Upload a video to Building Shultz YouTube channel")
    parser.add_argument("video_path", help="Path to the video file")
    parser.add_argument("--title", required=True, help="Video title")
    parser.add_argument("--description", default="", help="Video description")
    parser.add_argument("--tags", nargs="*", default=[], help="Tags (space-separated)")
    parser.add_argument("--thumbnail", default=None, help="Path to thumbnail image")
    parser.add_argument("--publish-at", default=None, help="Schedule publish time (ISO 8601 UTC)")
    parser.add_argument("--privacy", default="private", choices=["public", "private", "unlisted"])
    parser.add_argument("--category-id", default="22", help="YouTube category ID")
    parser.add_argument("--channel-info", action="store_true", help="Print channel info and exit")

    args = parser.parse_args()

    uploader = YouTubeUploader()

    if args.channel_info:
        info = uploader.get_channel_info()
        print(json.dumps(info, indent=2))
        sys.exit(0)

    result = uploader.upload_video(
        video_path=args.video_path,
        title=args.title,
        description=args.description,
        tags=args.tags,
        category_id=args.category_id,
        privacy=args.privacy,
        thumbnail_path=args.thumbnail,
        publish_at=args.publish_at,
    )

    print(json.dumps(result, indent=2))
