<!-- @file README.md @phase P14 @purpose Judge-facing overview: what, why, how Bob is core, proof, quickstart. -->
# AXIS — Agentic eXecution Infrastructure-as-a-Service

> **The Multi-Cloud DevOps & Self-Healing Platform powered by IBM Bob 2.0 & IBM watsonx.ai.**
>
> Provide a repository and a deployment goal. IBM Bob analyzes your code, orchestrates parallel specialist subagents, generates missing cloud assets, proposes hash-bound plans, deploys to **IBM Cloud** and **AWS Lambda** upon human approval, monitors health continuously, and automatically self-heals when configuration drifts occur.

---

| 🌐 Live AWS Lambda Deployment | 🤖 Watson Agent AI (watsonx.ai) | 📊 Pitch Deck | 🧾 Verified Audit Trail |
|---|---|---|---|
| [**Live Lambda Endpoint**](https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/health) | [**Ask watsonx.ai in UI**](http://localhost:3000) | [**docs/pitch/slides-outline.md**](docs/pitch/slides-outline.md) | [**evidence/demo-runs/**](evidence/demo-runs/) |

---

## 💡 Why AXIS?

Deploying existing software across multiple cloud providers typically requires dozens of disjointed steps: inferring runtime dependencies, authoring Dockerfiles & Lambda handlers, setting up IAM permissions, provisioning databases, configuring environment variables, wiring CI/CD runners, and manually correlating logs during outages.

**AXIS transforms this chaotic workflow into a single conversation with IBM Bob and two one-click human approvals.**

---

## ⚡ What Happens in the Workflow (Real Multi-Cloud, Zero Mocks)

1. **Repository Understanding & Parallel Specialists**:
   - You run `/deploy apps/demo-service` in IBM Bob.
   - **4 specialist subagents execute in parallel** (*Application Analyst*, *Cloud Architect*, *Security Reviewer*, *Release Verifier*).
2. **Missing Asset Generation & Rationale-Driven Planning**:
   - Bob generates missing deployment assets (`Dockerfile`, `src/lambda.ts`, `.dockerignore`) and validates builds.
   - The Cloud Architect specialist chooses tailored architectures for each cloud (e.g. Always-on for IBM Cloud, On-Demand for AWS Lambda) with cited technical rationale.
3. **Cryptographic Guardrails (`403 guard.blocked`)**:
   - Bob submits the plan. If Bob attempts early execution, the AXIS Orchestrator blocks the request with **403 Forbidden**.
   - Approvals are strictly bound to the plan's `SHA-256` hash.
4. **Human Approval & Parallel Deployment**:
   - Developer reviews the plan and clicks **Approve** in the AXIS Control Center.
   - Vitest tests gate the release; AWS Lambda deploys live with an active Function URL, and IBM Cloudant database state syncs in parallel.
5. **Continuous Health Sentinel & Automated Incident Detection**:
   - An independent GitHub Actions workflow (`health-sentinel.yml`) probes endpoints.
   - If an outage or configuration drift occurs, Sentinel automatically files a **GitHub Issue containing structured JSON evidence**.
6. **Self-Healing Recovery & Issue Auto-Resolution**:
   - Running `/investigate` triggers Bob to correlate probe data, CloudWatch/Cloudant logs, and source code.
   - Bob identifies root cause (e.g., missing `CATALOG_MODE`), proposes the minimal remediation, and upon approval, applies the fix and re-verifies health.
   - The GitHub Issue is automatically closed with an audit MTTR summary.
7. **Watson Agent (IBM watsonx.ai Integration)**:
   - Developers can converse directly with the embedded **Watson Agent** in the UI to ask real-time questions about the Cloudant database, live AWS Lambda latency, error rates, and topology.

---

## 📊 Measured Real-World Performance

| Metric | Measured Value |
|---|---|
| **Time to Verified Multi-Cloud Deploy** | **~42 seconds** (including human review) |
| **Mean Time to Recovery (MTTR)** | **7 seconds** |
| **Human Approvals Required** | **2 clicks** (Plan + Remediation) |
| **Unsafe / Early Actions Blocked** | **≥ 1 (`guard.blocked`)** |
| **Cloud Consoles Opened** | **0** |

---

## 🛰️ How IBM Bob 2.0 is the Core Component

| IBM Bob 2.0 Capability | How AXIS Implements It | Source Location |
|---|---|---|
| **Custom Mode** | `🛰️ Multi-Cloud DevOps Engineer` scoped to safe workspace boundaries | [`.bob/custom_modes.yaml`](.bob/custom_modes.yaml) |
| **Mode Rules** | 6 enforce strict evidence taxonomy, approval gates, and multi-cloud boundaries | [`.bob/rules-multicloud-devops/`](.bob/rules-multicloud-devops/) |
| **Parallel Subagents** | 4 concurrent subagents during `UNDERSTAND`, plus an incident investigator during `RECOVER` | Rule `04-specialists-and-synthesis.md` |
| **Custom MCP Server** | `bobops-orchestrator`: 17 lifecycle tools (**deliberately no approve tool**) | [`apps/bob-mcp`](apps/bob-mcp), [`.bob/mcp.json`](.bob/mcp.json) |
| **Skills** | `deployment-asset-authoring`, `incident-diagnosis` | [`.bob/skills/`](.bob/skills/) |
| **Slash Commands** | `/deploy`, `/investigate`, `/run-phase` | [`.bob/commands/`](.bob/commands/) |
| **Todo Lists** | Automated tracking aligned with the 8 lifecycle stages | Rules `05-deploy-workflow.md` & `06-incident-response.md` |
| **Document Understanding** | Reads PRDs, incident JSON payloads, runtime logs, and codebases to formulate diagnoses | [`docs/plan/`](docs/plan/) |
| **`.bobignore` & Governance** | Secrets are never ingested into model context; build conventions shared | [`.bobignore`](.bobignore), [`AGENTS.md`](AGENTS.md) |

---

## 🔒 Security & Safety Model

- **Hash-Bound Approvals**: `sha256(stableStringify(plan))`. If a plan is tampered with post-approval, execution is refused.
- **Privilege Separation**: Bob proposes actions; only the human developer holds the `x-approval-token` required to authorize deployments.
- **Resource Regex Isolation**: Operations restricted to `^bobops-[a-z0-9-]{3,40}$`.
- **Secret Redaction**: Secrets matching `/(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE)/i` travel as references only and are never exposed in logs or events.

---

## 🛠️ Repository Architecture

```text
AXIS/
├── apps/
│   ├── control-center/       # Next.js 15 UI with Vercel/Linear aesthetics & Watson Agent
│   ├── orchestrator/         # Hono API, state machine, hash guard, SSE event bus
│   ├── bob-mcp/              # MCP Server exposing 17 lifecycle tools to IBM Bob
│   └── demo-service/         # "Nimbus Books" microservice deployed to multi-cloud
├── packages/
│   ├── core/                 # Shared Zod schemas, state machine, provider contract
│   ├── provider-ibm-cloud/   # IBM Cloud adapter (Cloudant, WML, Code Engine)
│   ├── provider-aws/         # AWS Lambda + Function URL adapter (AWS SDK v3)
│   └── github/               # Octokit client for Health Sentinel issues & workflows
├── .bob/                     # IBM Bob custom mode, rules, skills, and MCP config
├── .github/workflows/        # validate.yml, health-sentinel.yml, deploy.yml
├── docs/                     # Architecture diagrams, demo scripts, pitch slides, roadmap
└── evidence/                 # Verifiable run artifacts and Bob task summary screenshots
```

---

## 🚀 Quickstart

### Prerequisites
- Node.js `>= 22`
- pnpm `9.x`

### Quick Onboarding (One-Click)
For teammates and judges cloning the repository:
1. Copy shared credentials into `.env` at repo root.
2. Run the automated onboarding script:
   - **Windows:** `.\setup.ps1` (or `pnpm onboard`)
   - **macOS / Linux:** `./setup.sh`
   *(See [docs/guide/TEAMMATE-ONBOARDING.md](docs/guide/TEAMMATE-ONBOARDING.md) for full guide)*

### Manual Setup Steps
```powershell
pnpm install
Copy-Item .env.example .env
pnpm onboard      # configures .env.local, MCP local paths, and runs 55 tests
```

### 4. Start Local Environment
```powershell
# Start Orchestrator API (port 4000) and Control Center UI (port 3000)
pnpm dev
```
Open **`http://localhost:3000`** to access the AXIS Control Center.

### 5. Run with IBM Bob
In the IBM Bob IDE:
1. Select the mode: **`🛰️ Multi-Cloud DevOps Engineer`**
2. Run command: `/deploy apps/demo-service`
3. Follow the interactive prompts and approve the release in the Control Center!

---

## 👥 Team
Built with **IBM Bob 2.0** & **IBM watsonx.ai** for the **IBM Bob 2.0 Hackathon (Sep 2026)**.
