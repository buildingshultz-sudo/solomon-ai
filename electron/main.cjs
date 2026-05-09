/**
 * Solomon Forge — Electron main process.
 *
 * Boot order:
 *   1. Show a splash window immediately (so the user sees something while
 *      the Node server warms up).
 *   2. Spawn the Solomon server (`node dist/index.js`) as a child process,
 *      with SOLOMON_LOCAL=1 so it uses the embedded SQLite path.
 *   3. Poll http://127.0.0.1:<PORT>/api/health until it responds.
 *   4. Replace the splash with the main app window pointing at the server.
 *   5. On quit, kill the child server cleanly.
 *
 * The packaged app contains the built server bundle under `resources/server`
 * and the built client under `resources/server/public`.
 */
"use strict";

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");

const APP_NAME = "Solomon Forge";
const PORT = Number(process.env.SOLOMON_PORT || 3737);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const APP_URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let splashWindow = null;
let serverProc = null;

// Single-instance lock — prevents two copies of the server fighting over the
// SQLite file if the user double-clicks the shortcut twice.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function resourcePath(...parts) {
  // In dev: project root. In prod: process.resourcesPath.
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "..");
  return path.join(base, ...parts);
}

function dataDir() {
  // Persist DB under userData so updates don't wipe memory.
  const dir = path.join(app.getPath("userData"), "solomon-data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow && splashWindow.show());
  splashWindow.on("closed", () => (splashWindow = null));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#1a1714",
    title: APP_NAME,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) splashWindow.close();
    mainWindow.show();
  });

  // Open external links in the user's real browser, not inside the Electron
  // window — keeps the desktop app feel clean.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => (mainWindow = null));
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Open Data Folder",
          click: () => shell.openPath(dataDir()),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open Solomon in Browser",
          click: () => shell.openExternal(APP_URL),
        },
        {
          label: "Ollama Setup Guide",
          click: () => shell.openExternal("https://ollama.com/download/windows"),
        },
        { type: "separator" },
        {
          label: `About ${APP_NAME}`,
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: `About ${APP_NAME}`,
              message: `${APP_NAME}`,
              detail:
                "Local-first AI chief of staff for Building Shultz.\n\n" +
                "Solomon is the AI. The Forge is the workshop it lives in.\n\n" +
                `Server: ${APP_URL}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function startServer() {
  if (serverProc) return;

  const serverEntry = resourcePath("dist", "index.js");
  if (!fs.existsSync(serverEntry)) {
    dialog.showErrorBox(
      "Solomon Forge — server missing",
      `Could not find ${serverEntry}\n\nRun the installer again, or open a PowerShell in the install folder and run:\n  pnpm install\n  pnpm build`
    );
    app.quit();
    return;
  }

  const env = {
    ...process.env,
    NODE_ENV: "production",
    SOLOMON_LOCAL: "1",
    SOLOMON_DATA_DIR: dataDir(),
    PORT: String(PORT),
    JWT_SECRET: process.env.JWT_SECRET || "solomon-forge-local-secret",
    OWNER_PASSWORD: process.env.OWNER_PASSWORD || "forge",
    MODEL_PROVIDER: process.env.MODEL_PROVIDER || "ollama",
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llama3.1:8b",
  };

  // Use the bundled Node executable (Electron ships its own).
  const nodeBin = process.execPath;

  // electron's execPath runs the electron binary; for child server we prefer
  // a vanilla node if available so the server doesn't inherit electron flags.
  // electron exposes ELECTRON_RUN_AS_NODE to make execPath behave like node.
  serverProc = spawn(nodeBin, [serverEntry], {
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: resourcePath(),
  });

  const logPath = path.join(dataDir(), "server.log");
  const out = fs.createWriteStream(logPath, { flags: "a" });
  out.write(`\n\n==== ${new Date().toISOString()} server start ====\n`);
  serverProc.stdout.pipe(out);
  serverProc.stderr.pipe(out);

  serverProc.on("exit", (code, signal) => {
    out.write(`\nserver exited code=${code} signal=${signal}\n`);
    serverProc = null;
    if (!app.isQuitting) {
      dialog.showErrorBox(
        "Solomon Forge — server crashed",
        `The local server exited unexpectedly (code ${code}). See ${logPath} for details.`
      );
      app.quit();
    }
  });
}

function pingHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingHealth()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

app.whenReady().then(async () => {
  buildMenu();
  createSplash();
  startServer();

  const ok = await waitForServer();
  if (!ok) {
    dialog.showErrorBox(
      "Solomon Forge — server didn't start",
      `Tried ${HEALTH_URL} for 30s with no response. Check the server log at ${path.join(
        dataDir(),
        "server.log"
      )}.`
    );
    app.quit();
    return;
  }

  createMainWindow();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
