---
name: incident-diagnosis
description: Evidence-first diagnosis of a failing deployment health check across IBM Cloud Code Engine and AWS Lambda, producing a Diagnosis with cited evidence and the smallest safe remediation.
---
<!-- @file .bob/skills/incident-diagnosis/SKILL.md  @phase P10  @purpose Reusable diagnosis playbook used by /investigate. -->
# Incident diagnosis playbook

## Evidence table (fill it in before concluding)
| # | Source | Evidence (quote) | Supports |
|---|---|---|---|
| 1 | sentinel/orchestrator probe | e.g. `503 {"checks":{"config":{"ok":false,"missing":["CATALOG_MODE"]}}}` | config drift |
| 2 | provider logs | e.g. `[health] FAIL missing required env: CATALOG_MODE` | config drift |
| 3 | code | e.g. `apps/demo-service/src/config.ts:12 REQUIRED_ENV` | why it fails |
| 4 | approved plan | e.g. `env.CATALOG_MODE = "featured"` | the correct value |

## Classify
- **Config drift:** the runtime env differs from the approved plan → `set_env` back to the approved value.
- **Bad release:** the failure started with a new revision and the previous revision was healthy → `rollback`.
- **Code defect:** the code path fails for any valid config → propose a code change (no remediation action).
- **Platform issue:** timeouts or 5xx without app logs → check provider status, re-verify once, then escalate.

## Output
`Diagnosis { summary, rootCause, confidence, evidence[≥2] }`, then one remediation proposal with its risk and rationale.
