@echo off
setlocal enableextensions
title Solomon's Forge — Setup Remote Access (Cloudflare Tunnel)
color 0E
echo.
echo  =======================================================
echo   SOLOMON'S FORGE  -  REMOTE ACCESS via CLOUDFLARE
echo  =======================================================
echo.
echo  This installs cloudflared and opens a public URL pointed
echo  at your local Solomon's Forge server (port 3737).
echo.
echo  TIP: For private access, attach a Cloudflare Access
echo       policy in the Zero Trust dashboard once you see the
echo       URL — without that, anyone with the URL can reach it.
echo.
pause

rem ── 1. Install cloudflared via winget ───────────────────────────────────
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [1/2] Installing cloudflared . . .
  winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo  Could not install via winget. Download from:
    echo    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    pause
    exit /b 1
  )
) else (
  echo [1/2] cloudflared already installed.
)

rem ── 2. Start a quick tunnel (free, no Cloudflare account needed) ────────
echo.
echo [2/2] Starting tunnel to http://localhost:3737 . . .
echo  Watch for the trycloudflare.com URL below — bookmark it on your phone.
echo.
cloudflared tunnel --url http://localhost:3737
echo.
pause
endlocal
