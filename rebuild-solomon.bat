@echo off
title Rebuild Solomon's Forge
echo ============================================
echo  Rebuilding Solomon's Forge...
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Installing any new packages...
call npm install
if errorlevel 1 ( echo FAILED: npm install & pause & exit /b 1 )

echo.
echo [2/3] Building...
call npm run build
if errorlevel 1 ( echo FAILED: npm run build & pause & exit /b 1 )

echo.
echo [3/3] Restarting Solomon service...
C:\Tools\nssm\nssm.exe restart SolomonForge
if errorlevel 1 (
    echo Could not restart via NSSM. Try restarting manually.
    echo Right-click Solomon in your system tray and restart, or reboot.
) else (
    echo Solomon restarted successfully.
)

echo.
echo ============================================
echo  Done! Solomon is running with the new code.
echo ============================================
pause
