# DISPATCH_SYSTEM.md — Solomon's Operations Manual

**Audience:** Sam, Nathan, Jed, and Tasia (if Jed is unavailable).
**Last updated:** 2026-05-30.
**TL;DR:** Solomon is the single point of contact for Jed. He routes work to Sam, Caleb, or himself using pre-approved templates. When uncertain, he consults Nathan via the Anthropic API. When confidence is too low, or the action is financial/legal/irreversible/personal, he escalates to Jed. He does NOT improvise prompts.

---

## The Cast

| Name     | What they are                                              | How Solomon reaches them                                |
|----------|------------------------------------------------------------|----------------------------------------------------------|
| Jed      | The owner. The single point of authority for big decisions. | Telegram chat 8762434280                                 |
| Solomon  | The 24/7 Telegram bot running on the VPS                   | Already running — this doc describes him                 |
| Sam      | Claude Code — the engineer who builds and ships features    | JSON job files dropped in `/root/solomon-v4/sam-queue/`  |
| Caleb    | Cowork desktop agent on Jed's PC — does browser/GUI work    | POST to PC relay `/caleb-task` endpoint                  |
| Nathan   | Claude chat strategist — second opinion on hard calls       | Anthropic API via `consultNathan()` in `nathan-bridge.js` |
| Tasia    | Jed's wife. Most important person in the operation.         | Never auto-contacted — always Jed first                  |

## The big picture

```
                    Jed (Telegram)
                          │
                          ▼
                  ┌──────────────────┐
                  │     Solomon      │
                  │  (bot.js + cron) │
                  └────────┬─────────┘
                           │
              dispatch.js classifies message
              against /dispatch-templates/*.json
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   confidence           Nathan band       confidence
   ≥ 0.85               0.60–0.85         < 0.60
   no safety            OR safety         OR no template
   flags                category                  │
        │                  │                      │
        ▼                  ▼                      ▼
    execute           consultNathan()       escalate to Jed
    directly            ┌────────┐            via Telegram
        │               ▼        ▼
        │           proceed   abort
        │               │        │
        └───────┬───────┘        ▼
                ▼            escalate to Jed
       route to handler
       (solomon / sam / caleb)
                │
                ▼
       report result back
       to Jed via Telegram
```

---

## Templates — the only way Solomon executes

A template is a frozen, pre-approved recipe for one specific task. Templates live as JSON files in `/root/solomon-v4/dispatch-templates/`. **Solomon does not write prompts at runtime.** He picks a template, fills in `{{variables}}`, and runs it.

### Adding or editing a template

1. Sam reviews the proposed change. Jed signs off if it's a new capability.
2. Copy an existing template file as a starting point.
3. Filename matches the `id` field exactly: `<id>.json`.
4. Write the `prompt_template` carefully — once shipped, the wording is frozen.
5. Add 2-4 `trigger_examples` covering how Jed might phrase the request.
6. Set `categories` honestly. See safety categories below.
7. Write a meaningful `smoke_test`.
8. Run `node /root/solomon-v4/dispatch-smoke-test.js <id>` and confirm PASS.
9. Commit the file with the matching change to any related code.

Full schema spec: `/root/solomon-v4/dispatch-templates/_SCHEMA.md`.

---

## Confidence thresholds (in `dispatch.js`)

| Confidence | Action                                                          |
|-----------|-----------------------------------------------------------------|
| **≥ 0.85** | Execute template directly. No Nathan call.                      |
| **0.60 – 0.85** | Silent Nathan consult, then execute (unless Nathan says no). |
| **< 0.60** | Escalate to Jed with a one-line summary: "This needs Nathan — <reason>". |
| **no template** | Escalate to Jed.                                            |

These are constants in `dispatch.js`: `EXECUTE_THRESHOLD = 0.85`, `CONSULT_THRESHOLD = 0.60`.

---

## Safety categories — the gates

Set in each template's `"categories": [...]` array.

### Hard safety (`IRREVERSIBLE_CATEGORIES` in `nathan-bridge.js`)

Any of these in a template's categories → Nathan is **NOT** called. The bridge short-circuits to `escalate_to_jed` and logs the would-be consult so Jed can see what Solomon was about to ask. **Nathan cannot authorize any of these. Only Jed can.**

- `financial` — bank transfers, payments, billing changes, pricing changes
- `legal` — LLC filings, signed documents, contracts, tax forms, trademark
- `irreversible` — KDP publish, account deletion, password rotation
- `sensitive_pii` — anything touching Tasia, the kids, health, or PII

### Cautious (`CAUTIOUS_CATEGORIES`)

Force a Nathan consult even at high classifier confidence. Nathan CAN authorize these.

- `public_brand` — FB/IG/YT posts, comment replies, anything outward-facing

### Examples

| Template                       | Categories               | Result                                       |
|--------------------------------|--------------------------|----------------------------------------------|
| `solomon_fb_reply`             | `[public_brand]`         | Nathan sanity-checks tone, then proceeds     |
| `caleb_mercury_upload`         | `[financial]`            | Always Jed (no Nathan call)                  |
| `jed_escalate_kdp_publish`     | `[irreversible, public_brand]` | Always Jed (handler is jed-escalate too) |
| `solomon_check_budget`         | `[]`                     | No category gate; executes directly          |
| `future_solomon_tasia_ops_manual` | `[sensitive_pii]`     | Always Jed                                   |

---

## How the Nathan bridge works

`/root/solomon-v4/nathan-bridge.js` exports `consultNathan(query)`. Every call:

1. If the query's categories include any hard category → short-circuit. Returns `{ recommendation: 'escalate_to_jed', must_escalate: true }` without calling the API. Logs the would-be query.
2. Otherwise, calls the Anthropic API with:
   - **System prompt**: "You are Nathan. The caller is *Solomon*, not Jed. Here is the full Shultz master context: <…>. You sharpen Solomon's decision; you don't invent new strategy. You filter through Jed's mission (the Tuesday vision). You never authorize financial/legal/irreversible/PII/brand."
   - **User message**: structured JSON with `sender: "solomon"`, task, confidence, context, proposed_action, question, categories.
3. Parses Nathan's compact JSON response: `{agreement, recommendation, modified_action, concerns, reasoning}`.
4. Appends the full exchange to `/root/solomon-v4/nathan-consult-log.json` (append-only, rolls to a dated file at 500 entries).

Solomon **never impersonates Jed to Nathan.** The system prompt explicitly identifies the caller as Solomon.

### Reading the consult log

`cat /root/solomon-v4/nathan-consult-log.json | jq '.[-5:]'` — last 5 consults.

Each entry includes: timestamp, task, confidence, the question Solomon asked, Nathan's full reply, the bridge action (consulted vs short-circuit), and the result.

---

## Sam queue (`/root/solomon-v4/sam-queue/`)

When Solomon dispatches a `sam` template, a JSON job file is written here. Sam reads the queue at the start of every Code session, sorts by priority, processes each job, then moves the file to `/root/solomon-v4/sam-queue-done/`.

Format and pickup protocol: `/root/solomon-v4/sam-queue/README.md`.

## Caleb relay (`/root/solomon-v4/caleb-relay.js`)

When Solomon dispatches a `caleb` template, a structured payload is POSTed to `${PC_RELAY_URL}/caleb-task` with the PC relay secret. The PC-side relay writes the payload into a queue directory on Jed's PC where Cowork picks it up.

**Pending PC-side work:** the PC relay does not yet expose `/caleb-task`. Until it does, `dispatchCaleb()` returns `{ ok: false, pending_setup: true }` and the failure is surfaced to Jed cleanly.

---

## Shadow mode vs live mode

Dispatch defaults to **shadow** mode — it runs the full classify + Nathan + route pipeline but does NOT actually fire handlers. Everything is logged to `/root/solomon-v4/dispatch-shadow-log.json`. This lets Jed review what Solomon would have done before flipping the switch.

Flip via Telegram: `/dispatch mode live` (and `/dispatch mode shadow` to flip back).
Or via environment: `DISPATCH_MODE=live` in `.env`.

The current mode is read from `mem('dispatch','mode')` and falls back to `process.env.DISPATCH_MODE`.

### The `/dispatch` slash command

Jed can manually route a message through dispatch with: `/dispatch <message>`. The result message shows the chosen template, confidence, decision, Nathan consult (if any), and the action result.

Free-text Telegram messages do NOT auto-dispatch yet. Wiring the auto-dispatch would require changing `bot.on('message')` to call the dispatcher before the normal LLM path. That's a deliberate next step — for now `/dispatch` is opt-in so Jed's existing conversational flow with Solomon is unbroken.

---

## How a typical request flows end-to-end

**Jed types** in Telegram: `reply to FB comment 12345 on building_shultz with: Thanks brother, appreciate you`

1. bot.js receives the message. If Jed used `/dispatch`, it routes through dispatch.js (otherwise normal LLM loop).
2. `dispatch.classifyAndRoute()` loads templates and asks Claude Sonnet 4.6 to pick the best match.
3. Classifier returns `{ template_id: "solomon_fb_reply", confidence: 0.93, inputs: { page: "building_shultz", comment_id: "12345", reply_text: "Thanks brother, appreciate you" } }`.
4. Template has `categories: ["public_brand"]` → forces a Nathan consult.
5. `consultNathan()` is called. Nathan reads the reply text, finds it benign, returns `{ recommendation: "proceed", agreement: 0.92, concerns: [] }`.
6. Decision becomes `execute_after_nathan`. Handler is `solomon`.
7. The solomon executor in bot.js calls `executeTool("reply_fb_comment", {...})`.
8. Reply is posted via the FB Graph API. Result returned to Jed via Telegram.
9. Nathan consult entry is appended to `nathan-consult-log.json`.

---

## Escalation rules (what triggers Jed)

Solomon escalates with `"This needs Nathan — <one-line reason>"` when:

- No template matches.
- Classifier confidence is below 0.60.
- Required inputs are missing.
- Template handler is `jed-escalate` or has `"irreversible": true`.
- Template's categories include a hard category (financial / legal / irreversible / sensitive_pii).
- Nathan was consulted and his recommendation is `abort` or `escalate_to_jed`.
- Nathan API call fails (fail-safe).

---

## Files at a glance

| Path                                            | Purpose                                       |
|-------------------------------------------------|-----------------------------------------------|
| `/root/solomon-v4/dispatch.js`                  | Classifier + router                           |
| `/root/solomon-v4/nathan-bridge.js`             | `consultNathan()` + safety categories         |
| `/root/solomon-v4/caleb-relay.js`               | Caleb payload builder + PC relay POST         |
| `/root/solomon-v4/dispatch-smoke-test.js`       | Dry-run test harness for every template       |
| `/root/solomon-v4/dispatch-templates/*.json`    | The template library                          |
| `/root/solomon-v4/dispatch-templates/_SCHEMA.md`| Template format spec                          |
| `/root/solomon-v4/dispatch-shadow-log.json`     | What dispatch would have done (shadow mode)   |
| `/root/solomon-v4/nathan-consult-log.json`      | Every Nathan consultation (append-only)       |
| `/root/solomon-v4/dispatch-smoke-results.json`  | Most recent smoke test results                |
| `/root/solomon-v4/sam-queue/`                   | Pending jobs for Sam to pick up               |
| `/root/solomon-v4/sam-queue-done/`              | Archived jobs Sam completed                   |
| `/root/solomon-v4/sam-queue/README.md`          | Sam's pickup protocol                         |

---

## For Tasia, if Jed is unavailable

You do not need to operate Solomon directly. He runs on his own. What you might need:

- **To see what Solomon is doing right now**: open Telegram, send `/status` to Solomon's Forge bot. He'll reply with a system snapshot.
- **To stop the campaign** (e.g. if a post is going out at a bad time): send `stop the campaign`. Solomon will disarm the 30-day auto-poster.
- **To get the morning brief on demand**: send `/brief`. He'll send the scorecard.
- **If Solomon stops responding for >1 day**: text Nathan. He has Sam's contact.
- **If a Facebook reply needs editing**: when Solomon sends a comment with ✅/✍️ buttons, tap ✍️ and type the replacement.
- **Never** approve a financial / legal / KDP-publish / bank-related request that Solomon flags. Wait for Jed.

The full operation can run hands-off for weeks. The auto-post engine, morning briefs, comment monitoring, and weekly content repurposing all keep going.

---

*Be Inspired. Stay Humble. And Build.*
