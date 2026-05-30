# caleb-cutover.ps1 — Elevated cutover script for adding /caleb-task to PC relay.
#
# This is the ONLY script Caleb needs to run on Jed's PC. It:
#   1. Stops the running pc-relay node process (if any)
#   2. Pulls the new pc-relay.js (with /caleb-task endpoint) from the VPS
#   3. Replaces the local pc-relay.js, keeping a .bak of the old one
#   4. Creates the D:\caleb-queue directory if missing
#   5. Adds a Windows Firewall inbound allow rule on the relay port (if missing)
#   6. Restarts pc-relay via the existing launch path (PM2 if installed, else node + nohup)
#   7. Smoke-tests POST /caleb-task with a synthetic payload and verifies the
#      file appeared on disk, then deletes the test payload.
#
# Requires: Administrator (for the firewall rule). The script self-elevates if not.
# Assumes: SSH key at C:\Users\Ashle\.ssh\hostinger_solomon (same as every other
#          Sam script). PC relay directory parameter defaults to where Jed's
#          existing pc-relay.js lives (override with -PcRelayDir).

[CmdletBinding()]
param(
    [string]$PcRelayDir = 'C:\Users\Ashle\solomon-pc-relay',
    [string]$VpsHost = 'root@167.99.237.26',
    [string]$SshKey = 'C:\Users\Ashle\.ssh\hostinger_solomon',
    [int]$RelayPort = 7777,
    [string]$QueueDir = 'D:\caleb-queue',
    [switch]$SkipFirewall,
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'

# ── 0. Self-elevate if not Administrator ───────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Re-launching elevated...' -ForegroundColor Yellow
    $args = @('-ExecutionPolicy', 'Bypass', '-File', $MyInvocation.MyCommand.Path,
              '-PcRelayDir', $PcRelayDir, '-VpsHost', $VpsHost, '-SshKey', $SshKey,
              '-RelayPort', $RelayPort, '-QueueDir', $QueueDir)
    if ($SkipFirewall) { $args += '-SkipFirewall' }
    if ($SkipRestart)  { $args += '-SkipRestart' }
    Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $args -Wait
    exit
}

Write-Host ''
Write-Host '======================================================' -ForegroundColor Cyan
Write-Host ' Solomon PC relay cutover — adding /caleb-task'         -ForegroundColor Cyan
Write-Host ' (elevated session)'                                    -ForegroundColor Cyan
Write-Host '======================================================' -ForegroundColor Cyan
Write-Host ''

# ── 1. Verify prerequisites ────────────────────────────────────────────────
if (-not (Test-Path $PcRelayDir)) {
    Write-Host "[ERROR] PcRelayDir not found: $PcRelayDir" -ForegroundColor Red
    Write-Host "Pass -PcRelayDir <path> to override. The default assumes the relay lives in C:\Users\Ashle\solomon-pc-relay."
    exit 1
}
if (-not (Test-Path $SshKey)) {
    Write-Host "[ERROR] SSH key not found: $SshKey" -ForegroundColor Red
    exit 1
}
$relayJs = Join-Path $PcRelayDir 'pc-relay.js'
if (-not (Test-Path $relayJs)) {
    Write-Host "[ERROR] pc-relay.js not found at $relayJs" -ForegroundColor Red
    exit 1
}

# ── 2. Stop the running pc-relay process (best-effort, multiple strategies) ──
Write-Host 'Stopping current pc-relay process (if running)...' -ForegroundColor Cyan
# Try PM2 first
$pm2Available = $false
try { & pm2 --version 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $pm2Available = $true } } catch {}
if ($pm2Available) {
    try { & pm2 stop pc-relay 2>$null | Out-Null } catch {}
    Write-Host '  (tried pm2 stop pc-relay)'
}
# Then kill anything node-ish listening on the relay port
$portPid = $null
try {
    $conn = Get-NetTCPConnection -LocalPort $RelayPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { $portPid = $conn.OwningProcess }
} catch {}
if ($portPid) {
    try {
        Stop-Process -Id $portPid -Force -ErrorAction Stop
        Write-Host "  Killed PID $portPid bound to port $RelayPort" -ForegroundColor Yellow
    } catch {
        Write-Host "  Could not kill PID $portPid : $_" -ForegroundColor Yellow
    }
}
Start-Sleep -Seconds 1

# ── 3. Pull new pc-relay.js from VPS ──────────────────────────────────────
Write-Host 'Pulling new pc-relay.js from VPS...' -ForegroundColor Cyan
$bakPath = "$relayJs.bak.$(Get-Date -Format 'yyyy-MM-dd-HHmmss')"
Copy-Item -Path $relayJs -Destination $bakPath
Write-Host "  Backup saved: $bakPath" -ForegroundColor DarkGray

& scp -i $SshKey "$VpsHost`:/root/solomon-v4/pc-relay.js" $relayJs
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] scp failed. Restoring backup.' -ForegroundColor Red
    Copy-Item -Path $bakPath -Destination $relayJs -Force
    exit 1
}
Write-Host "  Wrote new pc-relay.js" -ForegroundColor Green

# ── 4. Quick syntax check (only if node is on PATH) ────────────────────────
try {
    & node --check $relayJs
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[ERROR] node --check failed on new pc-relay.js. Restoring backup.' -ForegroundColor Red
        Copy-Item -Path $bakPath -Destination $relayJs -Force
        exit 1
    }
    Write-Host '  node --check: PASS' -ForegroundColor Green
} catch {
    Write-Host '  (node not on PATH for syntax check — skipping)' -ForegroundColor DarkGray
}

# ── 5. Create Caleb queue dir ──────────────────────────────────────────────
if (-not (Test-Path $QueueDir)) {
    New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null
    Write-Host "Created Caleb queue dir: $QueueDir" -ForegroundColor Green
} else {
    Write-Host "Caleb queue dir already exists: $QueueDir" -ForegroundColor DarkGray
}

# ── 6. Firewall inbound allow rule (elevated) ──────────────────────────────
if (-not $SkipFirewall) {
    $ruleName = "Solomon PC Relay (port $RelayPort)"
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existing) {
        try {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort $RelayPort -Protocol TCP -Action Allow -Profile Any | Out-Null
            Write-Host "Added firewall rule '$ruleName' for inbound TCP $RelayPort" -ForegroundColor Green
        } catch {
            Write-Host "[WARN] Could not add firewall rule: $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Firewall rule '$ruleName' already exists" -ForegroundColor DarkGray
    }
}

# ── 7. Restart pc-relay ────────────────────────────────────────────────────
if (-not $SkipRestart) {
    Push-Location $PcRelayDir
    try {
        if ($pm2Available) {
            & pm2 start pc-relay 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) {
                # First time — register with PM2
                & pm2 start pc-relay.js --name pc-relay | Out-Null
            }
            & pm2 save | Out-Null
            Write-Host 'Restarted pc-relay via PM2.' -ForegroundColor Green
        } else {
            # Fall back to background node process via Start-Process
            $logFile = Join-Path $PcRelayDir 'pc-relay.out.log'
            $errFile = Join-Path $PcRelayDir 'pc-relay.err.log'
            Start-Process -FilePath node -ArgumentList 'pc-relay.js' -WorkingDirectory $PcRelayDir `
                          -RedirectStandardOutput $logFile -RedirectStandardError $errFile -WindowStyle Hidden
            Write-Host "Started pc-relay via background node (logs: $logFile)." -ForegroundColor Green
        }
    } finally { Pop-Location }
    Start-Sleep -Seconds 3
}

# ── 8. Smoke-test the new /caleb-task endpoint ────────────────────────────
Write-Host ''
Write-Host 'Smoke-testing POST /caleb-task...' -ForegroundColor Cyan
$secret = $null
try {
    $envFile = Join-Path $PcRelayDir '.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^PC_RELAY_SECRET=' } | Select-Object -First 1
        if ($line) { $secret = ($line -replace '^PC_RELAY_SECRET=', '').Trim().Trim('"') }
    }
} catch {}
if (-not $secret) {
    Write-Host '[WARN] Could not read PC_RELAY_SECRET from .env — skipping live smoke test.' -ForegroundColor Yellow
    Write-Host '       Manually test with the curl example in the report.' -ForegroundColor Yellow
} else {
    $testPayload = @{
        schema_version = 1
        task = 'CUTOVER SMOKE TEST'
        template_id = 'cutover_smoke'
        handler = 'caleb'
        variables = @{}
        filled_prompt = 'This is a cutover smoke test from the elevated PowerShell script.'
        step_by_step = @()
        priority = 'low'
        created = (Get-Date).ToString('o')
    } | ConvertTo-Json -Depth 5
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$RelayPort/caleb-task" `
                                  -Method Post `
                                  -Headers @{ 'X-Secret' = $secret; 'Content-Type' = 'application/json' } `
                                  -Body $testPayload `
                                  -TimeoutSec 10
        if ($resp.ok -and $resp.file -and (Test-Path $resp.file)) {
            Write-Host "  Smoke test PASS — payload written to $($resp.file)" -ForegroundColor Green
            Remove-Item -Path $resp.file -Force -ErrorAction SilentlyContinue
            Write-Host '  (test payload cleaned up)' -ForegroundColor DarkGray
        } else {
            Write-Host "  Smoke test FAIL — response: $($resp | ConvertTo-Json -Compress)" -ForegroundColor Red
            exit 2
        }
    } catch {
        Write-Host "  Smoke test FAIL — request error: $_" -ForegroundColor Red
        Write-Host '  Check that the relay is running and the secret matches the VPS.' -ForegroundColor Yellow
        exit 2
    }
}

# ── 9. Final verify: hit /status ───────────────────────────────────────────
try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$RelayPort/status" -Method Get `
                                -Headers @{ 'X-Secret' = $secret } -TimeoutSec 5
    Write-Host "Relay /status: $($status | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
} catch {
    Write-Host "[WARN] /status check failed: $_" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host ' Cutover complete. /caleb-task is live.'                 -ForegroundColor Green
Write-Host ' Caleb tasks dispatched by Solomon now land in:'         -ForegroundColor Green
Write-Host "   $QueueDir"                                            -ForegroundColor Green
Write-Host ' Cowork picks them up from there.'                       -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
Write-Host ''
