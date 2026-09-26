<!-- @file .bob/rules-multicloud-devops/06-incident-response.md  @phase P10  @purpose Exact procedure for /investigate. -->
# 06 — Incident response (RECOVER)

Create a todo list first: DETECT, EVIDENCE, DIAGNOSE, PROPOSE, APPROVAL, REMEDIATE, RE-VERIFY, CLOSE.

1. **DETECT:** `devops_sync_incidents` (this imports GitHub sentinel issues). Then call `devops_list_runs` and take the runId
   given as the command argument, or else the most recent run with `openIncidents > 0`. Call `devops_get_run` for it and pick
   the open incident. If no run has an open incident, call `devops_verify` on the latest healthy run and report the result.
2. **EVIDENCE**, gathered in this order:
   a. `devops_get_incident`: quote the failing probe (statusCode, body such as `checks.config.missing`), the GitHub issue URL,
      and `approvedPlanEnv`.
   b. `devops_get_logs` for that provider (60 lines): quote the 1–3 relevant lines.
   c. Read the code that produces the failing response (for example grep the missing key in `<repoPath>/src`) and cite file:line.
   d. Compare the approved plan env with the evidence. Is this configuration drift, bad code, or an infrastructure problem?
3. **DIAGNOSE:** call `devops_record_diagnosis` with `summary`, `rootCause`, `confidence`, and `evidence` (≥ 2 items: the
   probe body, a log line, a file:line, the plan env).
4. **PROPOSE** the smallest safe remediation, in this order of preference:
   1. **Configuration drift** (the approved plan has a value that is missing or different at runtime):
      `set_env` with the approved value. Risk: low.
   2. **The latest revision is broken while the previous one was healthy:** `rollback` (no toRevision). Risk: medium.
   3. **A code defect:** do NOT use remediation. Explain the fix, propose a code change as a PROPOSAL, and stop.
   Call `devops_propose_remediation` with a rationale that cites the evidence.
5. **APPROVAL:** "Please review and approve the remediation in the Control Center: <approveAt>". Then call `devops_wait`
   with `until=remediation_decided`, `timeoutSec=900`.
6. **REMEDIATE:** `devops_execute_remediation`.
7. **RE-VERIFY:** report `ok`, statusCode, latencyMs and the new revision for every provider as VERIFICATION. If `ok` is
   false, go back to step 2 at most once, then escalate to the developer.
8. **CLOSE:** `devops_export_evidence`. Report the time to recovery and the fact that the GitHub issue was closed with a
   recovery comment.
