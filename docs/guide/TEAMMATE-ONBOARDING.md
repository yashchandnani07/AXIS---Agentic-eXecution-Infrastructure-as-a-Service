<!-- @file docs/guide/TEAMMATE-ONBOARDING.md @phase P14 @purpose Zero-friction onboarding guide for teammates cloning AXIS. -->
# 🛰️ AXIS: Teammate Quickstart & Onboarding Guide

Welcome to **AXIS (Agentic eXecution Infrastructure-as-a-Service)**! This guide will get you completely set up with the local developer environment, IBM Bob 2.0, and multi-cloud integrations in under 3 minutes.

---

## ⚡ 1. Prerequisites

Before starting, ensure you have:
- **Node.js**: `v22+` LTS (check with `node -v`)
- **pnpm**: `v9.x` (if not installed: `corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- **Git**: Installed and authenticated
- **IBM Bob 2.0**: Installed on your machine

---

## 🚀 2. Quick Setup (One-Click)

### Step 1: Clone the Repository
```bash
git clone https://github.com/yashchandnani07/AXIS---Agentic-eXecution-Infrastructure-as-a-Service.git
cd AXIS---Agentic-eXecution-Infrastructure-as-a-Service
```

### Step 2: Add the Shared `.env` File
Create `.env` in the repository root and paste the team's shared keys (IBM Cloud credentials, AWS credentials, and `APPROVAL_TOKEN`).
*(If you need a reference of the variable names, see [`.env.example`](../../.env.example)).*

### Step 3: Run the Automated Onboarding Script
Run the automated onboarding script for your operating system:

**On Windows (PowerShell):**
```powershell
.\setup.ps1
```
*(or run `pnpm install` followed by `pnpm onboard`)*

**On macOS / Linux:**
```bash
chmod +x ./setup.sh && ./setup.sh
```

---

## 🛠️ What the Onboarding Script Configures Automatically

The script performs all platform-specific and path-dependent configurations:

1. **Workspace Dependencies**: Installs all pnpm workspace packages.
2. **Control Center Environment**: Synchronizes `APPROVAL_TOKEN` from root `.env` to `apps/control-center/.env.local`.
3. **Bob MCP Server Bundle**: Bundles `apps/bob-mcp` with esbuild into `apps/bob-mcp/dist/bob-mcp.mjs`.
4. **Local MCP Registration**: Automatically detects your exact local repository path and updates `.bob/mcp.json` so IBM Bob can launch the MCP server without manual path edits.
5. **Demo Microservice Assets**: Stages the `apps/demo-service` deployment assets (`Dockerfile`, `src/lambda.ts`).
6. **Test Suite Verification**: Executes `pnpm test` (55 tests) to confirm your environment is 100% green.

---

## 💻 3. Starting the Local Environment

Start both the backend orchestrator and the Next.js Control Center:
```powershell
pnpm dev
```

- **AXIS Control Center UI**: [`http://localhost:3000`](http://localhost:3000)
- **Orchestrator REST API**: [`http://localhost:4000/api/health`](http://localhost:4000/api/health)
- **Watson Agent (watsonx.ai)**: Available directly in the Control Center under the *Watson Agent (Ask AI)* tab.

---

## 🤖 4. Configuring IBM Bob 2.0

1. Open this repository folder in **IBM Bob**.
2. Open the **MCP Panel** in Bob:
   - Verify that **`bobops-orchestrator`** is listed and active with **17 tools**.
   - If Bob was open during setup, click the reload icon on the MCP server.
3. Switch to the custom mode:
   - In the Bob mode selector, choose: **`🛰️ Multi-Cloud DevOps Engineer`**.
4. Test the deployment workflow:
   - Type `/deploy apps/demo-service` in the Bob chat.
   - Follow Bob's interactive prompts, and approve the release in the Control Center at [`http://localhost:3000`](http://localhost:3000)!

---

## 🔍 5. Troubleshooting & Useful Commands

| Issue | Resolution |
|---|---|
| **MCP server shows red in Bob** | Run `pnpm build:mcp`, then restart the MCP server in Bob. Ensure `.bob/mcp.json` contains your machine's absolute path. |
| **Port 3000 or 4000 already in use** | Find and terminate conflicting processes: `netstat -ano \| findstr :3000` (Windows) and kill the PID. |
| **Missing .env warning** | Ensure `.env` exists in the repo root with `APPROVAL_TOKEN` defined. |
| **Run tests anytime** | Run `pnpm test` (unit tests) or `pnpm typecheck` (full TypeScript check). |
| **Reset demo state** | Run `pnpm demo:reset` to return the repository to a clean "before Bob" state. |
| **Run End-to-End Test** | Run `npx tsx scripts/demo/api-e2e.ts --targets aws --with-recovery --fault-provider aws` to test full deployment & self-healing on live AWS. |
