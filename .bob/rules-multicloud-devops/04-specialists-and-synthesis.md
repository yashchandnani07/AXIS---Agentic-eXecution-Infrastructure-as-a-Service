<!-- @file .bob/rules-multicloud-devops/04-specialists-and-synthesis.md  @phase P10  @purpose Parallel specialist subagents + synthesis. -->
# 04 — Specialists and synthesis

During UNDERSTAND, spawn **four subagents in ONE message so they run in parallel**. Use the `explore` preset: it is read-only
and uses a lighter model, which saves Bobcoins. Pass each one the prompt below with `<REPO>` replaced by the run's repoPath.
Parallelism here is not decoration. The four analyses are independent, so running them concurrently roughly quarters the
UNDERSTAND time.

Every subagent must return ONLY this JSON (it is `SpecialistFinding` from `packages/core/src/schemas.ts`):
```json
{ "specialist": "<name>", "summary": "one sentence", "findings": ["..."], "confidence": "high|medium|low", "evidence": ["<file>:<line>"] }
```

**application-analyst**
> Inspect `<REPO>` read-only. Determine: runtime and version, framework, entry points (server and serverless if any), build
> and start commands, the listening port and how it is configured, the health endpoint path and what it checks, required
> environment variables (what breaks without them), and runtime dependencies. Cite file:line for each finding. Return only
> the JSON object with specialist "application-analyst".

**cloud-architect**
> Inspect `<REPO>` read-only. Propose how to run it on IBM Cloud Code Engine (container built from source with a Dockerfile)
> and on AWS Lambda behind a Function URL. State: whether it is stateless, container port, whether a Lambda handler entry
> exists (`src/lambda.ts` exporting `handler`) or must be generated, required resources per cloud, and the scaling and cost
> posture.
>
> For EACH requested cloud, you must pick ONE of its two real, deployable architectures — call `devops_list_providers`
> first if you have not already, or read `packages/core/src/schemas.ts`'s `SERVICE_CATALOG` — and state which one you
> recommend, in your `findings`, as a sentence in this shape: `"<cloud>: recommend <service> because <app-profile fact>"`.
> The two options per cloud are always the same trade-off: an always-warm option (no cold starts, higher idle cost) vs a
> cost-optimized option (scales down when idle, cheaper, possible cold start). Base your pick on evidence from the repo
> and the deployment objective — traffic pattern, whether the objective mentions "demo"/"judged"/"latency-sensitive"
> (favor warm), or "low-traffic"/"cost"/"infrequent" (favor cost-optimized). If the objective gives no signal either way,
> default to the cost-optimized option and say so — never pick the warm option "by default" without a stated reason,
> since it costs more. Return only the JSON object with specialist "cloud-architect".

**security-reviewer**
> Inspect `<REPO>` read-only (never open .env files). Identify secrets and how they are consumed, auth-protected routes,
> risky defaults, dependency or supply-chain concerns, and which values must be secretRefs rather than plain env. Recommend
> the least-privilege posture for IBM Code Engine secrets and Lambda. Return only the JSON object with specialist
> "security-reviewer".

**release-verifier**
> Inspect `<REPO>` read-only. Identify the automated tests (framework, files, what they cover), how to run them, whether the
> health endpoint is suitable as a post-deploy probe (status codes, body fields such as revision), and the rollback
> readiness for Code Engine revisions and Lambda versions/aliases. Return only the JSON object with specialist
> "release-verifier".

**Synthesis (you, the primary agent):**
1. Merge the four results into ONE `AppProfile` (shape: `EXAMPLE_APP_PROFILE` in `packages/core/src/fixtures.ts`).
   The fixture is a **shape reference only**. Every value you record must come from this run's specialist evidence, and
   copying fixture values without evidence violates rule 01.
   Resolve contradictions explicitly: if specialists disagree, re-read the file and state which one was right, as an INFERENCE.
2. Call `devops_record_analysis`.
3. Log one `devops_log_note` (kind `inference`) that states the single most important risk.

During RECOVER, spawn one subagent (**incident-investigator**, `explore` preset) only if the root cause is not obvious from
the probe body plus the logs. Its prompt: "Given this incident evidence <paste the probe body and 20 log lines>, find the code
path in `<REPO>` that produces it and return the SpecialistFinding JSON with specialist 'incident-investigator'."
