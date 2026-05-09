@echo off
REM ============================================================================
REM   Solomon's Forge - install Ollama and pull a default model.
REM
REM   Run this once if you want 100% free, offline operation. Solomon's Forge
REM   itself works without it (toggle the Settings page to OpenAI), but Ollama
REM   gives you Llama 3 / Mistral / Qwen running on this PC at zero cost.
REM ============================================================================
setlocal
title Solomon's Forge - Ollama setup

where ollama >nul 2>nul
if errorlevel 1 (
    echo [Solomon's Forge] Installing Ollama via winget ...
    winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo.
        echo [Solomon's Forge] Could not install Ollama via winget.
        echo Please download manually from https://ollama.com/download/windows
        pause
        exit /b 1
    )
) else (
    echo [Solomon's Forge] Ollama already installed.
)

echo.
echo [Solomon's Forge] Pulling llama3.1:8b (about 5 GB, one-time) ...
ollama pull llama3.1:8b

echo.
echo [Solomon's Forge] Done. Open Solomon's Forge -^> Settings -^> Model Provider
echo and confirm Ollama is selected. You're now running 100%% free, offline.
echo.
pause
endlocal
