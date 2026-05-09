@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Solomon's Forge

REM ── Move to this script's folder so .env / dist / node_modules resolve ───
cd /d "%~dp0"

REM ── Sanity check: Node must be installed ────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Solomon's Forge] Node.js was not found on this PC.
  echo                   Install the LTS build from https://nodejs.org/  ^(it's free^)
  echo                   then double-click this launch.bat again.
  echo.
  pause
  exit /b 1
)

REM ── Discover this PC's LAN IPv4 ────────────────────────────────────────
set "LAN_IP="
for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /R /C:"IPv4 Address"') do (
  for /f "tokens=* delims= " %%J in ("%%I") do (
    if not defined LAN_IP if not "%%J"=="127.0.0.1" set "LAN_IP=%%J"
  )
)

REM ── Discover Tailscale IPv4 (if Tailscale is installed) ────────────────
set "TS_IP="
where tailscale >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=*" %%T in ('tailscale ip -4 2^>nul') do (
    if not defined TS_IP set "TS_IP=%%T"
  )
)

REM ── Read PORT from .env (fall back to 3737) ────────────────────────────
set "PORT=3737"
if exist .env (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /I "%%A"=="PORT" set "PORT=%%B"
  )
)

cls
echo.
echo  ============================================================
echo                   SOLOMON'S FORGE  -  starting
echo  ============================================================
echo.
echo   On this PC          :  http://localhost:%PORT%/
if defined LAN_IP echo   On your home Wi-Fi  :  http://%LAN_IP%:%PORT%/
if defined TS_IP  echo   From anywhere       :  http://%TS_IP%:%PORT%/   ^(Tailscale^)
if not defined TS_IP echo   From anywhere       :  ^(run "Setup Remote Access.bat" first^)
echo.
echo   Tip: open the URL on your phone, then "Add to Home Screen"
echo        to install Solomon's Forge as an app icon.
echo.
echo   Closing this window stops the app.
echo  ============================================================
echo.

REM ── Launch the server. NODE_ENV / SOLOMON_LOCAL come from .env via dotenv ─
node dist\index.js

echo.
echo Solomon's Forge has stopped.
pause
endlocal
