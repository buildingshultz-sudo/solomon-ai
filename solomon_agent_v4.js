/**
 * Solomon PC Agent v4.1.0
 *
 * Upgrades over v3.0.0:
 * 1. AUTO-SCREENSHOT: After any command that opens a URL in Chrome, waits 4s then
 *    captures a screenshot and sends it back as base64 in the result.
 * 2. URL SANITIZATION: Strips asterisks, backticks, quotes, and escape chars from
 *    URLs before passing to 'start chrome'. Always uses clean URLs.
 * 3. TAB MANAGEMENT: After any Chrome open command, checks tab count via PowerShell.
 *    If tabs exceed 5, closes the oldest ones.
 * 4. SILENT LAUNCHER: No "press any key" — runs as a pure background Node.js process.
 * 5. PARALLEL EXECUTION: Multiple commands execute concurrently (not sequentially).
 */

const https = require("https");
const http = require("http");
const { spawn, exec } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

const RELAY_URL = "http://167.99.237.26:3001";
const AGENT_TOKEN = "0d029fb2-4feb-44d1-b2ad-a90521f0c264";
const POLL_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 10000;
const COMMAND_TIMEOUT = 120000;
const MAX_CHROME_TABS = 5;

let startTime = Date.now();
let activeProcesses = 0;

console.log("[AGENT] Solomon PC Agent v4.1.0 starting...");
console.log("[AGENT] Relay:", RELAY_URL);
console.log("[AGENT] PID:", process.pid);
console.log("[AGENT] Platform:", process.platform, os.release());

// ── URL SANITIZER ─────────────────────────────────────────────────────────────
// Strips markdown formatting, asterisks, backticks, surrounding quotes, and
// any escape characters that cause ERR_NAME_NOT_RESOLVED in Chrome.
function sanitizeUrl(url) {
  if (!url) return url;
  return url
    .replace(/\*/g, "")           // remove asterisks
    .replace(/`/g, "")            // remove backticks
    .replace(/\\"/g, "")          // remove escaped quotes
    .replace(/^["']|["']$/g, "")  // remove surrounding quotes
    .replace(/\s+/g, "")          // remove whitespace
    .trim();
}

// ── SCREENSHOT CAPTURE ────────────────────────────────────────────────────────
function captureScreenshot() {
  return new Promise(function(resolve) {
    var ps = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "Add-Type -AssemblyName System.Drawing;",
      "$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
      "$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height);",
      "$g = [System.Drawing.Graphics]::FromImage($bmp);",
      "$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size);",
      "$ms = New-Object System.IO.MemoryStream;",
      "$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);",
      "$g.Dispose(); $bmp.Dispose();",
      "[Convert]::ToBase64String($ms.ToArray())"
    ].join(" ");

    var child = spawn("powershell.exe", [
      "-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-Command", ps
    ], { windowsHide: true });

    var out = "";
    var err = "";
    child.stdout.on("data", function(d) { out += d.toString("utf8"); });
    child.stderr.on("data", function(d) { err += d.toString("utf8"); });

    var timer = setTimeout(function() {
      try { child.kill(); } catch(e) {}
      resolve(null);
    }, 15000);

    child.on("close", function() {
      clearTimeout(timer);
      var b64 = out.trim();
      resolve(b64.length > 1000 ? b64 : null);
    });
  });
}

// ── TAB MANAGER ───────────────────────────────────────────────────────────────
// Uses PowerShell to count Chrome windows and close excess ones.
// Chrome doesn't expose tab count easily, so we close excess Chrome windows.
function enforceTabLimit() {
  return new Promise(function(resolve) {
    var ps = [
      "$chromeWindows = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''};",
      "$count = ($chromeWindows | Measure-Object).Count;",
      "if ($count -gt " + MAX_CHROME_TABS + ") {",
      "  $toClose = $chromeWindows | Select-Object -First ($count - " + MAX_CHROME_TABS + ");",
      "  $toClose | ForEach-Object { $_.CloseMainWindow() | Out-Null };",
      "  Write-Output \"Closed $(($toClose | Measure-Object).Count) Chrome windows. Remaining: " + MAX_CHROME_TABS + "\"",
      "} else {",
      "  Write-Output \"Chrome windows: $count (within limit)\"",
      "}"
    ].join(" ");

    var child = spawn("powershell.exe", [
      "-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-Command", ps
    ], { windowsHide: true });

    var out = "";
    child.stdout.on("data", function(d) { out += d.toString("utf8"); });
    var timer = setTimeout(function() { try { child.kill(); } catch(e) {} resolve("Tab check timed out"); }, 10000);
    child.on("close", function() { clearTimeout(timer); resolve(out.trim()); });
  });
}

// ── COMMAND EXECUTOR ──────────────────────────────────────────────────────────
function executeCommand(command, type) {
  return new Promise(function(resolve) {
    activeProcesses++;
    var stdout = "";
    var stderr = "";
    var timedOut = false;
    var child;

    var timer = setTimeout(function() {
      timedOut = true;
      try { if (child) child.kill("SIGKILL"); } catch (e) {}
      activeProcesses--;
      resolve({ output: stdout || "(timed out after 120s)", error: stderr, exitCode: 124 });
    }, COMMAND_TIMEOUT);

    // Sanitize any URL in the command before execution
    var cleanCommand = command.replace(
      /(start chrome\s+["']?)([^"'\s]+)(["']?)/gi,
      function(match, prefix, url, suffix) {
        var clean = sanitizeUrl(url);
        return "start chrome \"" + clean + "\"";
      }
    );

    if (cleanCommand !== command) {
      console.log("[AGENT] URL sanitized: " + command.slice(0, 80) + " -> " + cleanCommand.slice(0, 80));
    }

    if (type === "powershell") {
      var psCommand = [
        "$OutputEncoding = [System.Text.Encoding]::UTF8;",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
        "try { $host.UI.RawUI.BufferSize = New-Object System.Management.Automation.Host.Size(4096, 9999) } catch {};",
        cleanCommand
      ].join(" ");
      child = spawn("powershell.exe", [
        "-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-OutputFormat", "Text", "-Command", psCommand
      ], { cwd: "C:\\Users\\Ashle\\Desktop\\FINAL FIX", windowsHide: true, env: Object.assign({}, process.env) });
    } else {
      child = spawn("cmd.exe", ["/c", "chcp 65001 > nul & mode con cols=500 2>nul & " + cleanCommand], {
        cwd: "C:\\Users\\Ashle\\Desktop\\FINAL FIX", windowsHide: true, env: Object.assign({}, process.env)
      });
    }

    child.stdout.on("data", function(chunk) { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", function(chunk) { stderr += chunk.toString("utf8"); });

    child.on("close", function(code) {
      if (timedOut) return;
      clearTimeout(timer);
      activeProcesses--;
      resolve({ output: stdout.trim(), error: stderr.trim(), exitCode: code !== null ? code : 0, cleanCommand: cleanCommand });
    });

    child.on("error", function(err) {
      if (timedOut) return;
      clearTimeout(timer);
      activeProcesses--;
      resolve({ output: "", error: err.message, exitCode: 1 });
    });
  });
}

// ── HTTP REQUEST HELPER ───────────────────────────────────────────────────────
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

// ── POLL AND EXECUTE ──────────────────────────────────────────────────────────
function pollAndExecute() {
  request(RELAY_URL + "/agent/poll").then(function(res) {
    if (res.status === 204 || !res.body || !res.body.commands) return;
    var commands = res.body.commands || [];
    if (commands.length === 0) return;
    console.log("[POLL] Got " + commands.length + " command(s)");

    // Execute all commands in parallel (Promise.all)
    var execPromises = commands.map(function(cmd) {
      var id = cmd.id;
      var command = cmd.command;
      var type = cmd.type || "powershell";
      var isChromeOpen = /start chrome/i.test(command);

      console.log("[EXEC] " + id.slice(0, 8) + " | " + type + " | " + command.slice(0, 80));

      return executeCommand(command, type).then(function(result) {
        console.log("[DONE] " + id.slice(0, 8) + " | exit:" + result.exitCode + " | " + result.output.length + "chars");

        // If this was a Chrome open command: take screenshot + enforce tab limit
        if (isChromeOpen) {
          return new Promise(function(resolve2) {
            setTimeout(function() {
              Promise.all([captureScreenshot(), enforceTabLimit()]).then(function(vals) {
                var screenshot = vals[0];
                var tabMsg = vals[1];
                console.log("[SCREENSHOT] " + (screenshot ? screenshot.length + " chars" : "none") + " | " + tabMsg);
                resolve2({ result: result, screenshot: screenshot });
              });
            }, 4000); // wait 4s for page to load
          });
        }
        return { result: result, screenshot: null };
      }).then(function(data) {
        return request(RELAY_URL + "/agent/result", {
          method: "POST",
          body: {
            id: id,
            output: data.result.output,
            error: data.result.error,
            exitCode: data.result.exitCode,
            screenshot: data.screenshot || undefined
          }
        });
      }).then(function() {
        console.log("[RESULT] " + id.slice(0, 8) + " submitted");
      }).catch(function(e) {
        console.error("[RESULT] Failed for " + id.slice(0, 8) + ":", e.message);
      });
    });

    Promise.all(execPromises).catch(function(e) {
      console.error("[POLL] Parallel exec error:", e.message);
    });

  }).catch(function(e) {
    if (e.message && e.message.indexOf("ECONNREFUSED") === -1) {
      console.error("[POLL] Error:", e.message);
    }
  });
}

// ── HEARTBEAT ─────────────────────────────────────────────────────────────────
function sendHeartbeat() {
  request(RELAY_URL + "/agent/heartbeat", {
    method: "POST",
    body: {
      agentId: os.hostname(),
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      memoryUsage: process.memoryUsage().heapUsed,
      activeProcesses: activeProcesses,
      platform: process.platform + " " + os.release(),
      version: "4.1.0"
    }
  }).catch(function(e) {
    console.error("[HEARTBEAT] Failed:", e.message);
  });
}

// ── START ─────────────────────────────────────────────────────────────────────
sendHeartbeat();
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
setInterval(pollAndExecute, POLL_INTERVAL);

console.log("[AGENT] v4.1.0 running — polling every 5s, auto-screenshot on Chrome opens, URL sanitization active.");
