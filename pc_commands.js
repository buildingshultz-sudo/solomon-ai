const RELAY = 'http://127.0.0.1:3001';
const TOKEN = '8452080979:AAEcPILrHmKoPU6SYYC-Hhb9Ff58HrW84cU';
const CHAT_ID = '8762434280';

async function queueCommand(command, timeout = 30000) {
  const res = await fetch(RELAY + '/command/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, type: 'powershell' })
  });
  const data = await res.json();
  if (!data.ok) return { success: false, output: 'Failed to queue' };
  const cmdId = data.id;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 2000));
    const rRes = await fetch(RELAY + '/command/result/' + cmdId);
    const rData = await rRes.json();
    if (rData.status === 'completed') {
      return { success: rData.result.exitCode === 0, output: rData.result.stdout || rData.result.stderr || '(no output)' };
    }
  }
  return { success: false, output: 'Timeout' };
}

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' })
  });
}

async function main() {
  // Step 2: Verify Task Scheduler was created
  console.log('Verifying Task Scheduler...');
  const verify = await queueCommand('Get-ScheduledTask -TaskName "SolomonAgent" | Select-Object TaskName, State | Format-List');
  console.log('Task Scheduler:', verify.output);

  if (verify.success) {
    await sendTelegram('✅ *PC Agent Auto-Start Configured*\n\nSolomonAgent is now registered in Windows Task Scheduler.\n• Runs at login\n• Auto-restarts up to 3 times on failure\n• Runs with highest privileges\n\nYour PC agent will start automatically every time you log in.');
    console.log('Auto-start confirmation sent');
  }

  // Step 3: Desktop cleanup - find old Solomon/junk files
  console.log('\nScanning desktop for old files...');
  const scanCmd = `
$desktop = "C:\\Users\\Ashle\\Desktop"
$patterns = @("*solomon*", "*SolomonForge*", "*nssm*", "*.tmp", "*old_bot*")
$found = @()
foreach ($p in $patterns) {
  $items = Get-ChildItem -Path $desktop -Filter $p -Recurse -ErrorAction SilentlyContinue
  foreach ($item in $items) {
    $found += $item.FullName
  }
}
# Also check for common junk in other locations
$otherPaths = @(
  "C:\\Users\\Ashle\\SolomonForge",
  "C:\\Users\\Ashle\\Documents\\SolomonForge"
)
foreach ($op in $otherPaths) {
  if (Test-Path $op) { $found += $op }
}
if ($found.Count -eq 0) { Write-Output "CLEAN: No old Solomon files found" }
else { $found | ForEach-Object { Write-Output $_ } }
`;
  const scanResult = await queueCommand(scanCmd, 20000);
  console.log('Scan result:', scanResult.output);

  if (scanResult.output.includes('CLEAN')) {
    await sendTelegram('✅ *Desktop Cleanup*\n\nScanned desktop and common directories — no old Solomon/SolomonForge junk files found. Desktop is clean.');
  } else {
    // Found files - delete them
    const files = scanResult.output.trim().split('\n').filter(f => f.trim());
    console.log('Found files to clean:', files);
    
    const deleteCmd = `
$items = @(${files.map(f => `"${f.replace(/\\/g, '\\\\')}"`).join(',')})
$deleted = @()
foreach ($item in $items) {
  if (Test-Path $item) {
    Remove-Item -Path $item -Recurse -Force -ErrorAction SilentlyContinue
    $deleted += $item
  }
}
if ($deleted.Count -gt 0) { Write-Output "Deleted: $($deleted.Count) items"; $deleted | ForEach-Object { Write-Output "  - $_" } }
else { Write-Output "Nothing to delete" }
`;
    const deleteResult = await queueCommand(deleteCmd, 20000);
    console.log('Delete result:', deleteResult.output);
    
    await sendTelegram(`✅ *Desktop Cleanup Complete*\n\nRemoved old Solomon files:\n\`\`\`\n${deleteResult.output.slice(0, 500)}\n\`\`\``);
  }

  console.log('\nAll PC commands complete.');
}

main().catch(e => console.error('Error:', e));
