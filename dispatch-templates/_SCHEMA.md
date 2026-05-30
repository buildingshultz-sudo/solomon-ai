# Dispatch Template Schema

Every JSON file in this directory describes ONE pre-approved task Solomon can dispatch on Jed's behalf. Templates are the only way Solomon executes work — he does NOT improvise prompts. If no template matches a Jed message, Solomon either consults Nathan (60–85% confidence) or escalates to Jed directly (<60%).

## Required fields

```json
{
  "id": "short_snake_case_id",
  "name": "Human-readable name (one line)",
  "description": "One sentence: what this template does and when it fires.",
  "handler": "solomon | sam | caleb | nathan-consult | jed-escalate",
  "trigger_examples": [
    "natural-language phrasing Jed might use",
    "another phrasing"
  ],
  "prompt_template": "The full pre-approved prompt with {{variable}} placeholders. Solomon fills the variables — he never edits the surrounding text.",
  "required_inputs": ["var1", "var2"],
  "optional_inputs": ["var3"],
  "escalation_conditions": [
    "missing_required_input",
    "human-readable reasons that bump this to jed-escalate"
  ],
  "irreversible": false,
  "confidence_default": 0.9,
  "smoke_test": {
    "trigger_message": "Realistic Jed message that should fire this template",
    "expected_inputs_filled": ["var1", "var2"],
    "expected_handler": "solomon",
    "expected_escalation": false
  },
  "notes": "Optional free-text — gotchas, dependencies, related templates."
}
```

## Handlers

| handler | what happens |
|---|---|
| `solomon` | Solomon executes immediately (e.g. reply to a comment via FB API, send a Telegram message, run a known tool). |
| `sam` | A JSON job file is written to `/root/solomon-v4/sam-queue/` for the next Code session to pick up. |
| `caleb` | A structured payload is POSTed to the PC relay; Caleb (Cowork desktop agent on Jed's PC) executes. |
| `nathan-consult` | Template explicitly REQUIRES a Nathan consultation before any handler runs. Used for strategic decisions. |
| `jed-escalate` | Solomon does NOT execute — sends a one-line "this needs you" Telegram instead. Reserved for legal / financial / irreversible / sensitive. |

## Safety rules

- Any template with `"irreversible": true` automatically goes to `jed-escalate` regardless of confidence. Bank transfers, KDP publish, LLC filings, password resets, anything that can't be undone in 1 click.
- Templates with `"handler": "nathan-consult"` MUST treat Nathan's response as advisory only — Solomon still escalates to Jed if Nathan recommends against the action, or if the action is in the irreversible category.
- `prompt_template` text is FROZEN at write-time. Solomon fills `{{vars}}` but does NOT rewrite or paraphrase the surrounding instructions. Sam edits the template file if the wording needs to change.

## Confidence ladder (set by classifier in `dispatch.js`)

- **≥ 0.85** → execute template directly
- **0.60 – 0.85** → consultNathan() first, then execute (silently)
- **< 0.60** OR no template match → escalate to Jed with "This needs Nathan — <one-line reason>"

## How to add a new template

1. Copy an existing template file in this directory as a starting point.
2. Set a unique `id` (filename should match: `<id>.json`).
3. Write the `prompt_template` carefully — Sam reviews it.
4. Add 2-4 `trigger_examples` covering how Jed might phrase the request.
5. Define `required_inputs` and how each gets filled.
6. Write a meaningful `smoke_test`.
7. Run `node dispatch-smoke-test.js` to confirm classifier picks it up.
8. Commit the file.
