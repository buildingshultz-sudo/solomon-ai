# Solomon YouTube Playwright auth — one-shot PC setup
# Pull this from the VPS and run it. It installs Playwright + Chromium into a
# temp workspace (one-time, ~250MB), opens a browser for you to sign into
# YouTube as the Building Shultz brand channel, then uploads the resulting
# session file to the VPS so Solomon can post on your behalf.

$ErrorActionPreference = 'Stop'
$VpsHost = 'root@167.99.237.26'
$SshKey  = 'C:\Users\Ashle\.ssh\hostinger_solomon'
$Workdir = Join-Path $env:TEMP 'solomon-pw-auth'
$ScriptName = 'capture_yt_pw_auth.js'
$StateFile = '.pw_state_youtube.json'

Write-Host ''
Write-Host '=== Solomon YouTube Playwright auth setup ===' -ForegroundColor Cyan
Write-Host "Working directory: $Workdir"
Write-Host ''

if (-not (Test-Path $Workdir)) {
    New-Item -ItemType Directory -Path $Workdir | Out-Null
}
Set-Location $Workdir

# Step 1 — make sure Node.js is available
try { $nodeVersion = node --version } catch {
    Write-Host '[ERROR] Node.js is not installed on this PC.' -ForegroundColor Red
    Write-Host 'Install it from https://nodejs.org (LTS), then re-run this script.'
    exit 1
}
Write-Host "Node $nodeVersion detected."

# Step 2 — pull the capture script from the VPS (overwrites any old copy)
Write-Host ''
Write-Host 'Downloading capture script from VPS...' -ForegroundColor Cyan
& scp -i $SshKey "$VpsHost`:/root/solomon-v4/scripts/$ScriptName" "$ScriptName"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] scp failed. Check that the SSH key path is correct and the VPS is reachable.' -ForegroundColor Red
    exit 1
}

# Step 3 — install playwright + chromium ONCE (skipped on later runs)
if (-not (Test-Path 'node_modules\playwright')) {
    Write-Host ''
    Write-Host 'Installing Playwright (one-time, ~30s)...' -ForegroundColor Cyan
    if (-not (Test-Path 'package.json')) {
        & npm init -y | Out-Null
    }
    & npm install playwright --silent
    if ($LASTEXITCODE -ne 0) { Write-Host '[ERROR] npm install playwright failed.' -ForegroundColor Red; exit 1 }

    Write-Host ''
    Write-Host 'Installing Chromium browser (one-time, ~250MB)...' -ForegroundColor Cyan
    & npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { Write-Host '[ERROR] playwright install chromium failed.' -ForegroundColor Red; exit 1 }
} else {
    Write-Host 'Playwright already installed in workspace — skipping install.'
}

# Step 4 — run the capture (opens a browser, waits for login)
Write-Host ''
Write-Host '=========================================================' -ForegroundColor Yellow
Write-Host ' A browser window will open in a moment.'                    -ForegroundColor Yellow
Write-Host ' Sign in as the Google account that owns Building Shultz.'   -ForegroundColor Yellow
Write-Host ' If YouTube asks "Which channel?", pick Building Shultz.'    -ForegroundColor Yellow
Write-Host ' Then return here and press Enter to save the session.'      -ForegroundColor Yellow
Write-Host '=========================================================' -ForegroundColor Yellow
Write-Host ''
& node $ScriptName
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] Capture script exited with an error. See message above.' -ForegroundColor Red
    exit 1
}

# Step 5 — upload the saved session file back to the VPS
if (-not (Test-Path $StateFile)) {
    Write-Host "[ERROR] $StateFile was not created. Did you actually sign in before pressing Enter?" -ForegroundColor Red
    exit 1
}
Write-Host ''
Write-Host 'Uploading session file to VPS...' -ForegroundColor Cyan
& scp -i $SshKey $StateFile "$VpsHost`:/root/solomon-v4/$StateFile"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] scp upload failed.' -ForegroundColor Red
    exit 1
}
# Lock down permissions on the VPS-side file
& ssh -i $SshKey $VpsHost "chmod 600 /root/solomon-v4/$StateFile" 2>$null

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ' ✅ Done. Solomon can now post to YouTube community.'      -ForegroundColor Green
Write-Host '    Test it by messaging Solomon: /post test YT post'      -ForegroundColor Green
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ''
