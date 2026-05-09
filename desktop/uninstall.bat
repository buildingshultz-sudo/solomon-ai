@echo off
REM ============================================================================
REM   Solomon's Forge - uninstall
REM
REM   Stops the local server, removes the install directory, removes the
REM   Desktop and Start Menu shortcuts. Leaves the data folder
REM   (%APPDATA%\SolomonForge\data) intact unless you pass --purge.
REM ============================================================================
setlocal
title Solomon's Forge - Uninstall

set "INSTALL_DIR=%LOCALAPPDATA%\SolomonForge"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
set "DATA_DIR=%APPDATA%\SolomonForge"

echo  Stopping any running Solomon's Forge server on :3737 ...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3737" ^| findstr LISTENING') do (
    taskkill /F /PID %%P >nul 2>nul
)

echo  Removing shortcuts ...
del /F /Q "%DESKTOP%\Solomon's Forge.lnk" 2>nul
del /F /Q "%STARTMENU%\Solomon's Forge.lnk" 2>nul
REM Remove legacy (pre-rename) shortcut name as well, just in case.
del /F /Q "%DESKTOP%\Solomon Forge.lnk" 2>nul
del /F /Q "%STARTMENU%\Solomon Forge.lnk" 2>nul

echo  Removing install dir %INSTALL_DIR% ...
if exist "%INSTALL_DIR%" rmdir /S /Q "%INSTALL_DIR%"

if /I "%~1"=="--purge" (
    echo  Purging data folder %DATA_DIR% ...
    if exist "%DATA_DIR%" rmdir /S /Q "%DATA_DIR%"
)

echo.
echo  Solomon's Forge has been removed.
echo  (Your conversations / memories are preserved in %DATA_DIR% unless --purge was used.)
echo.
pause
endlocal
