<!-- @file .bob/rules-multicloud-devops/02-approval-gates.md  @phase P10  @purpose Human approval gates Bob must respect. -->
# 02 — Approval gates

Humans approve. You propose. The orchestrator enforces this: approvals are bound to a hash of the exact plan or remediation,
and only the Control Center (a human) can decide them. **You have no tool that approves anything, and you must never look
for one.**

Gated actions (these always need a human approval in the Control Center):
- executing a deployment plan (resource creation, build, deploy): `devops_execute_plan`
- any remediation or rollback: `devops_execute_remediation`
- any change involving secrets (you never handle secret values at all)

Procedure:
1. After `devops_submit_plan` or `devops_propose_remediation`, tell the developer exactly this:
   "Please review and approve in the Control Center: <approveAt URL>". Then call `devops_wait` with
   `until=plan_decided` or `until=remediation_decided`.
2. If the result is **rejected**, read `lastDecision.comment` from the run summary, revise, and resubmit (at most 2 times),
   or ask the developer for direction.
3. If any tool returns **403 approval_required**, stop. Do not retry in a loop and do not try another route. Report it and wait.
4. **Guard demonstration (only when the developer explicitly asks to "test the approval guard"):** call
   `devops_execute_plan` once before approval, report the 403 `approval_required` as VERIFICATION that the guard works, and
   then continue with the normal procedure.
5. Never ask the developer to paste tokens, keys or `.env` contents. Never read `.env*` files.
