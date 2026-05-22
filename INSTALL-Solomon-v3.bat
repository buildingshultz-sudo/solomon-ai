@echo off
echo Fixing Solomon PC Agent session...

:: Kill any existing node processes
taskkill /f /im node.exe 2>nul

:: Remove old scheduled task
schtasks /delete /tn "SolomonAgent" /f 2>nul

:: Create a launcher VBS that sets the working directory properly
echo Set WshShell = CreateObject("WScript.Shell") > "C:\Users\Ashle\Desktop\FINAL FIX\launch-solomon.vbs"
echo WshShell.CurrentDirectory = "C:\Users\Ashle\Desktop\FINAL FIX" >> "C:\Users\Ashle\Desktop\FINAL FIX\launch-solomon.vbs"
echo WshShell.Run "cmd /c node solomon-agent.js", 0, False >> "C:\Users\Ashle\Desktop\FINAL FIX\launch-solomon.vbs"

:: Create scheduled task using the VBS launcher
schtasks /create /tn "SolomonAgent" /tr "wscript.exe \"C:\Users\Ashle\Desktop\FINAL FIX\launch-solomon.vbs\"" /sc ONLOGON /ru "Ashle" /rl LIMITED /f

:: Start it now
schtasks /run /tn "SolomonAgent"

echo.
echo Done! Close this window.
pause
