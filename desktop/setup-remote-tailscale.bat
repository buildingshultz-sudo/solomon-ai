@echo off
setlocal enableextensions
title Solomon's Forge — Setup Remote Access (Tailscale)
color 0E
echo.
echo  =======================================================
echo   SOLOMON'S FORGE  -  REMOTE ACCESS via TAILSCALE
echo  =======================================================
echo.
echo  This script installs Tailscale, signs you in, and prints
echo  the IP your phone will use to reach Solomon's Forge.
echo.
pause

rem ── 1. Install Tailscale via winget ─────────────────────────────────────
where tailscale >nul 2>nul
if errorlevel 1 (
  echo [1/3] Installing Tailscale via winget . . .
  winget install --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo  Could not install via winget. Download manually from:
    echo    https://tailscale.com/download/windows
    pause
    exit /b 1
  )
) else (
  echo [1/3] Tailscale already installed.
)

rem ── 2. Sign in (opens browser for Google/Microsoft/GitHub OAuth) ────────
echo.
echo [2/3] Signing into Tailscale (browser will open) . . .
"%ProgramFiles%\Tailscale\tailscale.exe" up --accept-routes --hostname=solomons-forge
if errorlevel 1 (
  echo.
  echo  Tailscale sign-in failed or was cancelled.
  pause
  exit /b 1
)

rem ── 3. Print the Tailscale IP ──────────────────────────────────────────
echo.
echo [3/3] Your Tailscale IP for this PC:
echo.
"%ProgramFiles%\Tailscale\tailscale.exe" ip -4
echo.
echo  =======================================================
echo   On your phone:
echo     1. Install Tailscale from the App Store / Play Store
echo     2. Sign in with the SAME account
echo     3. Open  http://[the IP above]:3737
echo     4. Tap browser menu - Add to Home Screen
echo  =======================================================
echo.
pause
endlocal
