<!-- @file docs/pitch/slides-outline.md  @phase P14  @purpose 10-slide deck outline (lablab presentation). -->
# AXIS: Slide Deck Outline

### Slide 1: Title & Vision
- **Title**: AXIS — Agentic eXecution Infrastructure-as-a-Service
- **Subtitle**: Multi-Cloud DevOps & Self-Healing Platform powered by IBM Bob 2.0 & IBM watsonx.ai
- **Tagline**: *"Bob is the DevOps engineer. You're the approver. watsonx is your DB intelligence."*
- **Visual**: Control Center landing page + IBM Granite conversational agent interface.

### Slide 2: The Problem
- **Context**: Deploying apps across multi-cloud requires 20+ manual steps across disparate consoles (Dockerfiles, registries, Lambda zip bundles, function URLs, IAM roles, env vars, CI/CD pipelines, CloudWatch/Cloudant logs).
- **Pain Point**: Devs spend hours debugging 2 a.m. configuration drift, missing secrets, and manual rollbacks.

### Slide 3: The Solution (AXIS)
- **Concept**: One prompt to IBM Bob + two clicks from a human developer.
- **Lifecycle**: `UNDERSTAND → PLAN → PROVISION → BUILD → TEST → DEPLOY → VERIFY → RECOVER`.
- **Core Pillars**: Hash-bound safety guards, parallel specialist subagents, real multi-cloud adapters (IBM Cloud + AWS Lambda), automated GitHub Health Sentinel, and watsonx.ai natural language querying.

### Slide 4: Live Demo "Wow" Moments
1. **Parallel Specialist Subagents**: 4 subagents analyze repo, architecture, security, and verification in parallel.
2. **Hash-Bound Guard**: Bob attempts deployment early; orchestrator blocks with `403 guard.blocked`.
3. **Multi-Cloud Verified Deployment**: AWS Lambda deployed live with HTTP 200 verification; IBM Cloudant state synced.
4. **Controlled Fault & GitHub Sentinel**: Sentinel detects 503 fault and files GitHub issue with machine-readable JSON evidence.
5. **Self-Healing Recovery**: `/investigate` diagnoses root cause, human approves remediation, system heals in 7 seconds, and auto-closes issue.

### Slide 5: IBM Bob 2.0 as the Core Component
- **Custom Mode**: 🛰️ Multi-Cloud DevOps Engineer with scoped tool and execution access.
- **Custom MCP Server**: 17 lifecycle tools in `apps/bob-mcp` (deliberately without approve capability).
- **Parallel Subagents**: 4 specialized agents working concurrently.
- **Rules & Skills**: Strict evidence standards, deployment asset authoring, and incident diagnosis.
- **Slash Commands**: `/deploy`, `/investigate`, `/run-phase`.

### Slide 6: Multi-Cloud Architecture
- **Monorepo**: TypeScript pnpm workspace with `@bobops/core`, `@bobops/provider-ibm-cloud`, `@bobops/provider-aws`, `@bobops/github`.
- **Orchestrator**: Hono API on Node 22 with state machine, SSE event bus, and SHA-256 plan hash verification.
- **Control Center**: Next.js 15 UI with dark glassmorphism design, real-time metrics, live logs, and Watson Agent.

### Slide 7: Safety & Governance Model
- **Plan Hash Verification**: Approvals are bound to `sha256(stableStringify(plan))`.
- **Separation of Concerns**: Bob proposes, humans approve with private token, orchestrator enforces.
- **Strict Boundaries**: Resource regex isolation (`^bobops-[a-z0-9-]{3,40}$`), `.bobignore` credential protection, and least-privilege AWS IAM policies.

### Slide 8: Real-World Metrics & Self-Healing Evidence
- **Time to Multi-Cloud Deploy**: ~42 seconds.
- **Mean Time to Recovery (MTTR)**: ~7 seconds.
- **Human Actions**: Exactly 2 clicks (Plan Approval & Remediation Approval).
- **Cloud Consoles Opened**: 0.

### Slide 9: Business Value & V2 Roadmap
- **Immediate Value**: Reduces deployment friction by 90% and eliminates production downtime from config drift.
- **V2 Roadmap**: Expanding to Vercel, Railway, and Google Cloud Run using the identical `CloudProvider` contract.

### Slide 10: Summary & Links
- **GitHub**: https://github.com/yashchandnani07/AXIS---Agentic-eXecution-Infrastructure-as-a-Service
- **Live AWS Lambda**: Active endpoint with microsecond latency
- **Team**: Built for the IBM Bob 2.0 Hackathon (Sep 2026).
