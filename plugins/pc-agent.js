/**
 * PC Agent Plugin — Remote Windows PC Control via Relay
 */
const http = require('http');
let config = {};

module.exports = {
  name: 'pc-agent',
  version: '2.0.0',
  description: 'Remote PC control: execute commands, open URLs, manage files on Jed\'s Windows PC',
  requiredKeys: [],
  commands: ['/pc', '/pc_status', '/open_url'],
  tools: [
    {
      type: 'function', function: {
        name: 'pc_execute',
        description: 'Execute a PowerShell command on Jed\'s Windows PC via the relay agent',
        parameters: { type: 'object', properties: {
          command: { type: 'string', description: 'PowerShell command to execute' },
          timeout: { type: 'number', description: 'Timeout in ms (default 60000)' }
        }, required: ['command'] }
      }
    },
    {
      type: 'function', function: {
        name: 'pc_open_url',
        description: 'Open a URL in Chrome on Jed\'s PC',
        parameters: { type: 'object', properties: {
          url: { type: 'string', description: 'URL to open' }
        }, required: ['url'] }
      }
    },
    {
      type: 'function', function: {
        name: 'pc_status',
        description: 'Check if the PC Agent is online and responsive',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'pc_screenshot',
        description: 'Take a screenshot of the PC screen',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    }
  ],

  init(deps) { config = deps.config; },
  get _active() { return true; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'pc_execute': return await pcExecute(args.command, args.timeout);
      case 'pc_open_url': return await pcOpenUrl(args.url);
      case 'pc_status': return await pcStatus();
      case 'pc_screenshot': return await pcScreenshot();
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function relayRequest(endpoint, method = 'GET', body = null) {
  const url = `${config.RELAY_URL || 'http://127.0.0.1:3001'}${endpoint}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

async function pcStatus() {
  try {
    const data = await relayRequest('/agent/status');
    return {
      success: true,
      online: data.online,
      stale: data.stale,
      version: data.version,
      lastSeen: data.ageSeconds ? `${data.ageSeconds}s ago` : 'never',
      tabs: data.tabs
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function pcExecute(command, timeout = 60000) {
  try {
    // Check agent status first
    const status = await pcStatus();
    if (!status.online) {
      return { success: false, error: 'PC Agent is offline. Cannot execute command.' };
    }
    
    // Queue command
    const queueRes = await relayRequest('/command/queue', 'POST', { command, type: 'powershell', timeout });
    if (!queueRes.ok) return { success: false, error: queueRes.error || 'Failed to queue command' };
    
    const cmdId = queueRes.id;
    
    // Poll for result (with timeout)
    const deadline = Date.now() + timeout + 10000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const result = await relayRequest(`/command/result/${cmdId}`);
      if (result.status === 'completed') {
        const r = result.result;
        if (r.timedOut) return { success: false, error: 'Command timed out on PC', output: r.stdout };
        return {
          success: r.exitCode === 0,
          exitCode: r.exitCode,
          output: r.stdout || '(no output)',
          error: r.stderr || null,
          screenshot: r.screenshot || null
        };
      }
    }
    return { success: false, error: 'Timed out waiting for PC Agent response' };
  } catch (e) { return { success: false, error: e.message }; }
}

async function pcOpenUrl(url) {
  // Sanitize URL
  url = url.replace(/^["'*]+|["'*]+$/g, '').replace(/\*\*/g, '').trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  
  const command = `Start-Process "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -ArgumentList "${url}"`;
  return await pcExecute(command, 15000);
}

async function pcScreenshot() {
  const command = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $path = "$env:USERPROFILE\\SolomonAgent\\screenshots\\screen_$(Get-Date -Format 'yyyyMMdd_HHmmss').png"
    $bmp.Save($path)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output $path
  `;
  return await pcExecute(command, 15000);
}
