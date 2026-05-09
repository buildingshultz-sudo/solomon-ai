import "dotenv/config";
import express, { type Express } from "express";
import { createServer } from "http";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { startScheduler } from "../solomon/scheduler";

// Production static-file server. Inlined here (instead of imported from
// ./vite.ts) so the production bundle never references the `vite` package.
function serveStatic(app: Express) {
  // Bundle is at <portable>/dist/index.js, static assets at <portable>/dist/public.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(here, "../..", "dist", "public")
      : path.resolve(here, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  // SPA fallback — anything we haven't handled returns index.html.
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Lightweight health probe — used by the Electron splash screen to know
  // when the backend is ready to receive the first request.
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      mode: process.env.SOLOMON_LOCAL === "1" ? "local" : "hosted",
      provider: process.env.MODEL_PROVIDER || "openai",
      version: "2.0.0",
      time: new Date().toISOString(),
    });
  });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files.
  // The vite-based dev middleware is loaded via a dynamic import string so
  // esbuild does not include `./vite.ts` (and its `import "vite"`) in the
  // production bundle. In production builds this branch never executes.
  if (process.env.NODE_ENV === "development") {
    const viteModulePath = "./" + "vite.js";
    const viteModule: any = await import(/* @vite-ignore */ viteModulePath);
    await viteModule.setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  // In local/desktop mode the Electron shell expects an exact port; don't drift.
  const port =
    process.env.SOLOMON_LOCAL === "1"
      ? preferredPort
      : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    try {
      startScheduler(60_000);
      console.log("[Solomon] scheduler started (1 min tick)");
    } catch (e) {
      console.warn("[Solomon] scheduler failed to start:", e);
    }
  });
}

startServer().catch(console.error);
