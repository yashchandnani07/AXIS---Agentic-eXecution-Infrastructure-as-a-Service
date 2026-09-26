<!--
@file     docs/plan/phase-00-prerequisites.md
@purpose  Human-only setup: tools, accounts, credentials, cloud bootstrap. No code.
@owner    Both (do it together, ~60 min)
-->
# Phase 00 — Prerequisites (HUMAN ONLY, ~60 min)

> **Agents:** do not execute this phase. It involves creating accounts and handling credentials, which only humans may do.
> If a human asks you to help, explain the steps; do not enter keys anywhere.

**Goal:** Every tool is installed, every account is reachable, and `.env` values are ready. At the end, each check command in
"Verification" prints the expected output.

**Shell:** Windows PowerShell (Windows Terminal). Open a **new** terminal after each installer so PATH refreshes.

---

## Task 0.1 — Local toolchain

- [ ] **Node.js 22 LTS**
  ```powershell
  winget install OpenJS.NodeJS.LTS
  node -v
  ```
  Expected: `v22.x.x` (any 22 or newer LTS).

- [ ] **pnpm 9 via corepack**
  ```powershell
  corepack enable
  corepack prepare pnpm@9.15.0 --activate
  pnpm -v
  ```
  Expected: `9.15.0`. If `corepack enable` fails with EPERM, run the terminal **as Administrator** once, or use `npm i -g pnpm@9.15.0`.

- [ ] **Git and GitHub CLI**
  ```powershell
  winget install Git.Git
  winget install GitHub.cli
  gh auth login
  gh auth status
  ```
  Expected: `Logged in to github.com account <you>`. Choose HTTPS and "Login with a web browser".

- [ ] **IBM Cloud CLI plus the Code Engine plugin** (official PowerShell installer)
  ```powershell
  iex (New-Object Net.WebClient).DownloadString('https://clis.cloud.ibm.com/install/powershell')
  ibmcloud -v
  ibmcloud plugin install code-engine -f
  ibmcloud plugin list
  ```
  Expected: the version prints, and `code-engine` appears in the plugin list.

- [ ] **AWS CLI v2**
  ```powershell
  winget install Amazon.AWSCLI
  aws --version
  ```
  Expected: `aws-cli/2.x`.

- [ ] **IBM Bob IDE.** Install it, sign in with the hackathon-provisioned account (IBMid), and open **Settings → Usage** to
      note your Bobcoin balance (40).

## Task 0.2 — IBM Cloud: API key and Code Engine project

- [ ] Log in interactively (browser SSO):
  ```powershell
  ibmcloud login --sso
  ```
- [ ] Target the region and resource group:
  ```powershell
  ibmcloud target -r us-south -g Default
  ```
  If `Default` doesn't exist, run `ibmcloud resource groups` and use the name shown. Put that name in `.env` as
  `IBMCLOUD_RESOURCE_GROUP`.
- [ ] Create the API key and save it **outside the repo**:
  ```powershell
  ibmcloud iam api-key-create bobops-key -d "BobOps hackathon" --file $HOME\bobops-ibm-apikey.json
  ```
  Open the file and copy the `apikey` value. You will paste it into `.env` in Phase 1.
- [ ] Create the Code Engine project (Phase 6 records this as `infra/ibm-cloud/bootstrap.ps1`):
  ```powershell
  ibmcloud ce project create --name bobops-demo
  ibmcloud ce project select --name bobops-demo
  ibmcloud ce project current
  ```
  Expected: `Name: bobops-demo`, `Region: us-south`.
  *If project creation fails because of the account type:* use the hackathon-provided IBM Cloud account, or upgrade to
  Pay-As-You-Go (the Code Engine free tier covers this demo).

## Task 0.3 — AWS: admin access for setup

- [ ] Configure a profile that can create IAM roles, used only for the one-time setup in Phase 7:
  ```powershell
  aws configure
  aws sts get-caller-identity
  ```
  Expected: JSON with your `Account` id. Region: `us-east-1`. Output format: `json`.
  (Phase 7 creates a **least-privilege** `bobops-deployer` user for the orchestrator.)

## Task 0.4 — Secrets you will need (write them in a password manager, NOT in the repo)

| Name | Where it comes from |
|---|---|
| `IBMCLOUD_API_KEY` | Task 0.2 file |
| `APPROVAL_TOKEN` | Generate it: `-join ((48..57)+(97..122) \| Get-Random -Count 24 \| % {[char]$_})` |
| `SECRET_ADMIN_TOKEN` | Generate the same way |
| `GITHUB_TOKEN` | `gh auth token` (run it later, in Phase 12) |
| AWS deployer keys | Phase 7 |

## Verification

Run all of these. **Every line must succeed.**

```powershell
node -v; pnpm -v; git --version; gh auth status; ibmcloud -v; ibmcloud ce project current; aws sts get-caller-identity
```

## HANDOFF

```text
✅ PHASE 00 COMPLETE — Prerequisites
BUILT:
  - Toolchain: Node 22, pnpm 9, git, gh, ibmcloud (+code-engine), aws CLI, IBM Bob IDE
  - IBM Cloud API key + Code Engine project bobops-demo (us-south)
  - AWS admin profile for one-time setup
DO THIS (human):
  1. Run the Verification one-liner above.
EXPECT:
  - All commands print versions/identity; `ibmcloud ce project current` shows bobops-demo.
IF IT FAILS:
  - "command not found" → open a NEW terminal (PATH refresh).
  - Code Engine project error → account type; use the hackathon account or upgrade to PAYG.
EVIDENCE:
  - (No Bob task in this phase.) Continue with Phase 01.
```
