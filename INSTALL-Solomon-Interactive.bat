@echo off
echo Fixing Solomon PC Agent to run in your desktop session...
echo.
taskkill /f /im node.exe 2>nul
schtasks /delete /tn "SolomonAgent" /f 2>nul
schtasks /create /tn "SolomonAgent" /tr "node \"C:\Users\Ashle\Desktop\FINAL FIX\solomon-agent.js\"" /sc ONLOGON /ru "Ashle" /rl LIMITED /f
schtasks /run /tn "SolomonAgent"
echo.
echo Done! Solomon Agent now runs in your session. GUI commands will appear on screen.
pause
