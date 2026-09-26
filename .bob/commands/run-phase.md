---
description: Execute exactly one phase of the BobOps implementation plan
argument-hint: <two-digit phase number, e.g. 04>
---
<!-- @file .bob/commands/run-phase.md  @phase P1  @purpose Slash command that runs one plan phase with discipline. -->
Execute exactly ONE phase of the BobOps implementation plan. The phase number is the argument given with this command.

1. Read ONLY sections 6 (Global Constraints), 8 (Contracts cheat-sheet) and 9 (Conventions) of `docs/plan/00-MASTER-PLAN.md`.
2. Open the one file in `docs/plan/` whose name starts with `phase-<NN>-` and follow it exactly, in order.
3. Keep a todo list that mirrors the phase's tasks and tick items as you complete them.
4. Create files with EXACTLY the content given, including the header comments. Do not "improve", rename, or add dependencies.
5. Run every verification command in the phase. Fix failures (max 3 attempts each), then stop and report if still failing.
6. Do NOT execute steps marked "(HUMAN)". List them in the HANDOFF block instead.
7. Finish by printing the phase's HANDOFF block with real values filled in. Never start the next phase.
