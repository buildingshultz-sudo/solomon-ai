@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Solomon's Forge - Telegram Bot Setup

cd /d "%~dp0"

cls
echo.
echo  ============================================================
echo               SOLOMON'S FORGE - Telegram bot setup
echo  ============================================================
echo.
echo   This wizard will:
echo     1. Open Telegram's BotFather so you can create a bot
echo     2. Ask you to paste the bot token it gives you
echo     3. Save the token into your .env file
echo     4. (Optional) save your personal chat ID so only you can
echo        message the bot
echo.
echo   --------------------------------------------------------
echo   STEP 1 - Create a bot
echo   --------------------------------------------------------
echo   I'm going to open BotFather in Telegram now.
echo   Inside BotFather:
echo       a) Send the command:   /newbot
echo       b) Pick a display name (anything, e.g. "Solomon Forge")
echo       c) Pick a username ending in "bot" (e.g. shultz_solomon_bot)
echo       d) BotFather will reply with a long token like:
echo            123456789:AAH4nXXXXXXXXXXXXXXXXXXXXXXXXXXX
echo       e) COPY that token.
echo.
pause
start "" "https://t.me/BotFather"
echo.
echo   --------------------------------------------------------
echo   STEP 2 - Paste the token below
echo   --------------------------------------------------------
echo.
set "TOKEN="
set /p "TOKEN=Paste your bot token and press ENTER: "

if "!TOKEN!"=="" (
  echo.
  echo   No token entered. Nothing was saved. Run this wizard again whenever you're ready.
  pause
  exit /b 1
)

echo.
echo   --------------------------------------------------------
echo   STEP 3 (optional) - Lock the bot to your chat ID
echo   --------------------------------------------------------
echo   To find your numeric chat ID:
echo     1) Open Telegram, search for the bot you just made
echo     2) Send it any message (e.g. "hi")
echo     3) In a browser, visit:
echo            https://api.telegram.org/bot!TOKEN!/getUpdates
echo     4) Look for "chat":{"id": <NUMBER> ...}
echo.
echo   Leave this blank to allow ANY Telegram user to message your bot.
echo.
set "CHATID="
set /p "CHATID=Paste your chat ID (or just press ENTER to skip): "

REM ── Rewrite .env with the new TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_CHAT_ID ──
if not exist .env (
  echo TELEGRAM_BOT_TOKEN=!TOKEN!>.env
  if not "!CHATID!"=="" echo TELEGRAM_ALLOWED_CHAT_ID=!CHATID!>>.env
  goto :done
)

set "TMP=.env.new"
if exist "%TMP%" del "%TMP%"
set "WROTE_TOKEN=0"
set "WROTE_CHAT=0"
for /f "usebackq tokens=* delims=" %%L in (".env") do (
  set "LINE=%%L"
  set "KEY="
  for /f "tokens=1 delims==" %%K in ("!LINE!") do set "KEY=%%K"
  if /I "!KEY!"=="TELEGRAM_BOT_TOKEN" (
    echo TELEGRAM_BOT_TOKEN=!TOKEN!>>"%TMP%"
    set "WROTE_TOKEN=1"
  ) else if /I "!KEY!"=="TELEGRAM_ALLOWED_CHAT_ID" (
    if not "!CHATID!"=="" (
      echo TELEGRAM_ALLOWED_CHAT_ID=!CHATID!>>"%TMP%"
    ) else (
      echo TELEGRAM_ALLOWED_CHAT_ID=>>"%TMP%"
    )
    set "WROTE_CHAT=1"
  ) else (
    echo !LINE!>>"%TMP%"
  )
)
if "!WROTE_TOKEN!"=="0" echo TELEGRAM_BOT_TOKEN=!TOKEN!>>"%TMP%"
if "!WROTE_CHAT!"=="0" if not "!CHATID!"=="" echo TELEGRAM_ALLOWED_CHAT_ID=!CHATID!>>"%TMP%"

move /Y "%TMP%" .env >nul

:done
echo.
echo   --------------------------------------------------------
echo   DONE. Saved to .env
echo   --------------------------------------------------------
echo.
echo   Restart Solomon's Forge (close launch.bat, run it again)
echo   and message your bot from Telegram. The agent will reply.
echo.
pause
endlocal
