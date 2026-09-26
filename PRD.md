# Product Requirements Document

# Agentic Multi-Cloud DevOps Engineer

**IBM Bob 2.0 Hackathon · V1**  
**Build window:** 48 hours · September 25–27, 2026

> Give Bob a repository and a deployment goal. Bob understands the application, proposes a safe plan, provisions, builds, deploys, verifies, and—when needed—helps recover it across cloud environments.

## 1. Context and Opportunity

The IBM Bob 2.0 Hackathon calls for a working prototype that improves a specific developer workflow with IBM Bob as a core component. It encourages Agent mode, parallel tasks, subagents, and document understanding across multiple workflow stages—not merely AI-assisted coding.

This project targets the release-and-deployment lifecycle. It demonstrates Bob carrying context from an unfamiliar repository through a real, verified cloud deployment while the developer retains control over sensitive and costly actions.

The product is not another AI dashboard or CI/CD-file generator. It is an evidence-driven DevOps workflow that connects repository analysis, cloud actions, CI/CD, runtime health, incident evidence, and human approvals.

## 2. Problem

Moving an existing application from a repository to a reliable cloud environment is fragmented. Developers must infer runtime and dependency needs, select architecture and cloud services, create infrastructure and CI/CD configuration, manage secrets, deploy, validate, and then navigate separate cloud consoles and logs when something fails.

This fragmentation costs time and causes errors. Smaller teams may not have a dedicated DevOps engineer for every release, while DevOps engineers repeat the same discovery, validation, and troubleshooting work across projects.

## 3. Product Vision

Make deployment feel like handing a senior DevOps engineer a repository and a deployment goal—without giving up control of important actions.

The Agentic Multi-Cloud DevOps Engineer is an agentic developer workflow, not a generic CI/CD generator. Bob understands the repository, coordinates specialist work, presents an actionable plan, executes approved operations through cloud integrations, observes the outcome, and uses evidence to guide the next safe action.

**UNDERSTAND → PLAN → PROVISION → BUILD → TEST → DEPLOY → VERIFY → RECOVER**

Recovery is an important lifecycle stage, not the product's sole identity.

## 4. Target Users

- Developers who can build software but do not want to manually configure every deployment detail.
- Small teams without a dedicated DevOps engineer for each project.
- DevOps and platform engineers automating repetitive release and diagnostic work.
- Teams that work across, or expect to expand across, cloud providers.

## 5. V1 Scope and Provider Strategy

V1 optimizes for a credible, live end-to-end workflow rather than broad provider coverage.

| Area | V1 commitment |
| --- | --- |
| Core experience | IBM Bob custom DevOps Mode, reusable rules, specialist tasks, and Bob session evidence |
| Cloud providers | **IBM Cloud and AWS**, both demonstrated with real deployment interactions |
| IBM Cloud role | First-class and primary product/cloud story |
| AWS role | Second real provider demonstrating the same portable workflow |
| Lifecycle | Repository analysis, planning, approval, provisioning, deployment, verification, and a safe recovery loop |
| Interface | Control Center for plans, activity, approvals, resources, health, logs, incidents, and history |
| Continuous verification | Provider-native health signals plus a GitHub Actions sentinel every five minutes |
| V2 expansion | Vercel and Railway adapters through the same provider contract |

IBM Cloud is the primary V1 platform. AWS proves the workflow is truly multi-cloud. Vercel and Railway are intentional **V2** integrations: V1 establishes a clean extension point and a roadmap, but does not claim simulated or incomplete support.

## 6. Bob-Native Design

### Project-Scoped DevOps Mode

The repository includes a custom Bob mode named **Agentic Multi-Cloud DevOps Engineer**. It requires evidence before conclusions, repository inspection before assumptions, approval before high-impact actions, and verified health before a deployment can be reported as complete.

The mode is version-controlled in `.bob/custom_modes.yaml`. Mode-specific rules define:

- approval gates for resource creation, deployment, rollback, failover, and secret-affecting changes;
- an evidence standard for plans, diagnoses, and completion claims;
- safe cloud-operation boundaries;
- clear separation between observation, inference, proposal, action, and verification.

### Specialist Work and Synthesis

Bob uses focused specialist work only where it improves the outcome:

- **Application analyst:** runtime, build, dependencies, configuration, health endpoint, and deployment constraints.
- **Cloud architect:** IBM Cloud/AWS target design, resources, and provider capabilities.
- **Security reviewer:** secrets, IAM scope, exposed configuration, and operational risk.
- **Release verifier:** CI/CD, smoke tests, health checks, and rollback readiness.
- **Incident investigator:** evidence-driven diagnosis and a bounded remediation proposal.

The primary DevOps agent synthesizes these findings into one developer-readable deployment plan. Parallel tasks must improve speed or confidence; they are not decorative.

### Evidence of Bob Usage

Relevant Bob IDE task-session summaries and screenshots are committed in `evidence/bob-task-summaries/`. The custom mode and rules are version-controlled so the team and judges can reproduce how Bob was specialized and used.

## 7. Primary User Journey

1. A developer selects an existing repository and states a deployment objective.
2. Bob analyzes the application structure, runtime, dependencies, configuration, service requirements, and risks.
3. Bob coordinates architecture, security, and release-readiness findings and creates a single deployment plan.
4. The Control Center displays target clouds, architecture, expected resources, generated assets, risks, and approval points.
5. The developer reviews and approves the plan.
6. The orchestrator performs approved infrastructure and deployment actions on IBM Cloud and/or AWS.
7. The system verifies the result with application and provider health evidence.
8. The Control Center displays the endpoint, provider state, workflow progress, logs, and evidence trail.
9. A controlled failure is introduced.
10. The health sentinel records an incident. Bob diagnoses it, proposes a safe remediation, requests approval, executes the approved action, and re-verifies the release.

## 8. Product Components

### Deployment Control Center

The Control Center is a full product surface, not a small status dashboard. It shows:

- projects, repositories, and detected application profile;
- proposed architecture, deployment plan, and approval actions;
- IBM Cloud/AWS environment and resource views;
- summarized agent activity and decision evidence;
- build, pipeline, deployment, health, and endpoint status;
- logs, diagnostics, incidents, remediation, and deployment history.

### Orchestrator

The orchestration service implements the lifecycle as explicit states. Each state transition produces an auditable event and stores its supporting evidence. State-changing operations require user approval before actions are sent to a cloud provider.

### Cloud Provider Contract

The core workflow is provider-independent. Each provider adapter implements capability discovery, plan generation, deployment, status, diagnostics, verification, and rollback.

V1 includes real adapters for:

- **IBM Cloud:** the principal target, including deployment, resource status, configuration/secrets integration, logs, and health evidence.
- **AWS:** a second target, including the equivalent operations required for the selected demo path.

V2 adds `provider-vercel` and `provider-railway` without changing the core workflow.

### GitHub and CI/CD

GitHub integration supplies repository metadata, commit status, Actions results, and deployment artifacts. GitHub Actions provides validation, approved deployment workflows, and the independent health sentinel.

## 9. Verification and Recovery

Provider-native and application-level health signals are the first line of runtime protection. A GitHub Actions workflow runs every five minutes, and can be manually dispatched for the demo, to independently probe configured health endpoints.

Scheduled GitHub Actions can be delayed, so they are not the sole production-health mechanism. Their role is independent cross-cloud verification and structured incident reporting.

The sentinel:

1. records endpoint status, latency, deployment revision, timestamp, and provider context;
2. treats transient failures cautiously and opens an incident only after a repeated-failure threshold;
3. stores a machine-readable incident artifact with probe evidence, recent workflow context, and deployment identifiers;
4. surfaces the incident in the Control Center for Bob's investigation.

GitHub Actions does not pretend to autonomously invoke Bob in the IDE. Bob is the interactive, approval-gated agent that consumes the incident evidence, explains the diagnosis, and performs approved recovery work.

The demo uses one safe, repeatable fault—such as a missing environment value, deliberately broken health route, or invalid deployment configuration—and proves a healthy baseline, detection, evidence collection, diagnosis, approval, remediation or rollback, and passing re-verification.

## 10. Technical Architecture and Repository Structure

Use a TypeScript modular monorepo. This is deliberately a modular application rather than a microservice fleet: it is fast for two people to build, understandable in 48 hours, and still maintains clean boundaries for future providers.

```text
apps/
  control-center/       # Next.js product interface
  orchestrator/         # API and explicit lifecycle workflow executor
  demo-service/         # Real application used in the live deployment demo
packages/
  core/                 # Domain types, schemas, workflow state machine, provider contract
  provider-ibm-cloud/   # V1 IBM Cloud implementation
  provider-aws/         # V1 AWS implementation
  github/               # Repository, Actions, artifact, and incident integration
  ui/                   # Shared interface components
infra/
  ibm-cloud/            # IBM Cloud infrastructure as code
  aws/                  # AWS infrastructure as code
.bob/
  custom_modes.yaml
  rules-multicloud-devops/
.github/workflows/
  validate.yml
  deploy.yml
  health-sentinel.yml
docs/
  architecture/
  demo/
  roadmap/v2-vercel-railway.md
evidence/
  bob-task-summaries/
  demo-runs/
scripts/
```

Vercel and Railway adapters will be added in V2 as `packages/provider-vercel/` and `packages/provider-railway/`. Do not add empty provider packages in V1.

## 11. Scope Boundaries

### In Scope

- IBM Bob as the central agent experience.
- A project-scoped DevOps Mode, reusable rules, specialist tasks, and Bob task evidence.
- One real repository-to-cloud workflow.
- Live IBM Cloud and AWS deployment interactions.
- Deployment planning, approval gates, CI/CD, verification, and one controlled recovery loop.
- A polished Control Center focused on the demonstrated lifecycle.

### Out of Scope

- Every framework, cloud service, or application topology.
- Vercel and Railway deployment support.
- Full enterprise RBAC, billing, multi-region traffic management, or disaster-recovery infrastructure.
- Fully autonomous irreversible or high-risk production actions.
- A custom foundation model or a general-purpose observability platform.

## 12. Success Criteria

The V1 prototype succeeds when:

- a developer reaches a verified cloud deployment from a real repository through the agent workflow;
- IBM Bob is clearly visible as a core product component rather than an invisible coding assistant;
- the agent performs connected lifecycle stages, not isolated file generation;
- IBM Cloud and AWS are both visibly used in the demo;
- health claims are backed by displayed evidence;
- a controlled failure is detected, diagnosed, approved, remediated or rolled back, and re-verified;
- the Control Center makes decisions, progress, approvals, and outcomes understandable;
- the demo makes manual release work feel fragmented by comparison.

## 13. Demo Narrative

1. Start with a real repository without hand-authored cloud deployment setup.
2. Ask Bob to prepare it for IBM Cloud and AWS.
3. Show repository findings and specialist conclusions.
4. Review the synthesized plan, architecture, risks, generated deployment assets, and approval gate.
5. Approve the plan.
6. Deploy and verify, showing a real endpoint and provider evidence.
7. Introduce the controlled fault.
8. Show the health-sentinel incident and its captured evidence.
9. Let Bob diagnose the cause, propose a safe change, and request approval.
10. Approve the remedy and show passing recovery verification.
11. End on the Control Center audit trail: repository → plan → approval → deployment → incident → verified recovery.

## 14. Team Operating Model

- **Product and experience owner:** Control Center, demo service, GitHub workflows, sentinel UX, demo narrative, and visual polish.
- **Orchestration and cloud owner:** workflow engine, IBM Cloud/AWS adapters, infrastructure, Bob custom mode/rules, evidence artifacts, and recovery implementation.

Both contributors agree first on the shared state model in `packages/core` and complete one working happy path before expanding UI breadth or recovery sophistication.

## 15. Reference Material

- IBM Bob 2.0 Hackathon live event: <https://lablab.ai/ai-hackathons/ibm-bob-2-hackathon/live>
- IBM Bob 2.0 Hackathon Guide: <https://lablab-ibm-bob-2-hackathon-guide.s3.us.cloud-object-storage.appdomain.cloud/index.html>
- IBM Bob custom modes documentation: <https://bob.ibm.com/docs/ide/configuration/custom-modes>
- Bobathon sample/problem statements: <https://github.com/Manoj-2702/bobathon-artifacts>

