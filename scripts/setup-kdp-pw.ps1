# Solomon KDP Playwright auth — one-shot PC setup
# Pull this from the VPS and run it. Reuses the YouTube setup workspace if it
# already exists (skips the ~250MB Chromium re-install). Opens a browser for
# you to sign into Amazon for KDP, then uploads the resulting session file to
# the VPS so Solomon can scrape your daily royalty report.

$ErrorActionPreference = 'Stop'
$VpsHost = 'root@167.99.237.26'
$SshKey  = 'C:\Users\Ashle\.ssh\hostinger_solomon'
$Workdir = Join-Path $env:TEMP 'solomon-pw-auth'
$ScriptName = 'capture_kdp_pw_auth.js'
$StateFile = '.pw_state_kdp.json'

Write-Host ''
Write-Host '=== Solomon KDP Playwright auth setup ===' -ForegroundColor Cyan
Write-Host "Working directory: $Workdir"
Write-Host ''

if (-not (Test-Path $Workdir)) {
    New-Item -ItemType Directory -Path $Workdir | Out-Null
}
Set-Location $Workdir

try { $nodeVersion = node --version } catch {
    Write-Host '[ERROR] Node.js is not installed on this PC.' -ForegroundColor Red
    Write-Host 'Install it from https://nodejs.org (LTS), then re-run this script.'
    exit 1
}
Write-Host "Node $nodeVersion detected."

Write-Host ''
Write-Host 'Downloading capture script from VPS...' -ForegroundColor Cyan
& scp -i $SshKey "$VpsHost`:/root/solomon-v4/scripts/$ScriptName" "$ScriptName"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] scp failed. Check that the SSH key path is correct and the VPS is reachable.' -ForegroundColor Red
    exit 1
}

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

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Yellow
Write-Host ' A browser window will open in a moment.'                    -ForegroundColor Yellow
Write-Host ' Sign in with the Amazon account that owns your KDP books.' -ForegroundColor Yellow
Write-Host ' If asked for a 2FA code, enter it normally.'                -ForegroundColor Yellow
Write-Host ' Once you see your KDP Bookshelf or Reports, return here'   -ForegroundColor Yellow
Write-Host ' and press Enter to save the session.'                       -ForegroundColor Yellow
Write-Host '=========================================================' -ForegroundColor Yellow
Write-Host ''
& node $ScriptName
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] Capture script exited with an error. See message above.' -ForegroundColor Red
    exit 1
}

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
& ssh -i $SshKey $VpsHost "chmod 600 /root/solomon-v4/$StateFile" 2>$null

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ' ✅ Uploaded .pw_state_kdp.json to VPS — Solomon can now' -ForegroundColor Green
Write-Host '    read KDP royalties daily. Your tomorrow 6 AM brief'   -ForegroundColor Green
Write-Host '    will include the KDP yesterday royalty line.'         -ForegroundColor Green
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ''
