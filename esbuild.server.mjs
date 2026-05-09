// Server-bundle build for Solomon's Forge.
//
// We bundle most deps inline so the portable distribution does not need a full
// node_modules tree on the user's machine. A few packages must stay external
// because they ship native binaries, dynamic require()s of optional deps, or
// load sibling files at runtime (e.g. sql.js's WASM file). Everything in the
// `external` array below is expected to live in the distributed node_modules.
import { build } from "esbuild";

const external = [
  // Native / dynamic-require packages — keep external, ship in node_modules.
  "sql.js",
  "node-telegram-bot-api",
  "@modelcontextprotocol/sdk",
  // Drivers we never use in local mode but want available if the user later
  // points DATABASE_URL at a real DB. Keeping them external means the bundle
  // does not pull in their CJS interop weirdness.
  "better-sqlite3",
  "mysql2",
  "pg",
  // Cloud SDKs not required at runtime in local mode.
  "@aws-sdk/*",
  // Optional websocket native accelerators.
  "bufferutil",
  "utf-8-validate",
  // Dev-only tooling reachable through `server/_core/vite.ts` but only ever
  // executed when NODE_ENV=development.
  "vite",
  "@vitejs/*",
  "tailwindcss",
  "@tailwindcss/*",
  "lightningcss",
  "@babel/*",
  "postcss",
  "autoprefixer",
  "tw-animate-css",
  "fsevents",
];

// Many bundled CJS packages call require("fs") / require("path") / etc. When
// the output is ESM these built-in requires fail with "Dynamic require of …
// is not supported". Re-create a real require() at the top of the bundle so
// those calls keep working.
const banner = `
import { createRequire as __solomonCreateRequire } from "node:module";
import { fileURLToPath as __solomonFileURLToPath } from "node:url";
import { dirname as __solomonDirname } from "node:path";
const require = __solomonCreateRequire(import.meta.url);
const __filename = __solomonFileURLToPath(import.meta.url);
const __dirname = __solomonDirname(__filename);
`;

await build({
  entryPoints: ["server/_core/index.ts"],
  outdir: "dist",
  platform: "node",
  format: "esm",
  bundle: true,
  target: "node20",
  external,
  banner: { js: banner },
  // Keep names readable in case Solomon throws — small price.
  minify: false,
  legalComments: "none",
  logLevel: "info",
});
