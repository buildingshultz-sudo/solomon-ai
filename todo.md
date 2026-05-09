# Solomon 2.0 — Project TODO

## Foundation
- [x] Database schema: memories, tasks, finance_entries, conversations, messages, brand_profile, settings, scheduled_jobs, tool_runs
- [x] Apply migration via webdev_execute_sql
- [x] Seed brand_profile + default settings + sample memories
- [x] Dark industrial theme (CSS variables, fonts, textures)

## Server (tRPC)
- [x] Model routing helper (simple/complex tiers using invokeLLM)
- [x] Tool registry (YouTube, Gmail, Drive, Social, Web research, FFmpeg, Files, Finance, Tasks)
- [x] Tool execution loop with function calling
- [x] Memory write/read/search (text similarity scoring fallback when no embeddings)
- [x] Scheduler (morning brief generator, scheduled task runner, email monitor stub)
- [x] Routers: chat, memory, tasks, finance, tools, settings, scheduler

## UI
- [x] DashboardLayout adapted to dark industrial Solomon brand
- [x] Sidebar nav with Chat, Tasks, Memory, Tools, Finance, Settings
- [x] Chat page (streaming, tool call traces, model badge)
- [x] Tasks page (kanban-ish board, priority, due dates)
- [x] Memory page (browse + edit + create + delete)
- [x] Tools page (list + manual run + status)
- [x] Finance page (ledger, totals, categories)
- [x] Settings page (API keys, model routing, scheduler prefs, system status)
- [x] Owner notifications wired for morning brief / scheduled task / email flag

## Quality
- [x] Vitest coverage for: model router, tool registry, memory search, scheduler tick
- [x] README.md (project overview, setup)
- [x] DEPLOYMENT_GUIDE.md (VPS deployment)

## Delivery
- [x] Final checkpoint
- [x] Push to private GitHub repo buildingshultz-sudo/solomon-ai
