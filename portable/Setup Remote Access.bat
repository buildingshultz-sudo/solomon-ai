@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Solomon's Forge - Remote Access (Tailscale)

cd /d "%~dp0"

cls
echo.
echo  ============================================================
echo            SOLOMON'S FORGE - Remote Access via Tailscale
echo  ============================================================
echo.
echo   Tailscale is a free, secure VPN that lets your phone reach
echo   this PC from anywhere (cellular, hotel WiFi, etc) -- as if
echo   the phone were sitting on the same home network.
echo.
echo   This wizard will:
echo     1. Install Tailscale on this PC (one-time, ~30 MB)
echo     2. Sign you in via your browser
echo     3. Tell you the IP address to use from your phone
echo.
echo   On your PHONE you'll then need to:
echo     - Install "Tailscale" from the App Store / Google Play
echo     - Sign in with the SAME account you use here
echo     - Open http://[that IP]:3737/ in your phone browser
echo     - Tap Share -> Add to Home Screen
echo.
pause

REM ── Already installed? ─────────────────────────────────────────────────
where tailscale >nul 2>nul
if not errorlevel 1 (
  echo.
  echo   Tailscale is already installed. Skipping download.
  goto :start_ts
)

echo.
echo   --------------------------------------------------------
echo   STEP 1 - Downloading Tailscale installer
echo   --------------------------------------------------------
echo.

set "INSTALLER=%TEMP%\tailscale-setup.exe"
echo   Downloading from https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe
echo   (this can take 30-60 seconds)...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe' -OutFile '%INSTALLER%'; exit 0 } catch { Write-Host $_; exit 1 }"

if errorlevel 1 (
  echo.
  echo   Download failed. You can install Tailscale manually instead:
  echo       https://tailscale.com/download/windows
  echo   Then re-run this wizard.
  pause
  exit /b 1
)

echo.
echo   --------------------------------------------------------
echo   STEP 2 - Running the installer (a UAC prompt will appear)
echo   --------------------------------------------------------
echo.
"%INSTALLER%"

REM ── PATH might not refresh in this shell yet, so try common locations ──
where tailscale >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\Tailscale\tailscale.exe" (
    set "PATH=%PATH%;%ProgramFiles%\Tailscale"
  )
)

:start_ts
echo.
echo   --------------------------------------------------------
echo   STEP 3 - Signing in (a browser window will open)
echo   --------------------------------------------------------
echo.
tailscale up

echo.
echo   --------------------------------------------------------
echo   DONE. Your Tailscale IP for this PC is:
echo   --------------------------------------------------------
for /f "tokens=*" %%T in ('tailscale ip -4 2^>nul') do (
  echo       http://%%T:3737/
)
echo.
echo   Now on your PHONE:
echo     1) Install Tailscale (App Store / Google Play)
echo     2) Sign in with the SAME account
echo     3) Open the URL above in Safari/Chrome
echo     4) Tap Share -^> Add to Home Screen
echo.
echo   Make sure launch.bat is RUNNING on this PC whenever you
echo   want to use the app from your phone.
echo.
pause
endlocal
