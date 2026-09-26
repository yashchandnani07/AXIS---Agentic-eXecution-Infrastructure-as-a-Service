<!-- @file docs/roadmap/v2-vercel-railway.md  @phase P14  @purpose Honest V2 scope (PRD §5): no simulated support in V1. -->
# V2 Roadmap: Vercel and Railway Through the Same Provider Contract

V1 ships real IBM Cloud (Cloudant, watsonx.ai WML, Code Engine) and AWS Lambda adapters with self-healing. V2 extends multi-cloud coverage to modern edge/container platforms:

| Package | Maps `deploy` to | `setEnv` | `rollback` | `logs` |
|---|---|---|---|---|
| `packages/provider-vercel` | Vercel Deployments API (git or prebuilt output) | Project env vars + redeploy | Promote previous deployment | Deployment runtime logs API |
| `packages/provider-railway` | Railway GraphQL `serviceInstanceDeploy` | `variableUpsert` + redeploy | Redeploy previous deployment | Deployment logs query |
| `packages/provider-gcp` | Cloud Run Admin API v2 | Service env update | Re-route 100% traffic to previous revision | Cloud Logging API |

### Implementation Steps (Zero Workflow Changes):
1. Extend `ProviderIdSchema` and the target `service` enum in `packages/core`.
2. Implement the `CloudProvider` interface in `packages/provider-*`.
3. Register the provider in `apps/orchestrator/src/providers/registry.ts`.
4. Add a specialist hint in `.bob/rules-multicloud-devops/04-specialists-and-synthesis.md`.

Also scheduled in V2:
- **AWS Secrets Manager** integration for automatic secret lifecycle management.
- **watsonx.ai Agent Multi-Turn Voice Channel** for real-time DevOps incident triage.
- **Bob Shell (`bob run`) pre-triage comment** on GitHub Sentinel incident issues.
- **Dynamic Multi-Region Active-Active Traffic Balancing** across IBM Cloud and AWS Lambda.
