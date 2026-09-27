<!-- @file docs/demo/demo-script.md  @phase P13  @purpose Presenter runbook for the live/recorded BobOps demo. -->
# BobOps live demo runbook

> Keep this file open during recording. Read each step **before** performing it, not while performing it.

---

## Pre-flight (T-30 min) — Task 13.2

- [ ] `pnpm test` → green. `git status` → clean. `git pull`.
- [ ] `.env` is complete (IBM, AWS, GitHub, APPROVAL_TOKEN, SECRET_ADMIN_TOKEN). `apps/control-center/.env.local` token matches.
- [ ] `pnpm build:mcp` has been run, and in Bob's MCP panel **bobops-orchestrator** is green with 17 tools.
- [ ] The Bob mode picker shows **🛰️ Multi-Cloud DevOps Engineer**. Check your Bobcoin balance (≥ 5 per take).
- [ ] Clouds are pre-warmed: IBM Code Engine app `bobops-nimbus-books` and Lambda `bobops-nimbus-books` exist (from Phase 6/7/8).
- [ ] No open sentinel issues: `gh issue list --label sentinel-incident` is empty (close leftovers).
- [ ] Screen: 1920×1080 at 100% zoom. Left half: IBM Bob. Right half: browser with 3 tabs:
      ① `http://localhost:3000`, ② GitHub → Actions → health-sentinel, ③ GitHub → Issues. Notifications off (Focus assist).
- [ ] Start OBS (or Xbox Game Bar `Win+Alt+R`) recording at 1080p/30fps with the microphone on.

---

## Reset to "before Bob" state (T-5 min) — Task 13.3

```powershell
# stop any running dev servers first (Ctrl+C)
pnpm demo:reset          # removes generated assets + orchestrator store
git status               # must show NO Dockerfile / lambda.ts in apps/demo-service
pnpm dev                 # orchestrator :4000 + control center :3000
```

Open `http://localhost:3000`. It should show 2 connected providers and **no runs**.

---

## Act 1: from repository to verified multi-cloud (~6–8 min live, ~70 s in the video) — Task 13.4

| # | You do | Bob / system does | Say (voice-over) |
|---|---|---|---|
| 1 | New Bob task → mode **🛰️ Multi-Cloud DevOps Engineer** → type: `/deploy apps/demo-service Deploy Nimbus Books to IBM Cloud and AWS with verified health. Test the approval guard once before I approve.` | Bob asks how often you want the sentinel to check in | "One sentence. Bob now owns the release, and I own the decisions." |
| 1b | Reply: "every 15 minutes" | Creates a todo list, calls `devops_list_providers` and `devops_create_run` with `sentinelIntervalMinutes: 15` | "I get to decide how closely this gets watched, not just whether it gets deployed." |
| 2 | Point at Bob's subagent panel | **4 specialists run in parallel** (analyst, architect, security, release) | "Four specialist subagents read the repo in parallel. That's real parallelism, not a script." |
| 3 | Switch to the Control Center run page (Bob gives the link) | UNDERSTAND lights up with specialist cards and evidence refs | "Every finding cites a file." |
| 4 | Watch the Bob chat | Bob generates the Dockerfile, .dockerignore, .ceignore and src/lambda.ts, then builds to verify | "The repo had no deployment setup. Bob wrote it and proved it builds." |
| 5 | — | `devops_submit_plan`, then **the guard test: `devops_execute_plan` returns 403**. The audit trail shows a red `guard.blocked`. | "Bob just tried to deploy without me, and the orchestrator refused. Approvals are bound to the plan's hash." |
| 6 | In the Control Center, review the plan — point at the kind badge and rationale text on each cloud's card (🔒 secret refs, risks, cost) → click **Approve** | `devops_wait` returns, then `devops_execute_plan` | "This isn't a fixed template — Bob picked always-on for IBM because it's the judged endpoint, and on-demand for AWS because it's secondary. Two real architectures, one decision each, and I approve exactly this plan, byte for byte." |
| 7 | Watch the stepper | TEST ✓ → PROVISION → BUILD (Code Engine builds from source, Lambda bundles) → DEPLOY → VERIFY | "Tests gate the release. IBM Cloud Code Engine and AWS Lambda deploy in parallel." |
| 8 | Click both endpoint links (the /health JSON shows `revision`) | Bob prints the verification table: provider, endpoint, HTTP 200, latency, revision | "Healthy is a claim with evidence: status, latency and revision on both clouds." |

---

## Act 2: break it, detect it, recover it (~5–6 min live, ~60 s in the video) — Task 13.5

| # | You do | System / Bob does | Say |
|---|---|---|---|
| 1 | Open the run page with `&demo=1` and click **⚡ Inject controlled fault** on the **IBM Cloud** card | Code Engine rolls a revision without `CATALOG_MODE` (≈ 30–60 s) | "Now a classic 2 a.m. config drift: a required value disappears." |
| 2 | GitHub tab ② → **Run workflow** (health-sentinel) | 3 probes, 3 × 503, **red run**, issue opened with JSON evidence | "An independent GitHub sentinel probes every cloud. Three strikes and it files an incident with the evidence attached." |
| 3 | Issues tab ③: open the issue (show the table and the JSON block) | The orchestrator imports it within 60 s (or click **Sync sentinel**). The run turns **INCIDENT**. | — |
| 4 | Bob: new task (same mode) → `/investigate` | sync → get_incident → get_logs → reads `src/config.ts` → **records the diagnosis with cited evidence** → proposes `set_env CATALOG_MODE=featured` (risk low) | "Bob correlates the probe body, the logs, the code and the approved plan. It's config drift, and the smallest safe fix is to restore the approved value." |
| 5 | Control Center: the purple diagnosis card and the remediation approval card → **Approve** | `devops_execute_remediation` → Code Engine update → **re-verified healthy** | "Again: Bob proposes, I approve, and the system verifies." |
| 6 | Issues tab: refresh | The issue is **closed automatically** with a recovery comment (diagnosis, action, MTTR, probe table) | "The loop closes itself, with evidence." |

---

## Closing shot (~20 s) — Task 13.6

- [ ] Run page: scroll the **audit trail** from bottom to top (repository → plan → approval → deploy → incident → recovery),
      click the **verification** filter, and show the metrics strip (time to verified multi-cloud, MTTR, 2 approvals,
      ≥ 1 unsafe action blocked).
- [ ] Bob exports the evidence automatically (`devops_export_evidence`). Open `evidence/demo-runs/<runId>.md` for 2 seconds.
- [ ] Say: *"Repository in, verified on two clouds, broken, and recovered, with every step evidenced and every change approved.
      That's BobOps, powered by IBM Bob."*

---

## Evidence capture (MANDATORY for judging) — Task 13.7

Save these to `evidence/bob-task-summaries/`:

| File | What |
|---|---|
| `demo-01-deploy-task-summary.png` | Bob's task session summary for the `/deploy` task |
| `demo-02-parallel-subagents.png` | The aggregate subagent panel with the 4 specialists |
| `demo-03-guard-blocked.png` | Bob's chat showing the 403 approval_required |
| `demo-04-verification-table.png` | Bob's final verification table |
| `demo-04b-architecture-rationale.png` | Control Center plan panel: kind badges + "Why this architecture" rationale per cloud |
| `demo-05-investigate-task-summary.png` | Bob's task session summary for `/investigate` |
| `demo-06-diagnosis.png` | Bob's recorded diagnosis with evidence |

Save these to `evidence/demo-runs/`:
- `ui-run-healthy.png`, `ui-approval-card.png`, `ui-incident-resolved.png`
- `github-sentinel-red-run.png`, `github-issue-closed.png`
- The exported `<runId>.json` and `<runId>.md` from `devops_export_evidence`

After capturing: write down the real **time to verified** and **MTTR** from the metrics strip. Phase 14 puts them in the README.

```powershell
git add -A
git commit -m "docs(p13): demo evidence"
git push
```

---

## Recording tips — Task 13.8

- Record Act 1 and Act 2 as separate clips, and cut the Code Engine build wait (show a "⏩ 3 min later" card).
- Keep the Control Center visible whenever you click Approve. **That click is the key moment.**
- If Bob hesitates or asks a question, answer briefly ("yes, continue"). Never type tokens or secrets into Bob.
- Fallback if Bob's generated assets fail to build: `pnpm demo:golden` (say "restoring the verified template"), then ask Bob to continue.
- Fallback if the GitHub dispatch is slow: click **Re-verify now** in the Control Center. The orchestrator opens the incident
  itself (source: orchestrator). The rest of the story is identical.
