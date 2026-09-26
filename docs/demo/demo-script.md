<!-- @file docs/demo/demo-script.md @phase P13 @purpose Presenter runbook for the live/recorded AXIS (BobOps) demo. -->
# AXIS live demo runbook

### Task 13.2 — Pre-flight (T-30 min)

- [ ] `pnpm test` → green. `git status` → clean. `git pull`.
- [ ] `.env` is complete (IBM, AWS, GitHub, APPROVAL_TOKEN, SECRET_ADMIN_TOKEN). `apps/control-center/.env.local` token matches.
- [ ] `pnpm build:mcp` has been run, and in Bob's MCP panel **bobops-orchestrator** is green with 17 tools.
- [ ] The Bob mode picker shows **🛰️ Multi-Cloud DevOps Engineer**. Check your Bobcoin balance (≥ 5 per take).
- [ ] Clouds are pre-warmed: IBM Cloud Cloudant + WML and AWS Lambda `bobops-nimbus-books` are connected.
- [ ] No open sentinel issues: `gh issue list --label sentinel-incident` is empty (close leftovers).
- [ ] Screen: 1920×1080 at 100% zoom. Left half: IBM Bob. Right half: browser with 3 tabs:
      ① `http://localhost:3000`, ② GitHub → Actions → health-sentinel, ③ GitHub → Issues. Notifications off (Focus assist).
- [ ] Start OBS (or Xbox Game Bar `Win+Alt+R`) recording at 1080p/30fps with the microphone on.

### Task 13.3 — Reset to the "before Bob" state (T-5 min)

```powershell
# stop any running dev servers first (Ctrl+C)
pnpm demo:reset          # removes generated assets + orchestrator store
git status               # must show NO Dockerfile / lambda.ts in apps/demo-service
pnpm dev                 # orchestrator :4000 + control center :3000
```

Open `http://localhost:3000`. It should show connected providers and **no runs**.

### Task 13.4 — Act 1: from repository to verified multi-cloud (≈ 6–8 min live, cut to ~70 s in the video)

| # | You do | Bob / system does | Say (voice-over) |
|---|---|---|---|
| 1 | New Bob task → mode **🛰️ Multi-Cloud DevOps Engineer** → type: `/deploy apps/demo-service Deploy Nimbus Books to IBM Cloud and AWS with verified health. Test the approval guard once before I approve.` | Bob asks how often you want the sentinel to check in | "One sentence. Bob now owns the release, and I own the decisions." |
| 1b | Reply: "every 15 minutes" | Creates a todo list, calls `devops_list_providers` and `devops_create_run` with `sentinelIntervalMinutes: 15` | "I get to decide how closely this gets watched, not just whether it gets deployed." |
| 2 | Point at Bob's subagent panel | **4 specialists run in parallel** (analyst, architect, security, release) | "Four specialist subagents read the repo in parallel. That's real parallelism, not a script." |
| 3 | Switch to the Control Center run page (Bob gives the link) | UNDERSTAND lights up with specialist cards and evidence refs | "Every finding cites a file." |
| 4 | Watch the Bob chat | Bob generates the Dockerfile, .dockerignore, .ceignore and src/lambda.ts, then builds to verify | "The repo had no deployment setup. Bob wrote it and proved it builds." |
| 5 | — | `devops_submit_plan`, then **the guard test: `devops_execute_plan` returns 403**. The audit trail shows a red `guard.blocked`. | "Bob just tried to deploy without me, and the orchestrator refused. Approvals are bound to the plan's hash." |
| 6 | In the Control Center, review the plan — point at the kind badge and rationale text on each cloud's card (🔒 secret refs, risks, cost) → click **Approve** | `devops_wait` returns, then `devops_execute_plan` | "This isn't a fixed template — Bob picked always-on for IBM because it's the primary catalog, and on-demand for AWS because it's secondary. Two real architectures, one decision each, and I approve exactly this plan, byte for byte." |
| 7 | Watch the stepper | TEST ✓ → PROVISION → BUILD (Lambda bundles, IBM resources verify) → DEPLOY → VERIFY | "Tests gate the release. Cloud endpoints deploy and configure in parallel." |
| 8 | Click endpoint links (the /health JSON shows `revision`) | Bob prints the verification table: provider, endpoint, HTTP 200, latency, revision | "Healthy is a claim with evidence: status, latency and revision on both clouds." |

### Task 13.5 — Act 2: break it, detect it, recover it (≈ 5–6 min live, cut to ~60 s)

| # | You do | System / Bob does | Say |
|---|---|---|---|
| 1 | Open the run page with `&demo=1` and click **⚡ Inject controlled fault** | Fault injected: `CATALOG_MODE` removed | "Now a classic 2 a.m. config drift: a required value disappears." |
| 2 | GitHub tab ② → **Run workflow** (health-sentinel) | 3 probes, 3 × 503, **red run**, issue opened with JSON evidence | "An independent GitHub sentinel probes every cloud. Three strikes and it files an incident with the evidence attached." |
| 3 | Issues tab ③: open the issue (show the table and the JSON block) | The orchestrator imports it within 60 s (or click **Sync sentinel**). The run turns **INCIDENT**. | — |
| 4 | Bob: new task (same mode) → `/investigate` | sync → get_incident → get_logs → reads `src/config.ts` → **records the diagnosis with cited evidence** → proposes `set_env CATALOG_MODE=featured` (risk low) | "Bob correlates the probe body, the logs, the code and the approved plan. It's config drift, and the smallest safe fix is to restore the approved value." |
| 5 | Control Center: the purple diagnosis card and the remediation approval card → **Approve** | `devops_execute_remediation` → Lambda/Cloud update → **re-verified healthy** | "Again: Bob proposes, I approve, and the system verifies." |
| 6 | Issues tab: refresh | The issue is **closed automatically** with a recovery comment (diagnosis, action, MTTR, probe table) | "The loop closes itself, with evidence." |

### Task 13.6 — Closing shot (≈ 20 s)

- [ ] Run page: scroll the **audit trail** from bottom to top (repository → plan → approval → deploy → incident → recovery),
      click the **verification** filter, and show the metrics strip (time to verified multi-cloud, MTTR, 2 approvals,
      ≥ 1 unsafe action blocked).
- [ ] Bob exports the evidence automatically (`devops_export_evidence`). Open `evidence/demo-runs/<runId>.md` for 2 seconds.
- [ ] Show the **Watson Agent** tab: Ask "What is the state of the Cloudant database and our latest recovery?" and showcase the live IBM watsonx.ai synthesis.
- [ ] Say: *"Repository in, verified on multi-cloud, broken, and self-healed, with every step evidenced and every change approved.
      That's AXIS, powered by IBM Bob and IBM watsonx.ai."*
