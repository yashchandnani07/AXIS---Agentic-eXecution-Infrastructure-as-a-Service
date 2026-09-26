<!-- @file docs/architecture/overview.md  @phase P14  @purpose Architecture for judges and contributors. -->
# AXIS Architecture

A TypeScript modular monorepo: fast to build, clean boundaries for new cloud providers. Provider-independent lifecycle in `packages/core` + `apps/orchestrator`; cloud specifics isolated behind `CloudProvider`.

---

## 1. System Architecture

```mermaid
flowchart LR
  subgraph IDE["IBM Bob IDE & watsonx.ai"]
    MODE["🛰️ Multi-Cloud DevOps mode<br/>6 rules · 2 skills · /deploy · /investigate"]
    SUB["4 parallel specialist subagents<br/>(analyst, architect, security, release)"]
    WATSON["IBM watsonx.ai Agent<br/>(IBM Granite 3-8b Chat)"]
  end
  MCP["apps/bob-mcp<br/>MCP stdio server · 17 tools<br/>(NO approve tool)"]
  ORCH["apps/orchestrator<br/>Hono API · state machine<br/>approval guard · evidence store · SSE"]
  UI["apps/control-center<br/>Next.js 15 · approvals · audit trail · metrics"]
  IBM["IBM Cloud (Cloudant + WML + Code Engine)<br/>NoSQL state · AI synthesis · logs"]
  AWS["AWS Lambda + Function URL<br/>versions · alias rollback · CloudWatch"]
  GHA["GitHub Actions<br/>validate · deploy · health-sentinel */5"]
  ISS["GitHub Issues<br/>incident + JSON evidence"]

  MODE --> SUB
  MODE -->|MCP tool calls| MCP
  MCP -->|HTTP| ORCH
  UI -->|approve with human token| ORCH
  UI -->|Watson Q&A| WATSON
  WATSON -->|Cloudant queries| IBM
  ORCH -->|SSE live events| UI
  ORCH -->|provider contract| IBM
  ORCH -->|provider contract| AWS
  GHA -->|probe /health| IBM
  GHA -->|probe /health| AWS
  GHA --> ISS
  ISS -->|sync every 60 s| ORCH
```

---

## 2. Run State Machine

```mermaid
stateDiagram-v2
  [*] --> created
  created --> analyzed : Bob records analysis
  analyzed --> analyzed : re-analysis
  analyzed --> awaiting_approval : Bob submits plan
  awaiting_approval --> awaiting_approval : plan resubmitted (old approval superseded)
  awaiting_approval --> approved : HUMAN approves
  awaiting_approval --> rejected : HUMAN rejects
  rejected --> awaiting_approval : revised plan
  rejected --> analyzed
  approved --> deploying : execute (hash-checked)
  deploying --> verifying
  deploying --> failed
  verifying --> healthy
  verifying --> failed
  verifying --> incident
  healthy --> verifying : re-verify
  healthy --> incident : sentinel issue imported
  failed --> deploying
  failed --> verifying
  failed --> incident
  failed --> awaiting_remediation_approval
  incident --> incident
  incident --> awaiting_remediation_approval : Bob proposes remediation
  awaiting_remediation_approval --> awaiting_remediation_approval
  awaiting_remediation_approval --> remediating : execute (hash-checked)
  awaiting_remediation_approval --> incident : HUMAN rejects
  remediating --> verifying
  remediating --> failed
```

---

## 3. The Demo & Self-Healing Lifecycle

```mermaid
sequenceDiagram
  actor Dev as Developer
  participant Bob as IBM Bob (DevOps mode)
  participant MCP as bob-mcp
  participant O as Orchestrator
  participant UI as Control Center (AXIS)
  participant IBM as IBM Cloudant & WML
  participant AWS as AWS Lambda
  participant GH as GitHub Actions/Issues
  Dev->>Bob: /deploy apps/demo-service
  Bob->>MCP: devops_create_run
  Bob->>Bob: 4 parallel specialist subagents
  Bob->>MCP: devops_record_analysis, devops_submit_plan
  MCP->>O: POST plan (hash) → approval pending
  Bob->>MCP: devops_execute_plan (early, on purpose)
  O-->>Bob: 403 approval_required (guard.blocked)
  Dev->>UI: Approve (human token)
  Bob->>MCP: devops_wait(plan_decided) → devops_execute_plan
  O->>O: TEST (vitest)
  par parallel deploy & configure
    O->>IBM: sync Cloudant state & verify DB
    O->>AWS: bundle + publish version + alias
  end
  O->>IBM: probe /health + provider status
  O->>AWS: probe /health + provider status
  O->>GH: arm sentinel (SENTINEL_TARGETS variable)
  Dev->>UI: ⚡ inject fault (removes CATALOG_MODE)
  GH->>AWS: probe ×3 → 503 ×3
  GH->>GH: open issue with JSON evidence
  O->>GH: sync → incident (run state: incident)
  Dev->>Bob: /investigate
  Bob->>MCP: get_incident, get_logs, read code → record_diagnosis
  Bob->>MCP: propose_remediation(set_env CATALOG_MODE=featured)
  Dev->>UI: Approve remediation
  Bob->>MCP: execute_remediation
  O->>AWS: update env → re-verify → healthy
  O->>GH: comment + close issue
  Bob->>MCP: devops_export_evidence
```
