@echo off
REM ============================================================================
REM   Solomon's Forge - launcher
REM
REM   Boots the local Node server (hidden), waits for it to be ready, and then
REM   opens Microsoft Edge / Google Chrome / fallback in --app mode so the
REM   browser chrome disappears and the user sees a real-app window.
REM
REM   This is what the desktop shortcut points at.
REM ============================================================================

setlocal ENABLEDELAYEDEXPANSION

set "INSTALL_DIR=%~dp0"
if "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"
cd /d "%INSTALL_DIR%"

set "PORT=3737"
set "URL=http://127.0.0.1:%PORT%/"

REM Make sure the server isn't already running before we spawn another one.
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -lt 500){exit 0}}catch{exit 1}"
if errorlevel 1 (
    REM Server not up - start it as a background process via VBS so no window appears.
    echo CreateObject("Wscript.Shell").Run "cmd /c node dist\index.js > %APPDATA%\SolomonForge\server.log 2^>^&1", 0, False > "%TEMP%\solomon-forge-spawn.vbs"

    REM Apply env from .env
    if exist .env (
        for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
            if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
        )
    )
    set "NODE_ENV=production"
    set "SOLOMON_LOCAL=1"
    set "PORT=%PORT%"
    if "%SOLOMON_DATA_DIR%"=="" set "SOLOMON_DATA_DIR=%APPDATA%\SolomonForge\data"

    cscript //nologo "%TEMP%\solomon-forge-spawn.vbs" >nul 2>nul

    REM Poll /api/health until ready (max ~30s).
    set /a TRIES=0
    :waitloop
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -lt 500){exit 0}}catch{exit 1}"
    if not errorlevel 1 goto ready
    set /a TRIES+=1
    if %TRIES% lss 30 goto waitloop
    echo [Solomon's Forge] Server did not respond after 30s. Check %APPDATA%\SolomonForge\server.log
    pause
    exit /b 1
)
:ready

REM --- Open in app mode (real-window feel) --------------------------------
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROMEX86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE%" (
    start "" "%EDGE%" --app=%URL% --window-size=1400,900 --user-data-dir="%APPDATA%\SolomonForge\edge-profile"
    goto :eof
)
if exist "%CHROME%" (
    start "" "%CHROME%" --app=%URL% --window-size=1400,900 --user-data-dir="%APPDATA%\SolomonForge\chrome-profile"
    goto :eof
)
if exist "%CHROMEX86%" (
    start "" "%CHROMEX86%" --app=%URL% --window-size=1400,900 --user-data-dir="%APPDATA%\SolomonForge\chrome-profile"
    goto :eof
)

REM Fallback: just open default browser.
start "" "%URL%"
endlocal
