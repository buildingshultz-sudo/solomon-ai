# Solomon Canva Playwright auth -- one-shot PC setup
# Captures storageState for canva.com so caleb-runner.js can drive Canva on
# Jed's behalf (the KDP cover fix task etc.). Mirrors setup-yt-pw.ps1 pattern.
# Pure ASCII so PowerShell 5.1 parses cleanly.

$ErrorActionPreference = 'Stop'
$VpsHost     = 'root@167.99.237.26'
$SshKey      = 'C:\Users\Ashle\.ssh\hostinger_solomon'
$Workdir     = Join-Path $env:TEMP 'solomon-pw-auth'
$StateFile   = '.pw_state_canva.json'
$AuthDir     = 'C:\Users\Ashle\Solomon\auth-states'

Write-Host ''
Write-Host '=== Solomon Canva Playwright auth setup ===' -ForegroundColor Cyan

if (-not (Test-Path $Workdir))  { New-Item -ItemType Directory -Path $Workdir | Out-Null }
if (-not (Test-Path $AuthDir))  { New-Item -ItemType Directory -Path $AuthDir | Out-Null }
Set-Location $Workdir

# Step 1: Node check
try { $nodeVersion = node --version } catch {
    Write-Host '[ERROR] Node.js not installed. Install from https://nodejs.org (LTS), then re-run.' -ForegroundColor Red
    exit 1
}
Write-Host "Node $nodeVersion detected."

# Step 2: ensure Playwright installed locally in the workdir (reuses YT setup if already there)
if (-not (Test-Path (Join-Path $Workdir 'node_modules\playwright'))) {
    Write-Host 'Installing Playwright (one-time, ~250MB Chromium)...'
    Set-Content -Path 'package.json' -Value '{"name":"solomon-pw-auth","version":"1.0.0","private":true,"dependencies":{"playwright":"^1.49.0"}}' -Encoding ascii
    npm install --silent
    npx playwright install chromium
} else {
    Write-Host 'Playwright already installed (reusing YT/IG/KDP setup workspace).'
}

# Step 3: Kill any running Chrome (storageState capture doesn't need it but
# the Playwright Chromium opens cleaner without competing chrome.exe procs)
$chromePids = Get-Process chrome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
if ($chromePids) {
    Write-Host "Closing $($chromePids.Count) Chrome process(es)..."
    Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}

# Step 4: write the capture script
$captureJs = @'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("https://www.canva.com/login", { waitUntil: "domcontentloaded" });
  console.log("");
  console.log("==============================================================");
  console.log("Sign in to Canva (buildingshultz@gmail.com).");
  console.log("Complete any 2FA if prompted.");
  console.log("Once you see your Canva home page (with your designs),");
  console.log("come back to this PowerShell window and press ENTER.");
  console.log("==============================================================");
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
  await ctx.storageState({ path: ".pw_state_canva.json" });
  console.log("Storage state written to .pw_state_canva.json");
  await ctx.close();
  await browser.close();
})();
'@
Set-Content -Path 'capture_canva_pw_auth.js' -Value $captureJs -Encoding ascii

# Step 5: run it
Write-Host ''
Write-Host '>>> Launching browser. Sign in to Canva, then come back here and press ENTER. <<<' -ForegroundColor Yellow
node capture_canva_pw_auth.js

# Step 6: validate output
if (-not (Test-Path $StateFile)) {
    Write-Host "[ERROR] $StateFile not created. Sign-in may have been skipped." -ForegroundColor Red
    exit 1
}
$bytes = (Get-Item $StateFile).Length
Write-Host "[OK] $StateFile captured ($bytes bytes)."

# Step 7: install into the auth-states dir caleb-runner reads from
Copy-Item $StateFile (Join-Path $AuthDir $StateFile) -Force
Write-Host "[OK] Installed to $AuthDir\$StateFile"

# Step 8: also upload to VPS so it survives a PC reinstall
Write-Host ''
Write-Host 'Uploading to VPS...'
scp -i $SshKey $StateFile "${VpsHost}:/root/solomon-v4/${StateFile}"
Write-Host '[OK] Uploaded to VPS at /root/solomon-v4/' -ForegroundColor Green

Write-Host ''
Write-Host '=== Canva auth captured. caleb-runner.js can now use auth_context="canva". ===' -ForegroundColor Green
