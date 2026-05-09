@echo off
REM ============================================================================
REM   Solomon Forge - one-click Windows installer
REM
REM   What this does (in order):
REM     1. Verify or install Node.js 22 (winget) and pnpm.
REM     2. Clone or pull the Solomon Forge repo into %LOCALAPPDATA%\SolomonForge.
REM     3. Run `pnpm install` and `pnpm build` to produce dist/.
REM     4. Drop a Solomon Forge.lnk shortcut on the user's Desktop pointing at
REM        the launch.bat (which boots the local Node server + opens the app
REM        in the user's default browser running in app-mode).
REM     5. Optionally suggest installing Ollama for free, local LLMs.
REM
REM   Re-run safely - everything is idempotent.
REM ============================================================================

setlocal ENABLEDELAYEDEXPANSION
title Solomon Forge - Installer
color 0E
echo.
echo  ============================================================
echo    SOLOMON FORGE  -  Local AI chief of staff
echo    Building Shultz / Shultz Enterprises
echo  ============================================================
echo.

REM --- 1. Node.js ----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [Solomon Forge] Node.js not found - installing via winget...
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo.
        echo [Solomon Forge] Could not install Node.js automatically.
        echo Please install Node.js 22 LTS from https://nodejs.org/ then re-run this installer.
        pause
        exit /b 1
    )
    REM Refresh PATH in this shell
    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul ^| find "PATH"') do set "USERPATH=%%B"
    set "PATH=%USERPATH%;%PATH%"
)
echo [Solomon Forge] Node: 
node --version

REM --- 2. pnpm -------------------------------------------------------------
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [Solomon Forge] Installing pnpm...
    call npm install -g pnpm
)
echo [Solomon Forge] pnpm:
pnpm --version

REM --- 3. Clone / update repo ---------------------------------------------
set "INSTALL_DIR=%LOCALAPPDATA%\SolomonForge"
set "REPO_URL=https://github.com/buildingshultz-sudo/solomon-ai.git"

if not exist "%INSTALL_DIR%" (
    echo [Solomon Forge] Cloning into %INSTALL_DIR% ...
    where git >nul 2>nul
    if errorlevel 1 (
        echo [Solomon Forge] git not found - installing via winget...
        winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
    )
    git clone "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [Solomon Forge] git clone failed. If the repo is private, run:
        echo     gh auth login
        echo and re-run this installer.
        pause
        exit /b 1
    )
) else (
    echo [Solomon Forge] Updating existing install at %INSTALL_DIR% ...
    pushd "%INSTALL_DIR%"
    git pull --rebase --autostash
    popd
)

REM --- 4. Install deps + build --------------------------------------------
pushd "%INSTALL_DIR%"
echo [Solomon Forge] Installing dependencies (this can take a few minutes the first time)...
call pnpm install --prod=false
if errorlevel 1 (
    echo [Solomon Forge] pnpm install failed.
    popd
    pause
    exit /b 1
)
echo [Solomon Forge] Building app bundle...
call pnpm build
if errorlevel 1 (
    echo [Solomon Forge] Build failed - see errors above.
    popd
    pause
    exit /b 1
)

REM --- 5. Write a default .env if none exists -----------------------------
if not exist "%INSTALL_DIR%\.env" (
    echo [Solomon Forge] Writing default .env (Ollama / local mode)...
    > "%INSTALL_DIR%\.env" (
        echo SOLOMON_LOCAL=1
        echo SOLOMON_DATA_DIR=%APPDATA%\SolomonForge\data
        echo PORT=3737
        echo JWT_SECRET=solomon-forge-local-secret
        echo OWNER_PASSWORD=forge
        echo MODEL_PROVIDER=ollama
        echo OLLAMA_BASE_URL=http://127.0.0.1:11434
        echo OLLAMA_MODEL=llama3.1:8b
    )
)
if not exist "%APPDATA%\SolomonForge\data" mkdir "%APPDATA%\SolomonForge\data"
popd

REM --- 6. Place launch.bat + Desktop shortcut -----------------------------
copy /Y "%INSTALL_DIR%\desktop\launch.bat" "%INSTALL_DIR%\launch.bat" >nul

set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" set "DESKTOP=%PUBLIC%\Desktop"
set "SHORTCUT=%DESKTOP%\Solomon Forge.lnk"

REM Create the .lnk via PowerShell (idempotent overwrite).
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%');" ^
  "$s.TargetPath='%INSTALL_DIR%\launch.bat';" ^
  "$s.WorkingDirectory='%INSTALL_DIR%';" ^
  "$s.IconLocation='%INSTALL_DIR%\electron\icon.ico,0';" ^
  "$s.WindowStyle=7;" ^
  "$s.Description='Solomon Forge - local AI chief of staff';" ^
  "$s.Save();"

REM Start Menu shortcut too.
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTMENU%\Solomon Forge.lnk');" ^
  "$s.TargetPath='%INSTALL_DIR%\launch.bat';" ^
  "$s.WorkingDirectory='%INSTALL_DIR%';" ^
  "$s.IconLocation='%INSTALL_DIR%\electron\icon.ico,0';" ^
  "$s.WindowStyle=7;" ^
  "$s.Description='Solomon Forge';" ^
  "$s.Save();"

REM --- 7. Optional: nudge for Ollama --------------------------------------
where ollama >nul 2>nul
if errorlevel 1 (
    echo.
    echo  ============================================================
    echo    OPTIONAL - Install Ollama for free local AI
    echo  ============================================================
    echo    Solomon Forge is configured for free/local mode by default.
    echo    To activate it, install Ollama and pull a model:
    echo.
    echo      1. https://ollama.com/download/windows
    echo      2. After install, open PowerShell and run:
    echo            ollama pull llama3.1:8b
    echo.
    echo    Without Ollama you can still use Solomon Forge - just open
    echo    Settings -^> Model Provider -^> OpenAI and paste your API key.
    echo  ============================================================
)

echo.
echo  ============================================================
echo    DONE.  Double-click 'Solomon Forge' on your Desktop to run.
echo  ============================================================
echo.
echo  Install location: %INSTALL_DIR%
echo  Data folder:      %APPDATA%\SolomonForge\data
echo  Server URL:       http://127.0.0.1:3737
echo.
pause
endlocal
