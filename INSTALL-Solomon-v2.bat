@echo off
echo Fixing Solomon PC Agent session...
taskkill /f /im node.exe 2>nul
schtasks /delete /tn "SolomonAgent" /f 2>nul
schtasks /create /tn "SolomonAgent" /tr "cmd /c cd /d \"C:\Users\Ashle\Desktop\FINAL FIX\" && node solomon-agent.js" /sc ONLOGON /ru "Ashle" /rl LIMITED /f
schtasks /run /tn "SolomonAgent"
echo Done! Close this window.
pause
