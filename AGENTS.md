<!--
@file     AGENTS.md
@phase    P1
@purpose  Standing instructions for IBM Bob (and any coding agent) while BUILDING this repo.
@agentNotes Keep short. The deployment/runtime behaviour of Bob lives in .bob/rules-multicloud-devops/.
-->
# BobOps — Agent Guide

You are helping build **BobOps — Agentic Multi-Cloud DevOps Engineer** for the IBM Bob 2.0 Hackathon.

## Source of truth
- Product spec: `PRD.md`. Build plan: `docs/plan/00-MASTER-PLAN.md` + `docs/plan/phase-NN-*.md`.
- Execute **only** the phase the human asked for. Follow its steps in order. Print its HANDOFF block at the end.

## Stack
Node 22 · pnpm 9 workspaces · TypeScript ESM (run with `tsx`) · zod 3.25 (`import { z } from 'zod'`) · Hono 4 · Vitest 3 ·
Next.js 15 + Tailwind v4 · MCP SDK · execa · AWS SDK v3 · Octokit.

## Commands
- `pnpm install` · `pnpm test` · `pnpm typecheck`
- `pnpm dev:api` (orchestrator :4000) · `pnpm dev:ui` (control center :3000)
- Shell is **Windows PowerShell**: use `curl.exe` or `Invoke-RestMethod`, `;` to chain, `Copy-Item`, `Remove-Item`.

## Non-negotiable rules
1. Every new source file starts with the context header defined in `docs/plan/00-MASTER-PLAN.md` §9.1.
2. Domain shapes come from `@bobops/core` schemas. Never redeclare them.
3. Do not add dependencies that the phase file does not list. Do not rename files, functions or exports.
4. Never read or print `.env*` files. Never put secrets in code, tests, logs or chat.
5. Never run cloud-mutating CLI commands (`ibmcloud … create/update/delete`, `aws …`) unless the phase file explicitly
   tells the HUMAN to run them. Smoke scripts are run by the human.
6. In `apps/bob-mcp`, never write to stdout (`console.log`). It is the MCP protocol channel. Use `console.error`.
7. After writing code, run the phase's verification commands. If one fails 3 times, stop and report instead of guessing.
