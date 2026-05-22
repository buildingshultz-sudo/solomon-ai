'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SERVERS_FILE = path.join(__dirname, 'mcp-servers.json');

// Load configured MCP servers from file or env
function getAvailableServers() {
  if (process.env.MCP_SERVERS) {
    return process.env.MCP_SERVERS.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (fs.existsSync(SERVERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

// Save a server to the registry
function addServer(serverUrl) {
  const servers = getAvailableServers();
  if (!servers.includes(serverUrl)) {
    servers.push(serverUrl);
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2));
  }
  return servers;
}

// Remove a server from the registry
function removeServer(serverUrl) {
  let servers = getAvailableServers();
  servers = servers.filter(s => s !== serverUrl);
  fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2));
  return servers;
}

// Generic HTTP JSON request
function httpJson(url, method, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Connect to an MCP server and verify it responds
async function connectToServer(serverUrl) {
  try {
    const result = await httpJson(serverUrl, 'POST', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'solomon-bot', version: '1.0.0' }
      }
    });
    return { connected: true, url: serverUrl, serverInfo: result.data };
  } catch (err) {
    return { connected: false, url: serverUrl, error: err.message };
  }
}

// List available tools from an MCP server
async function listTools(serverUrl) {
  try {
    const result = await httpJson(serverUrl, 'POST', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });
    if (result.data && result.data.result && result.data.result.tools) {
      return result.data.result.tools;
    }
    return result.data;
  } catch (err) {
    return { error: `Failed to list tools: ${err.message}` };
  }
}

// Call a specific tool on an MCP server
async function callTool(serverUrl, toolName, args) {
  try {
    const result = await httpJson(serverUrl, 'POST', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: toolName, arguments: args || {} }
    });
    if (result.data && result.data.result) {
      return result.data.result;
    }
    return result.data;
  } catch (err) {
    return { error: `Failed to call tool ${toolName}: ${err.message}` };
  }
}

module.exports = {
  getAvailableServers,
  addServer,
  removeServer,
  connectToServer,
  listTools,
  callTool
};
