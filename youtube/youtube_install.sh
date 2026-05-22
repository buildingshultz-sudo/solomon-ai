#!/bin/bash
# ============================================================
# YouTube API v3 Dependency Installer for Solomon VPS
# ============================================================
# Run this once on the VPS to install required Python packages
# and prepare the credentials directory.
#
# Usage: bash youtube_install.sh

set -e

echo "============================================================"
echo "  Installing YouTube Data API v3 dependencies"
echo "============================================================"

CREDS_DIR="/root/solomon-bot/credentials"
VENV_PIP="/root/solomon-crewai/venv/bin/pip"

# ── Create credentials directory ──────────────────────────────
mkdir -p "$CREDS_DIR"
chmod 700 "$CREDS_DIR"
echo "[OK] Credentials directory: $CREDS_DIR"

# ── Install packages into the CrewAI venv ─────────────────────
if [ -f "$VENV_PIP" ]; then
    echo "[INFO] Installing into CrewAI venv..."
    "$VENV_PIP" install --quiet \
        google-api-python-client \
        google-auth-httplib2 \
        google-auth-oauthlib
    echo "[OK] Packages installed in venv"
else
    echo "[WARN] CrewAI venv not found at $VENV_PIP"
    echo "[INFO] Installing system-wide with pip3..."
    pip3 install --quiet \
        google-api-python-client \
        google-auth-httplib2 \
        google-auth-oauthlib
    echo "[OK] Packages installed system-wide"
fi

# ── Copy module files ──────────────────────────────────────────
DEST_DIR="/root/solomon-bot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cp "$SCRIPT_DIR/youtube_uploader.py" "$DEST_DIR/"
cp "$SCRIPT_DIR/youtube_auth_setup.py" "$DEST_DIR/"
chmod +x "$DEST_DIR/youtube_uploader.py"
chmod +x "$DEST_DIR/youtube_auth_setup.py"
echo "[OK] Module files copied to $DEST_DIR"

# ── Copy to solomon-crewai for agent use ──────────────────────
CREWAI_DIR="/root/solomon-crewai"
if [ -d "$CREWAI_DIR" ]; then
    cp "$SCRIPT_DIR/youtube_uploader.py" "$CREWAI_DIR/"
    echo "[OK] youtube_uploader.py copied to $CREWAI_DIR"
fi

echo ""
echo "============================================================"
echo "  Installation complete!"
echo "============================================================"
echo ""
echo "NEXT STEP: Complete the one-time OAuth authorization:"
echo ""
echo "  1. Place your client_secrets.json in:"
echo "     $CREDS_DIR/client_secrets.json"
echo ""
echo "  2. Run the auth setup script:"
echo "     cd $DEST_DIR && python3 youtube_auth_setup.py"
echo ""
echo "  3. Visit the URL shown, sign in as buildingshultz@gmail.com,"
echo "     paste the code back into the terminal."
echo ""
echo "  After that, Solomon can upload videos automatically forever."
echo "============================================================"
