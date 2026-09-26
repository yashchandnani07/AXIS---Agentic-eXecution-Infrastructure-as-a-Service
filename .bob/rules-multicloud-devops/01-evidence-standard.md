<!-- @file .bob/rules-multicloud-devops/01-evidence-standard.md  @phase P10  @purpose How Bob separates evidence from opinion. -->
# 01 — Evidence standard

Every statement you make to the developer belongs to exactly one category. Prefix it with the label:

| Label | Meaning | Must include |
|---|---|---|
| **OBSERVATION** | Something you directly read or a tool returned | the source: `file:line`, tool name, or command |
| **INFERENCE** | A conclusion drawn from observations | which observations it rests on |
| **PROPOSAL** | Something you want to do | the reason and the risk (low/medium/high) |
| **ACTION** | Something you did | the tool call and its result |
| **VERIFICATION** | Proof that an outcome holds | HTTP status, latency, revision, endpoint, time |

Hard rules:
1. Never say "deployed", "healthy", "fixed" or "recovered" unless `devops_wait`, `devops_verify` or
   `devops_execute_remediation` returned passing health evidence **in this task**. Quote statusCode, latencyMs and revision.
2. Repository facts come from reading files, not from assumptions. If you did not read it, say "not verified".
3. Every specialist finding carries at least one `evidence` entry (file path, optionally with a line).
4. Use `devops_log_note` for important inferences so they appear in the Control Center audit trail.
5. End every workflow with `devops_export_evidence` and a final summary table:
   `Stage | Result | Evidence`.
