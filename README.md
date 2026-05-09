# Solomon's Forge

*Local-first AI chief of staff for Building Shultz — runs on your Windows PC, free, offline, with optional cloud upgrade.*

> Solomon's Forge is the desktop edition of Solomon. **Solomon** is the AI itself; **the Forge** is the workshop it lives in. Double-click the desktop icon and your private back office boots in its own window — no browser tab, no monthly subscription, no internet required when running on a local model.

## What's new in Forge

- **Runs on your PC.** Wraps the existing Express + React stack in Electron with an embedded SQLite database. No MySQL, no VPS, no Docker required.
- **100% free mode.** Toggle the Model Provider in Settings to **Ollama** and Solomon thinks locally with Llama 3 / Mistral / Qwen — zero API cost, fully offline.
- **Manus Import.** A new page accepts a folder of markdown / docs and ingests them into Solomon's long-term memory, auto-categorized into business strategy, product, marketing, finance, and general.
- **One-click installer.** Double-click `Install Solomon's Forge.bat` on your desktop — it installs Node if missing, builds the app, registers a Windows service, and drops a shortcut on your desktop.

---

## Original Solomon documentation

Solomon is a single web application — a TypeScript server, a React dashboard, and a
MySQL/TiDB-compatible database — that wraps an LLM with a tool layer, a persistent
memory store, an autonomous scheduler, and a job board. It is built around the daily
workflow of a working tradesman who runs a YouTube channel and a small business: short,
plain-spoken interactions, autonomous background work, and predictable cost.

---

## What it does

| Capability | What's inside |
|---|---|
| **Chat agent** | OpenAI-compatible function-calling loop with tool execution and a routing trace surfaced in the UI. |
| **Model routing** | A heuristic scorer picks `gpt-4o-mini` for simple/short asks and escalates to `gpt-4o` (or `gpt-5`) only when the work is genuinely complex. Threshold and model names are configurable from Settings. |
| **Tool layer** | Fifteen registered tools: `memory_search`, `memory_write`, `task_create`, `task_list`, `finance_add`, `finance_summary`, `web_research`, `ffmpeg_command`, `file_list`, `youtube_analytics`, `youtube_upload`, `gmail_inbox`, `gmail_send`, `gdrive_list`, `social_post`. Tools that need OAuth that this repo cannot ship (Gmail, Drive, YouTube write, Facebook, Instagram, TikTok) run in **stub mode** by default — they draft the action and surface a "needs API key" badge instead of failing silently. |
| **Persistent memory** | Dual-layer: every conversation is persisted in `messages` (short-term context) and durable facts/decisions/brand-voice rules live in `memories` with category, tags, importance, and pin flags. Retrieval is a keyword + importance score — no external vector database required. |
| **Task / project board** | Kanban columns (active / in progress / blocked / completed) with priority, project, due date, and an `autonomous` flag. Solomon can create and move tasks via the `task_*` tools. |
| **Finance ledger** | Income / expense entries with category, running balance, by-category breakdown, and a `finance_summary` tool the agent can call mid-conversation. |
| **Autonomous scheduler** | An in-process tick loop runs jobs by cron expression: morning brief, email check, YouTube analytics pull, weekly content-calendar draft. Owner notifications are pushed when a brief is ready or a flagged event fires. |
| **Memory viewer** | A page to read and edit every entry Solomon knows — searchable, filterable by category, with a markdown editor for content. |
| **Settings panel** | Stores API keys, the model-routing knobs, and a system status view. Secrets are masked in the API response. |
| **Dashboard** | Dark industrial theme — charcoal, gunmetal, copper, stenciled headings, faint riveted backgrounds — with a persistent sidebar. |

---

## Tech stack

- **Server:** Node 22 / Express + tRPC 11 + Drizzle ORM
- **Client:** React 19 + Vite 7 + Tailwind 4 + shadcn/ui + wouter
- **Database:** MySQL 8 / TiDB-compatible (any MySQL-wire DB works; `DATABASE_URL` is the only connection string)
- **LLM:** Any OpenAI-compatible chat-completions endpoint. Two configurations:
  - **Hosted (default in this repo):** the platform's built-in LLM endpoint is used. Zero setup, but counts against platform credits.
  - **Self-hosted:** set `OPENAI_API_KEY` and the server talks directly to OpenAI. The Docker image is built for this mode.
- **Tests:** Vitest (unit tests for the model router, memory scoring, and cron parser).

---

## Quick start (local dev)

```bash
# 1. Install
pnpm install

# 2. Provision a MySQL-compatible database and put the connection string in .env
echo 'DATABASE_URL=mysql://user:pass@host:3306/solomon' >> .env
echo 'OPENAI_API_KEY=sk-...' >> .env
echo 'JWT_SECRET=$(openssl rand -hex 32)' >> .env

# 3. Apply schema
pnpm drizzle-kit generate
pnpm drizzle-kit migrate

# 4. Run unit tests
pnpm test

# 5. Start the dev server (Vite + tRPC together on :3000)
pnpm dev
```

Open `http://localhost:3000`. The first user to sign in is automatically promoted to
`admin` if their `openId` matches `OWNER_OPEN_ID`.

> The repository ships with a Manus OAuth integration. For a fully self-hosted
> deployment with no external auth provider, see the **"Disabling Manus OAuth"** section
> of `DEPLOYMENT_GUIDE.md`.

---

## Configuration surface

All knobs are stored in the `settings` table and are editable from `/settings`:

| Key | Purpose | Default |
|---|---|---|
| `routing.fast_model` | Model used when the routing heuristic returns `fast`. | `gpt-4o-mini` |
| `routing.smart_model` | Model used for `smart` tier. | `gpt-4o` |
| `routing.complexity_threshold` | Score threshold (0–1) above which the request escalates. | `0.55` |
| `apikey.openai` | Optional override for the OpenAI key (otherwise read from env). | — |
| `apikey.youtube`, `apikey.gmail_oauth`, `apikey.gdrive_oauth`, `apikey.facebook`, `apikey.instagram`, `apikey.tiktok` | Per-integration keys/tokens; unset keys cause those tools to run in stub mode. | — |

Environment variables (set in `.env` or your shell):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL/TiDB connection string. |
| `OPENAI_API_KEY` | OpenAI key for self-hosted mode. |
| `JWT_SECRET` | Signing secret for session cookies. |
| `PORT` | HTTP port (default `3000`). |

---

## How the agent loop works

1. The user types a message; the server appends it to `messages` and reconstructs the
   conversation history.
2. The model router scores the request (length, keyword bias, tool involvement) and
   chooses fast or smart.
3. The memory layer searches `memories` for the top-N relevant entries and prepends
   them as a system message.
4. The chat-completions call is issued with all 15 tool schemas attached.
5. If the model emits `tool_calls`, the server executes each tool, appends the result,
   and re-invokes the model. The loop terminates when the model returns plain text or
   after `MAX_TURNS = 6`.
6. The final assistant message is persisted along with the routing decision, the list
   of tool calls and statuses, and the memory hits — all of which are surfaced as
   inline badges under each message in the UI.

---

## Cost model

Solomon's bill scales with **how many smart-tier turns you trigger per day**, not with
a fixed subscription.

| Mode | Typical per-task cost | Daily cost @ 30 tasks |
|---|---|---|
| Fast (`gpt-4o-mini`) | $0.001–$0.003 | < $0.10 |
| Smart (`gpt-4o`) | $0.02–$0.06 | $0.60–$1.80 |

A reasonable default workload — morning brief, ~10 chat turns, weekly content draft,
hourly email check — runs comfortably in the **$20–$50/month** envelope on a $5/month
VPS. The router is the lever: raise the threshold to push more traffic to the cheap
tier, lower it when you want Solomon thinking harder.

---

## Project layout

```
client/                       # React 19 dashboard
  src/
    components/
      DashboardLayout.tsx     # Sidebar + auth + dark industrial shell
    pages/
      Chat.tsx                # Main agent surface
      Tasks.tsx               # Kanban
      Memory.tsx              # Read/edit long-term memory
      Tools.tsx               # Run any tool manually + audit log
      Finance.tsx             # Ledger
      Scheduler.tsx           # Autonomous job control
      Settings.tsx            # API keys + routing
drizzle/
  schema.ts                   # All tables
server/
  solomon/
    agent.ts                  # The tool-calling loop
    router.ts                 # Model tier heuristic
    tools.ts                  # 15 built-in tools + tool_run audit
    memory.ts                 # Search / scoring / CRUD
    scheduler.ts              # Cron parser + tick loop + handlers
    *.test.ts                 # Vitest specs
  routers.ts                  # tRPC procedures (chat, memory, tasks, finance, tools, settings, scheduler)
Dockerfile                    # Multi-stage build → ~150MB image
docker-compose.yml            # App + MySQL together
DEPLOYMENT_GUIDE.md           # VPS step-by-step
README.md                     # This file
```

---

## Adding a new tool

1. Define a schema and an `execute` handler in `server/solomon/tools.ts`:
   ```ts
   const myTool: SolomonTool = {
     schema: { type: "function", function: { name: "my_tool", description: "...", parameters: {...} } },
     async execute(input, ctx) { /* ... */ return { ok: true, status: "success", data: ... }; },
   };
   ```
2. Register it in the `SOLOMON_TOOLS` map.
3. The tool is now available to the agent loop **and** runnable from the Tools page.

Tools that wrap external APIs requiring OAuth should follow the existing pattern: read
the relevant secret via `getSecret('apikey.foo')`, return a `stub` status when missing,
and otherwise issue the real call. This keeps Solomon usable end-to-end on day one and
turns "production-ready" into a key-paste, not a code change.

---

## Tests

```bash
pnpm test
```

The included specs cover:

- The model-routing scorer (boundary, override, length and keyword bias, tool bias).
- The memory scorer (title vs content vs tag weighting, importance, pinning, fallback).
- The cron parser and `nextRun` (wildcards, steps, ranges, lists, malformed input).
- The auth-logout cookie clear (template baseline).

Solomon ships green: 20 tests, 4 files, ~1 second.

---

## License

MIT. Build, fork, modify, ship.

---

## Author

Built for Jedidiah Shultz (Building Shultz / Shultz Enterprises). Solomon is opinionated
on his behalf — plain-spoken, blue-collar, allergic to corporate filler. Adjust the
brand-voice memory entry to taste.
