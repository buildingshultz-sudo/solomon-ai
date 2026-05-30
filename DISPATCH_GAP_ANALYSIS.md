# Dispatch System — Gap Analysis & Future-Proofing Report

**Generated:** 2026-05-30
**Coverage:** Templates built, gaps identified, future roadmap (Solomon Phases 8–10, 12-app roadmap, hiring + S-Corp + Tasia-ops triggers).

---

## Templates built — 28 total

### By handler

| Handler             | Count | Templates                                                                                                                                  |
|---------------------|-------|--------------------------------------------------------------------------------------------------------------------------------------------|
| **solomon**         | 11    | fb_reply, generate_image, cross_post, send_morning_brief, campaign_launch, campaign_stop, status_check, check_budget, ironedit_pipeline_kick (PLACEHOLDER), future_debt_snowball_alert (PLACEHOLDER), future_tasia_ops_manual (PLACEHOLDER) |
| **sam**             | 7     | token_refresh, playwright_setup, stripe_audit, affiliate_push, instagram_link, build_feature, future_tradequote_kickoff (PLACEHOLDER)      |
| **caleb**           | 4     | affiliate_link_verify, gmail_labels_setup, mercury_upload (irreversible), kdp_upload                                                       |
| **nathan-consult**  | 3     | strategy_question, future_s_corp_threshold (PLACEHOLDER), future_hire_first_va (PLACEHOLDER)                                               |
| **jed-escalate**    | 3     | kdp_publish, financial_decision, legal_filing                                                                                              |

### By safety category

- **financial**: `jed_escalate_financial_decision`, `caleb_mercury_upload` (also irreversible), `future_s_corp_threshold` (also legal), `future_hire_first_va`
- **legal**: `jed_escalate_legal_filing` (also irreversible), `future_s_corp_threshold`
- **irreversible**: `jed_escalate_kdp_publish` (also public_brand), `jed_escalate_financial_decision`, `jed_escalate_legal_filing`, `caleb_mercury_upload`
- **sensitive_pii**: `future_solomon_tasia_ops_manual`
- **public_brand**: `solomon_fb_reply`, `solomon_cross_post`, `solomon_campaign_launch`, `sam_token_refresh`, `sam_affiliate_push`, `sam_instagram_link`, `jed_escalate_kdp_publish`
- **(no category)**: 13 templates

### Templates covering future roadmap

- `future_solomon_debt_snowball_alert` — needs Mercury bank wired
- `future_solomon_s_corp_threshold` — needs revenue-tracking signal
- `future_solomon_hire_first_va` — needs revenue + Jed-hours signal
- `future_solomon_tasia_ops_manual` — runnable today, gated on Jed approval
- `future_solomon_tradequote_kickoff` — needs IronEdit first paying customer (App #2 gate)
- `solomon_ironedit_pipeline_kick` — needs `iron_edit_start` tool (IronEdit Phase 2)

---

## Gaps — known tasks without a template yet

These are work items from the current Sam/Cowork queue (master context sections 7, 8) and the broader operation that I deliberately did NOT template because they're either one-shot, too vague to template usefully, or covered well enough by existing slash commands. Listed here so they're not forgotten.

### Operational gaps

| Gap                                       | Why no template                              | Where to add                            |
|-------------------------------------------|----------------------------------------------|-----------------------------------------|
| Solomon ↔ Cowork conflict detection       | This is a build task, not a per-request dispatch — Sam will ship it as code. | One-shot `sam_build_feature` will cover this when Jed asks. |
| Weekly revenue report                     | Already a fixed cron in scheduler.js (Mon 6 AM); no dispatch needed. | n/a — runs autonomously |
| YouTube milestone monitor                 | Already a fixed cron (every 6h); no dispatch needed. | n/a |
| KDP daily royalty scrape                  | Already a fixed cron (5:50 AM); no dispatch needed. | n/a |
| Email triage                              | Already a fixed cron (every 5 min); no dispatch needed. | n/a |
| FB comment monitor auto-reply             | Already inline-button flow (Session 7); no dispatch needed. | n/a |
| Campaign post preview/approve             | Already inline-button flow (Session 7); no dispatch needed. | n/a |
| File cleanup (Caleb)                      | Too vague to template — needs a per-job spec. | Add when Jed defines the rules. |
| Connector status (Caleb)                  | Similar — needs the spec for "which connectors, what counts as healthy." | Add with spec. |
| INBiz downloads (Caleb)                   | One-shot — most paperwork was downloaded during LLC filing. | Add a `caleb_inbiz_download_filing` template if it becomes recurring. |
| API budget alerts                         | Already wired into the morning brief scorecard. | n/a |
| VPS health monitoring                     | Should be a cron, not a dispatch template. | TODO Sam: add VPS-health cron job |

### Future roadmap gaps requiring NEW infrastructure (not just templates)

| Future need                              | Infrastructure required                                                       | Status                |
|------------------------------------------|--------------------------------------------------------------------------------|------------------------|
| IronEdit pipeline trigger                | DaVinci Resolve Studio purchase + DaVinci MCP bridge + iron_edit_start tool   | template staged       |
| TradeQuote AI (App #2)                   | IronEdit must have ≥1 paying customer first (roadmap gate)                    | template staged       |
| Debt snowball alerts                     | Mercury bank wired + transaction ingestion job                                | template staged       |
| S-Corp election trigger                  | Revenue-tracking signal (likely from Mercury or quarterly bookkeeping)        | template staged       |
| Hiring milestone trigger                 | Revenue + Jed-hours signal                                                    | template staged       |
| Tasia operations manual auto-generation  | Already buildable today — gated on Jed approval (sensitive_pii)               | template staged       |
| Gumroad product updates                  | Gumroad API or Playwright session; no template yet                            | **GAP — no template** |
| KDP pricing changes                      | KDP Playwright session can do this (extension of caleb_kdp_upload pattern)    | **GAP — no template** |
| Franchise / licensing templates          | Phase-10 work (S&H Rentals); too early to template usefully                   | **GAP — by design**   |
| Phase 9 revenue engine (Stripe, funnels, ads) | Each sub-system needs its own template family — landing pages, ad pixels, attribution | **GAP — Phase 9 multi-month build** |
| Phase 10 organizational director (multi-agent, hiring, Tasia ops) | Most templated above; full multi-agent orchestration is itself a build | **GAP — Phase 10 future** |

---

## Tasks that currently need Nathan but could be templated later

These are decisions Jed has historically asked Nathan about — once we see a pattern repeating, we templatize them.

- **Pricing decisions** for products (book, blueprint, future apps) — currently `nathan_strategy_question` handles ad-hoc. After 5+ pricing changes we'll see a pattern and can templatize "Solomon proposes a price test with N variants."
- **Campaign sequencing** — when to launch what to which audience. Today: Nathan strategy. Future: a `solomon_campaign_sequence_propose` template that drafts a 30/60/90 day plan from Jed's product list.
- **"Should I outsource this?"** type questions — captured in `future_solomon_hire_first_va` but only triggers on hiring-specific phrasings. Broader "should I do X myself or pay someone" questions still go to Nathan ad-hoc.
- **Audience positioning shifts** — when Building Shultz wants to test new content style. Today: strategy. Future: an A/B-content template that runs both versions and reports back.

---

## Smoke test results (latest run)

- **Total templates tested:** 28
- **Passed:** 28 (100%)
- **Failed:** 0
- **Nathan consults during run:** 13 (every public_brand + nathan-consult + 0.60-0.85 confidence path)
- **Nathan bridge call success rate:** 100% (all calls returned parseable JSON; none short-circuited unexpectedly)

Full results in `/root/solomon-v4/dispatch-smoke-results.json`.

### Smoke test coverage

Every template's `smoke_test.trigger_message` is run through the live classifier + Nathan bridge in dryRun (shadow) mode. The harness verifies:

1. The classifier picks the **correct template** (no other template wins on the trigger phrasing).
2. The decision tree routes to the **expected handler / escalation state**.
3. **Required inputs** are successfully extracted from the trigger message.
4. **Escalation** triggers correctly when expected.

A failure means the template's `smoke_test` expectation doesn't match what the system actually does — fix EITHER the template OR the expectation, then re-run.

---

## Recommended next builds — priority order

1. **PC-side `/caleb-task` endpoint.** Right now any caleb template will hit "endpoint missing" because the PC relay doesn't expose `/caleb-task` yet. This is the single most leveraged build — once shipped, 4 templates unlock immediately (`caleb_affiliate_link_verify`, `caleb_gmail_labels_setup`, `caleb_kdp_upload`, and Mercury-once-approved).

2. **Auto-dispatch on free-text messages (live mode in `bot.on('message')`).** Right now Jed must prefix with `/dispatch`. The next step is to make dispatch transparent — every non-slash message goes through the classifier in shadow mode first; if classifier confidence is high and Jed has flipped to live mode, dispatch fires. **Recommended approach:** ship as a per-user toggle so existing conversational habits aren't broken.

3. **Mercury bank integration.** Unlocks `future_solomon_debt_snowball_alert`, eventually `future_solomon_s_corp_threshold` and `future_solomon_hire_first_va`. Requires Jed to wire Mercury OAuth or Plaid.

4. **Gumroad and KDP write-side templates.** Both are common product-management actions Jed does manually today. Templates would let him say "lower the book price to $7.99 for the weekend" and have Solomon handle it (with Nathan and Jed gates because of the financial category).

5. **iron_edit_start tool + IronEdit pipeline templates.** Gated on Resolve Studio purchase. Once that lands, two templates need to ship in tandem: the trigger template (already staged) and a job-status check template.

6. **VPS health cron + alert template.** Disk space, memory, restart counts, PM2 unhealthy state. Should ping Jed when something needs attention.

7. **Auto-dispatch logging dashboard.** Read shadow-log.json + nathan-consult-log.json + dispatch-smoke-results.json into the existing solomon-dashboard so Jed can audit at a glance.

---

## Architectural notes for whoever picks this up next

- **The templates are the contract.** Don't bypass them with ad-hoc prompts inside bot.js. If a new pattern emerges, write a template.
- **Nathan is for sharpening, not strategy creation.** When Solomon doesn't know what to do, the answer is "escalate to Jed," not "ask Nathan to invent it."
- **Categories are load-bearing.** A wrong category (e.g. forgetting `financial` on a money-touching template) will silently let Solomon auto-execute something he shouldn't. Be conservative.
- **Shadow mode is the default for a reason.** Live mode should only be enabled after Jed has reviewed the shadow log for a few days and confirmed the dispatcher is making sane calls.
- **Every Nathan call costs money.** ~$0.005 per call. The 0.60-0.85 confidence band is the biggest spend lever. Tune `CONSULT_THRESHOLD` if the volume gets unreasonable.
