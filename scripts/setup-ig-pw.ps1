# Solomon Instagram Playwright auth - one-shot PC setup
# Pull this from the VPS and run it. Drives your REAL installed Google Chrome
# using your existing User Data / Default profile (where you are already signed
# in to Instagram). No login UI appears - Chrome opens already authenticated.
# Captures the IG session and uploads it to the VPS so Solomon can post.
#
# Pure ASCII (no box-drawing / em-dashes) so PS 5.1 always parses cleanly.

$ErrorActionPreference = 'Stop'
$VpsHost     = 'root@167.99.237.26'
$SshKey      = 'C:\Users\Ashle\.ssh\hostinger_solomon'
$Workdir     = Join-Path $env:TEMP 'solomon-pw-auth'
$ScriptName  = 'capture_ig_pw_auth.js'
$StateFile   = '.pw_state_instagram.json'

Write-Host ''
Write-Host '=== Solomon Instagram Playwright auth setup ===' -ForegroundColor Cyan
Write-Host "Working directory: $Workdir"
Write-Host ''

if (-not (Test-Path $Workdir)) {
    New-Item -ItemType Directory -Path $Workdir | Out-Null
}
Set-Location $Workdir

# Step 1 - confirm Node.js
try { $nodeVersion = node --version } catch {
    Write-Host '[ERROR] Node.js is not installed on this PC.' -ForegroundColor Red
    Write-Host 'Install it from https://nodejs.org (LTS), then re-run this script.'
    exit 1
}
Write-Host "Node $nodeVersion detected."

# Step 2 - confirm Google Chrome is installed (we drive YOUR Chrome, not Chromium)
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chromeExe) {
    Write-Host '[ERROR] Google Chrome not found in the usual locations.' -ForegroundColor Red
    Write-Host 'Install Chrome from https://www.google.com/chrome/ and re-run.'
    exit 1
}
Write-Host "Google Chrome detected: $chromeExe"

# Step 2b - confirm the User Data directory exists
$userDataDir = "$env:LocalAppData\Google\Chrome\User Data"
if (-not (Test-Path $userDataDir)) {
    Write-Host "[ERROR] Chrome User Data directory not found at: $userDataDir" -ForegroundColor Red
    Write-Host 'Open Chrome at least once normally so the profile is created, then re-run.'
    exit 1
}
Write-Host "Chrome profile dir found: $userDataDir"

# Step 3 - Chrome cannot be running while we use its profile. Detect + offer to close.
$running = Get-Process -Name 'chrome' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host ''
    Write-Host "[NOTICE] Google Chrome is currently running ($($running.Count) process(es))." -ForegroundColor Yellow
    Write-Host '         Playwright needs the profile unlocked. Save any open tabs (Ctrl+Shift+T can'
    Write-Host '         restore them later), then choose:'
    Write-Host ''
    Write-Host '         [Y] Close Chrome for me and continue'
    Write-Host '         [N] Exit so I can close Chrome manually'
    Write-Host ''
    $answer = Read-Host 'Close Chrome now? (Y/N)'
    if ($answer -notmatch '^(y|yes)$') {
        Write-Host 'Exit. Close all Chrome windows manually (check the system tray too) and re-run.' -ForegroundColor Yellow
        exit 0
    }
    Write-Host 'Closing Chrome...' -ForegroundColor Cyan
    try {
        Stop-Process -Name 'chrome' -Force -ErrorAction Stop
    } catch {
        Write-Host "[ERROR] Could not close Chrome: $_" -ForegroundColor Red
        exit 1
    }
    Start-Sleep -Seconds 2
    if (Get-Process -Name 'chrome' -ErrorAction SilentlyContinue) {
        Write-Host '[ERROR] Chrome still running after Stop-Process. Close it manually and re-run.' -ForegroundColor Red
        exit 1
    }
    Write-Host 'Chrome closed.' -ForegroundColor Green
}

# Step 4 - pull the latest capture script from the VPS
Write-Host ''
Write-Host 'Downloading capture script from VPS...' -ForegroundColor Cyan
& scp -i $SshKey "$VpsHost`:/root/solomon-v4/scripts/$ScriptName" "$ScriptName"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] scp failed. Check that the SSH key path is correct and the VPS is reachable.' -ForegroundColor Red
    exit 1
}

# Step 5 - install the playwright npm package once
if (-not (Test-Path 'node_modules\playwright')) {
    Write-Host ''
    Write-Host 'Installing Playwright npm package (one-time, ~30s, no big download)...' -ForegroundColor Cyan
    if (-not (Test-Path 'package.json')) {
        & npm init -y | Out-Null
    }
    & npm install playwright --silent
    if ($LASTEXITCODE -ne 0) { Write-Host '[ERROR] npm install playwright failed.' -ForegroundColor Red; exit 1 }
} else {
    Write-Host 'Playwright already installed in workspace - skipping install.'
}

# Step 6 - run the capture (opens YOUR signed-in Chrome at instagram.com)
Write-Host ''
Write-Host '=========================================================' -ForegroundColor Yellow
Write-Host ' Your Google Chrome will open in a moment.'                  -ForegroundColor Yellow
Write-Host ' Instagram should load with your home feed (signed in).'    -ForegroundColor Yellow
Write-Host ' If you see a login page: sign in normally - it remembers.' -ForegroundColor Yellow
Write-Host ' Then return here and press Enter to save the session.'     -ForegroundColor Yellow
Write-Host '=========================================================' -ForegroundColor Yellow
Write-Host ''
& node $ScriptName
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] Capture script exited with an error. See message above.' -ForegroundColor Red
    exit 1
}

# Step 7 - upload the saved session file back to the VPS
if (-not (Test-Path $StateFile)) {
    Write-Host "[ERROR] $StateFile was not created. Did you confirm you were signed in before pressing Enter?" -ForegroundColor Red
    exit 1
}
Write-Host ''
Write-Host 'Uploading session file to VPS...' -ForegroundColor Cyan
& scp -i $SshKey $StateFile "$VpsHost`:/root/solomon-v4/$StateFile"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] scp upload failed.' -ForegroundColor Red
    exit 1
}
& ssh -i $SshKey $VpsHost "chmod 600 /root/solomon-v4/$StateFile" 2>$null

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ' Done. Solomon can now post to Instagram (feed).'           -ForegroundColor Green
Write-Host '    Test it via the post_via_browser tool after Jed has'    -ForegroundColor Green
Write-Host '    approved the tools.js wiring.'                          -ForegroundColor Green
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ''
