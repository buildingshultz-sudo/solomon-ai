/**
 * Solomon PC Agent v5.0.0 (Playwright Browser Automation Edition)
 *
 * Runs on Jed's Windows PC. Polls the relay for commands and executes them.
 * Features:
 * - PowerShell/CMD command execution (preserved from v4.0.1)
 * - Playwright browser automation (navigate, click, fill, screenshot, eval)
 * - Persistent browser session (stays open between commands)
 * - Extended timeout for browser operations (120s)
 * - Self-upgrade capability
 * - Graceful error handling (never crashes)
 */
const https = require("https");
const http = require("http");
const { spawn, execSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

// ── CONFIGURATION ──────────────────────────────────────────────────────────
const RELAY_URL = "http://167.99.237.26:3001";
const AGENT_TOKEN = "0d029fb2-4feb-44d1-b2ad-a90521f0c264";
const POLL_INTERVAL = 3000;
const HEARTBEAT_INTERVAL = 15000;
const COMMAND_TIMEOUT = 30000;
const BROWSER_TIMEOUT = 120000;
const VERSION = "5.0.0";
const AGENT_DIR = path.join(process.env.USERPROFILE || "C:\\Users\\Ashle", "Desktop");
const SCREENSHOT_DIR = path.join(AGENT_DIR, "solomon-screenshots");

let startTime = Date.now();
let activeProcesses = 0;
let browserInstance = null;
let browserContext = null;
let browserPage = null;
let browserReady = false;

console.log(`Solomon Agent v${VERSION} starting...`);
console.log(`Agent dir: ${AGENT_DIR}`);
console.log(`Screenshot dir: ${SCREENSHOT_DIR}`);

// Ensure screenshot directory exists
try { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch (e) {}

// ── HTTP REQUEST HELPER ────────────────────────────────────────────────────
function request(url, options) {
  options = options || {};
  return new Promise(function(resolve, reject) {
    var urlObj = new URL(url);
    var mod = urlObj.protocol === "https:" ? https : http;
    var body = options.body ? JSON.stringify(options.body) : null;
    var reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "x-agent-token": AGENT_TOKEN,
        "Content-Length": body ? Buffer.byteLength(body) : 0
      },
      timeout: 15000
    };
    var req = mod.request(reqOptions, function(res) {
      var data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", function() { req.destroy(); reject(new Error("Request timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

// ── POWERSHELL/CMD EXECUTION ───────────────────────────────────────────────
function executeCommand(command, type) {
  return new Promise(function(resolve) {
    activeProcesses++;
    var stdout = "";
    var stderr = "";
    var child;
    var resolved = false;

    function done(result) {
      if (resolved) return;
      resolved = true;
      activeProcesses--;
      resolve(result);
    }

    try {
      if (type === "powershell" || !type) {
        var psCommand = "$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; try { $host.UI.RawUI.BufferSize = New-Object System.Management.Automation.Host.Size(4096, 9999) } catch {}; " + command;
        child = spawn("powershell.exe", ["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand], { windowsHide: true });
      } else {
        child = spawn("cmd.exe", ["/c", "chcp 65001 > nul & " + command], { windowsHide: true });
      }
    } catch(spawnErr) {
      done({ output: "", error: spawnErr.message, exitCode: 1, screenshot: null });
      return;
    }

    var timer = setTimeout(function() {
      try { child.kill(); } catch(e) {}
      done({ output: stdout.trim() || "(timed out after 30s)", error: stderr.trim(), exitCode: 124, screenshot: null });
    }, COMMAND_TIMEOUT);

    child.stdout.on("data", function(data) { stdout += data.toString(); });
    child.stderr.on("data", function(data) { stderr += data.toString(); });
    child.on("close", function(code) {
      clearTimeout(timer);
      done({ output: stdout.trim(), error: stderr.trim(), exitCode: code, screenshot: null });
    });
    child.on("error", function(err) {
      clearTimeout(timer);
      done({ output: "", error: err.message, exitCode: 1, screenshot: null });
    });
  });
}

// ── PLAYWRIGHT BROWSER AUTOMATION ──────────────────────────────────────────
async function ensureBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    if (!browserPage || browserPage.isClosed()) {
      browserPage = await browserContext.newPage();
    }
    return browserPage;
  }
  // Launch new browser
  try {
    const { chromium } = require("playwright");
    browserInstance = await chromium.launch({
      headless: false,  // Visible so Jed can see what's happening
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"]
    });
    browserContext = await browserInstance.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    });
    browserPage = await browserContext.newPage();
    browserReady = true;
    console.log("[BROWSER] Playwright browser launched successfully");
    return browserPage;
  } catch (err) {
    browserReady = false;
    throw new Error("Failed to launch browser: " + err.message);
  }
}

async function executeBrowserCommand(commandStr) {
  let cmd;
  try {
    cmd = JSON.parse(commandStr);
  } catch (e) {
    return { output: JSON.stringify({ error: "Invalid browser command JSON: " + e.message }), error: "", exitCode: 1, screenshot: null };
  }

  const action = cmd.action;
  const options = cmd.options || {};

  try {
    switch (action) {
      case "navigate": {
        const url = cmd.url;
        if (!url) return { output: JSON.stringify({ error: "No URL provided" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        await page.goto(url, { waitUntil: options.waitUntil || "domcontentloaded", timeout: options.timeout || 30000 });
        await page.waitForTimeout(options.delay || 2000);
        const title = await page.title();
        const pageUrl = page.url();
        const text = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 5000) : "");
        return { output: JSON.stringify({ success: true, action: "navigate", title, url: pageUrl, textPreview: text.slice(0, 500) }), error: "", exitCode: 0, screenshot: null };
      }

      case "click": {
        const selector = cmd.selector;
        if (!selector) return { output: JSON.stringify({ error: "No selector provided" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
        await page.click(selector);
        await page.waitForTimeout(options.delay || 2000);
        const newUrl = page.url();
        const newTitle = await page.title();
        return { output: JSON.stringify({ success: true, action: "click", selector, url: newUrl, title: newTitle }), error: "", exitCode: 0, screenshot: null };
      }

      case "fill": {
        const selector = cmd.selector;
        const value = cmd.value;
        if (!selector || value === undefined) return { output: JSON.stringify({ error: "Need selector and value" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
        await page.fill(selector, value);
        return { output: JSON.stringify({ success: true, action: "fill", selector, valueLength: value.length }), error: "", exitCode: 0, screenshot: null };
      }

      case "type": {
        const selector = cmd.selector;
        const value = cmd.value;
        if (!selector || value === undefined) return { output: JSON.stringify({ error: "Need selector and value" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
        await page.click(selector);
        await page.type(selector, value, { delay: options.typeDelay || 50 });
        return { output: JSON.stringify({ success: true, action: "type", selector, valueLength: value.length }), error: "", exitCode: 0, screenshot: null };
      }

      case "screenshot": {
        const page = await ensureBrowser();
        const filename = `screenshot_${Date.now()}.png`;
        const filepath = path.join(SCREENSHOT_DIR, filename);
        await page.screenshot({ path: filepath, fullPage: options.fullPage || false });
        const stats = fs.statSync(filepath);
        // Read as base64 for relay transmission (truncated for large images)
        const base64 = fs.readFileSync(filepath).toString("base64");
        const screenshotData = base64.length > 2000000 ? base64.slice(0, 2000000) : base64;
        return { output: JSON.stringify({ success: true, action: "screenshot", path: filepath, size: stats.size, filename }), error: "", exitCode: 0, screenshot: screenshotData };
      }

      case "text": {
        const selector = cmd.selector || "body";
        const page = await ensureBrowser();
        await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
        const text = await page.evaluate((sel) => {
          const els = document.querySelectorAll(sel);
          return Array.from(els).map(el => el.innerText).join("\n").slice(0, 10000);
        }, selector);
        return { output: JSON.stringify({ success: true, action: "text", selector, text }), error: "", exitCode: 0, screenshot: null };
      }

      case "eval": {
        const script = cmd.script;
        if (!script) return { output: JSON.stringify({ error: "No script provided" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        const result = await page.evaluate((code) => {
          try { return String(eval(code)); }
          catch (e) { return "ERROR: " + e.message; }
        }, script);
        return { output: JSON.stringify({ success: true, action: "eval", result: result.slice(0, 5000) }), error: "", exitCode: 0, screenshot: null };
      }

      case "select": {
        const selector = cmd.selector;
        const value = cmd.value;
        if (!selector || !value) return { output: JSON.stringify({ error: "Need selector and value" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
        await page.selectOption(selector, value);
        return { output: JSON.stringify({ success: true, action: "select", selector, value }), error: "", exitCode: 0, screenshot: null };
      }

      case "wait": {
        const selector = cmd.selector;
        if (!selector) return { output: JSON.stringify({ error: "No selector provided" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        await page.waitForSelector(selector, { timeout: options.timeout || 30000 });
        return { output: JSON.stringify({ success: true, action: "wait", selector }), error: "", exitCode: 0, screenshot: null };
      }

      case "keyboard": {
        const key = cmd.value;
        if (!key) return { output: JSON.stringify({ error: "No key provided" }), error: "", exitCode: 1, screenshot: null };
        const page = await ensureBrowser();
        await page.keyboard.press(key);
        return { output: JSON.stringify({ success: true, action: "keyboard", key }), error: "", exitCode: 0, screenshot: null };
      }

      case "scroll": {
        const page = await ensureBrowser();
        const direction = cmd.value || "down";
        const amount = options.amount || 500;
        if (direction === "down") {
          await page.evaluate((px) => window.scrollBy(0, px), amount);
        } else if (direction === "up") {
          await page.evaluate((px) => window.scrollBy(0, -px), amount);
        } else if (direction === "top") {
          await page.evaluate(() => window.scrollTo(0, 0));
        } else if (direction === "bottom") {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        return { output: JSON.stringify({ success: true, action: "scroll", direction, amount }), error: "", exitCode: 0, screenshot: null };
      }

      case "close": {
        if (browserInstance) {
          await browserInstance.close();
          browserInstance = null;
          browserContext = null;
          browserPage = null;
          browserReady = false;
        }
        return { output: JSON.stringify({ success: true, action: "close" }), error: "", exitCode: 0, screenshot: null };
      }

      case "pages": {
        if (!browserContext) return { output: JSON.stringify({ success: true, action: "pages", pages: [] }), error: "", exitCode: 0, screenshot: null };
        const pages = browserContext.pages();
        const pageList = await Promise.all(pages.map(async (p, i) => ({
          index: i,
          url: p.url(),
          title: await p.title().catch(() => "")
        })));
        return { output: JSON.stringify({ success: true, action: "pages", pages: pageList }), error: "", exitCode: 0, screenshot: null };
      }

      case "switchTab": {
        const index = parseInt(cmd.value) || 0;
        if (!browserContext) return { output: JSON.stringify({ error: "No browser open" }), error: "", exitCode: 1, screenshot: null };
        const pages = browserContext.pages();
        if (index >= pages.length) return { output: JSON.stringify({ error: `Tab ${index} not found, only ${pages.length} tabs` }), error: "", exitCode: 1, screenshot: null };
        browserPage = pages[index];
        await browserPage.bringToFront();
        return { output: JSON.stringify({ success: true, action: "switchTab", index, url: browserPage.url() }), error: "", exitCode: 0, screenshot: null };
      }

      case "newTab": {
        const page = await browserContext.newPage();
        browserPage = page;
        if (cmd.url) {
          await page.goto(cmd.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        }
        return { output: JSON.stringify({ success: true, action: "newTab", url: page.url() }), error: "", exitCode: 0, screenshot: null };
      }

      default:
        return { output: JSON.stringify({ error: `Unknown browser action: ${action}` }), error: "", exitCode: 1, screenshot: null };
    }
  } catch (err) {
    console.error("[BROWSER] Error:", err.message);
    return { output: JSON.stringify({ error: err.message, action, step: "failed" }), error: err.message, exitCode: 1, screenshot: null };
  }
}

// ── SELF-UPGRADE HANDLER ───────────────────────────────────────────────────
function handleUpgrade(cmd) {
  try {
    const agentPath = path.join(AGENT_DIR, "solomon-agent.js");
    // Backup current
    const backupPath = agentPath + ".backup." + Date.now();
    if (fs.existsSync(agentPath)) {
      fs.copyFileSync(agentPath, backupPath);
    }
    // Write new version
    fs.writeFileSync(agentPath, cmd.payload, "utf8");
    console.log("[UPGRADE] Agent upgraded. Restarting in 2s...");
    setTimeout(() => process.exit(0), 2000); // PM2 or restart script will relaunch
    return { output: "Upgrade applied, restarting...", error: "", exitCode: 0, screenshot: null };
  } catch (err) {
    return { output: "", error: "Upgrade failed: " + err.message, exitCode: 1, screenshot: null };
  }
}

// ── POLL AND EXECUTE ───────────────────────────────────────────────────────
function pollAndExecute() {
  request(RELAY_URL + "/agent/poll").then(function(res) {
    if (res.status !== 200 || !res.body || !res.body.commands) return;
    var cmds = res.body.commands;
    cmds.forEach(function(cmd) {
      console.log("[EXEC] " + cmd.id + " | type=" + (cmd.type || "powershell") + " | " + (cmd.command || "").slice(0, 60));

      // Handle upgrade commands
      if (cmd.command === "__SELF_UPGRADE__" || cmd.type === "upgrade") {
        var result = handleUpgrade(cmd);
        submitResult(cmd.id, result);
        return;
      }

      // Handle browser commands
      if (cmd.type === "browser") {
        executeBrowserCommand(cmd.command).then(function(result) {
          console.log("[BROWSER] " + cmd.id.slice(0, 8) + " exit=" + result.exitCode);
          submitResult(cmd.id, result);
        }).catch(function(e) {
          console.error("[BROWSER] Error for " + cmd.id.slice(0, 8) + ":", e.message);
          submitResult(cmd.id, { output: JSON.stringify({ error: e.message }), error: e.message, exitCode: 1, screenshot: null });
        });
        return;
      }

      // Handle PowerShell/CMD commands (default)
      executeCommand(cmd.command, cmd.type || "powershell").then(function(result) {
        console.log("[RESULT] " + cmd.id.slice(0, 8) + " exit=" + result.exitCode + " out=" + (result.output || "").slice(0, 50));
        submitResult(cmd.id, result);
      }).catch(function(e) {
        console.error("[RESULT] Failed for " + cmd.id.slice(0, 8) + ":", e.message);
        submitResult(cmd.id, { output: "", error: e.message, exitCode: 1, screenshot: null });
      });
    });
  }).catch(function(e) {
    if (e.message && e.message.indexOf("ECONNREFUSED") === -1) {
      console.error("[POLL] Error:", e.message);
    }
  });
}

function submitResult(cmdId, result) {
  return request(RELAY_URL + "/agent/result", {
    method: "POST",
    body: {
      id: cmdId,
      output: result.output || "",
      error: result.error || "",
      exitCode: result.exitCode != null ? result.exitCode : 0,
      screenshot: result.screenshot || undefined
    }
  }).then(function(r) {
    console.log("[SUBMIT] " + cmdId.slice(0, 8) + " status=" + r.status);
  }).catch(function(e) {
    console.error("[SUBMIT] Failed for " + cmdId.slice(0, 8) + ":", e.message);
  });
}

// ── HEARTBEAT ──────────────────────────────────────────────────────────────
setInterval(function() {
  request(RELAY_URL + "/agent/heartbeat", {
    method: "POST",
    body: {
      agentId: os.hostname(),
      status: "online",
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      browserReady: browserReady,
      activeProcesses: activeProcesses
    }
  }).catch(function() {});
}, HEARTBEAT_INTERVAL);

// ── START POLLING ──────────────────────────────────────────────────────────
setInterval(pollAndExecute, POLL_INTERVAL);

console.log(`Agent v${VERSION} running — polling every ${POLL_INTERVAL/1000}s`);
console.log(`PowerShell timeout: ${COMMAND_TIMEOUT/1000}s | Browser timeout: ${BROWSER_TIMEOUT/1000}s`);
console.log("Browser automation: Playwright (will launch on first browser command)");
