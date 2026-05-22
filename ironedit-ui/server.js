/**
 * IronEdit UI — Static file server
 * Serves the frontend on port 3000 and proxies /api/* and /health to the
 * IronEdit API on port 8080 so the browser can talk to the API without CORS issues.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.UI_PORT || "3000");
const API_BASE = process.env.API_BASE || "http://localhost:8080";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function proxyRequest(req, res) {
  const apiUrl = new URL(req.url, API_BASE);
  const isHttps = apiUrl.protocol === "https:";
  const lib = isHttps ? https : http;

  const options = {
    hostname: apiUrl.hostname,
    port: apiUrl.port || (isHttps ? 443 : 80),
    path: apiUrl.pathname + (apiUrl.search || ""),
    method: req.method,
    headers: { ...req.headers, host: apiUrl.host },
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    // Add CORS headers
    const headers = {
      ...proxyRes.headers,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Job-Kind",
    };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    log(`Proxy error: ${err.message}`);
    res.writeHead(502);
    res.end(JSON.stringify({ error: "API proxy error", message: err.message }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Job-Kind",
    });
    res.end();
    return;
  }

  // Proxy API calls
  if (req.url.startsWith("/api/") || req.url === "/health" || req.url === "/agent") {
    proxyRequest(req, res);
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Default to index.html for SPA routing
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`IronEdit UI running at http://0.0.0.0:${PORT}`);
  log(`Proxying API calls to ${API_BASE}`);
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
