# caleb-runner.js — Security Model

**Status:** ⚠ tightly scoped but not sandboxed. Read this before adding the runner to Task Scheduler, especially at SYSTEM level.

## Threat model

The runner reads JSON files from `C:\Users\Ashle\Solomon\caleb-queue\` and executes their `caleb_steps` array. The `powershell` action runs arbitrary shell commands. **Anyone with write access to the queue dir can execute arbitrary code under whatever user the runner runs as.**

Write access to the queue dir today:
- **Jed** (the user account) — by default, expected
- **The pc-relay process** — it accepts queue inserts via `POST /caleb-task` from anyone who knows `PC_RELAY_SECRET`
- **Anything that runs as Ashle or higher** — can drop a file directly

The relay's secret is the gate. If `PC_RELAY_SECRET` leaks, an attacker with network reach to port 7777 (or to the VPS that holds the secret) can queue powershell-action tasks the runner will execute.

## Privilege recommendation

**Run the runner as the user Ashle, NOT as SYSTEM.** Same recommendation as caleb-worker (T3 yesterday).

| Mode | Pro | Con |
|---|---|---|
| User account (recommended) | Damage is bounded to what Ashle can do without UAC — no kernel access, can't disable Defender, can't touch other users | UAC prompts will block tasks that need elevation (most desktop automation doesn't) |
| SYSTEM (Task Scheduler) | No UAC friction, runs at boot | A malicious queue file can do anything on the machine |

Pick SYSTEM only when (a) the runner has been hardened further (signed task files, allowlist, etc.) AND (b) a clear use case needs it that the user account can't satisfy.

## Built-in guards

### powershell action denylist
Patterns (case-insensitive regex) the runner **refuses to execute**:
```
Remove-Item ...\Windows...     format A:/B:/C:/D:    cipher /w
bcdedit                         reg delete HKLM|HKCR|HKU
Stop-Computer / Restart-Computer / shutdown
diskpart                        Clear-Disk
Set-ItemProperty HKLM:|HKCU:|HKCR:
Invoke-WebRequest ... | Invoke-Expression  (curl|iex remote-exec pattern)
IEX(...)                        DownloadString(...)  (Net.WebClient drop+iex)
```

The denylist is **bare-minimum sanity**, not a comprehensive sandbox. An attacker who controls the queue file can almost certainly find a way around it. Use the denylist as a "did I make a copy-paste mistake?" guard, not as an "is this safe from a hostile queue?" guard.

### audit trail
- **Every powershell execution is journaled BEFORE the command runs** (to `caleb-queue\activity-journal.jsonl`). If the command kills the runner mid-execution, the audit row is still on disk.
- **First 120 chars of the command + the full command in the journal** + first 500 chars of stdout post-run.
- **caleb-runner.log** rotates at 10 MB; per-task **`<task_id>.result.json` sidecar** has every step's params + result + timing.
- **Screenshots between every browser step** (lossy JPEG q60) to `caleb-queue\screenshots\<task_id>\`.

### auth state isolation
- `auth_context: "youtube" | "instagram" | "kdp" | "canva"` → reads `C:\Users\Ashle\Solomon\auth-states\.pw_state_<context>.json`.
- `auth_context: "chrome_profile"` → `launchPersistentContext` against the user's real Chrome profile. **Most permissive option** — anything signed into Chrome is in scope (Gmail, Google Drive, Mercury, KDP, etc.). Use only when a captured storageState won't work.
- `auth_context: "none"` → blank Chromium, no cookies. Safest for testing.
- **Auth-missing short-circuit**: if the requested context's state file doesn't exist, the runner refuses to start the browser and writes `status: "auth_missing"` to the result sidecar.

### schema gate
Tasks with `caleb_steps` as plain-English strings (the old human-readable format) are **rejected** with `status: "schema_mismatch"`. Only structured `{action, ...params}` steps execute. This prevents a human-readable task from accidentally being interpreted by some future LLM-step-translator that hasn't been audited.

## Things to harden if you ever want SYSTEM-level scheduling

In rough priority order:

1. **HMAC-signed queue files.** Require every queue JSON to carry an HMAC signature over its content, keyed with a secret only the VPS knows. Runner rejects unsigned files. Cuts the attack surface to "VPS compromise" instead of "anyone with file-write access to the queue dir".
2. **Allowlist of `powershell` commands per template_id.** Tasks declare their `template_id` (e.g. `caleb_canva_kdp_cover_fix`) and the runner consults a registry of permitted commands per template. Free-form `powershell` step is then prohibited; the template must pre-declare the command.
3. **Per-task expiration.** Require `dispatched_at` within the last 24h. Stale queue files don't execute (prevents replay if an old queue snapshot is restored).
4. **Don't run as SYSTEM.** Even with the above, keep it as the user account unless there's a hard need.
5. **Network egress lockdown.** Run the Playwright Chrome under a Windows Firewall rule that allows only required hosts (canva.com, kdp.amazon.com, etc.). Painful but eliminates the "powershell command exfils data" risk.

## What this doc does NOT cover

- Browser exploits via malicious sites (Playwright Chromium auto-updates handle most of these but not all)
- Supply-chain risk in the `playwright` package itself (`npm install` trust)
- Physical access to the PC
- Anything on the VPS side — that has its own security model documented elsewhere
