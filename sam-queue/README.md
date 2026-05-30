# Sam Queue

Job files (one JSON per task) for Sam (Claude Code) to pick up at the start of every Code session.

## Job file format

```json
{
  "task": "Human-readable name",
  "template_id": "matching id from /root/solomon-v4/dispatch-templates/",
  "handler": "sam",
  "variables": { "var1": "value", "var2": "value" },
  "filled_prompt": "the template prompt with variables already substituted",
  "priority": "high | normal | low",
  "created": "2026-05-30T19:00:00.000Z",
  "classifier": { "template_id": "...", "confidence": 0.92, "inputs": {...}, "rationale": "..." },
  "nathan_consult": null,
  "escalation_flag": false,
  "status": "pending | in_progress | completed | failed"
}
```

## Pickup protocol (for Sam at session start)

1. `ls /root/solomon-v4/sam-queue/*.json` — list pending jobs.
2. Sort by `priority` (high → normal → low), tiebreak by `created`.
3. For each pending job:
   - Read the file.
   - Update `status` to `"in_progress"` and `started_at` to now.
   - Execute the work described by `filled_prompt`.
   - On completion: update `status` to `"completed"`, set `completed_at`, write a `result` string summarizing what happened.
   - On failure: update `status` to `"failed"`, write `error` string.
   - Move the file to `/root/solomon-v4/sam-queue-done/` (preserve filename).
4. After all jobs processed, send a single Telegram summary to Jed via Solomon: `Sam session complete: N jobs done, M failed, K skipped.`

## What this is NOT

- Sam queue jobs are not interactive — they should be self-contained because Sam runs them without a human in the loop.
- Sam queue jobs do not include credentials — those come from `.env` on the VPS.
- Sam queue jobs do not authorize financial / legal / irreversible actions — those escalate to Jed via the dispatcher BEFORE a job is ever created.
