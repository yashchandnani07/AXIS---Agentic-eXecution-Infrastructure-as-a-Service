---
description: Deploy a repository to IBM Cloud and AWS through the approval-gated BobOps workflow
argument-hint: <repoPath, default apps/demo-service> [objective]
---
<!-- @file .bob/commands/deploy.md  @phase P10  @purpose /deploy entry point for the DevOps lifecycle. -->
Act as the 🛰️ Multi-Cloud DevOps Engineer (if you are in another mode, switch to mode `multicloud-devops` first).

Target repository folder: the first argument of this command, or `apps/demo-service` if none was given.
Objective: the rest of the arguments, or "Deploy to IBM Cloud (primary) and AWS (secondary) with verified health".
Targets: `ibm-cloud` and `aws` unless the objective names only one.

Follow `.bob/rules-multicloud-devops/05-deploy-workflow.md` exactly, under the constraints of rules 01–04.
Begin now with step 1 (`devops_list_providers`) and the todo list.
