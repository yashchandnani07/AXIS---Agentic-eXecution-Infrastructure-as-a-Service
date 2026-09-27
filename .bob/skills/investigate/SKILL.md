---
name: investigate
description: >-
  Investigate and recover a failing deployment using sentinel incident evidence
  (approval-gated)
metadata:
  user-invocable: true
  disable-model-invocation: true
---

<!-- @file .bob/commands/investigate.md  @phase P10  @purpose /investigate entry point for the RECOVER stage. -->
Act as the 🛰️ Multi-Cloud DevOps Engineer (if you are in another mode, switch to mode `multicloud-devops` first).

Run: the argument of this command if given. Otherwise call `devops_list_runs` and pick the most recent run with open incidents.
Follow `.bob/rules-multicloud-devops/06-incident-response.md` exactly, using the skill `incident-diagnosis`.
Begin now with `devops_sync_incidents` and the todo list.
