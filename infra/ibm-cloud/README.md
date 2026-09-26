<!-- @file infra/ibm-cloud/README.md  @phase P6  @purpose How IBM Cloud resources for BobOps are created and owned. -->
# IBM Cloud infrastructure (V1 primary cloud)

| Resource | Created by | Name |
|---|---|---|
| Code Engine project | `bootstrap.ps1` (human, once) | `bobops-demo` (us-south) |
| Container Registry namespace + registry secret | Code Engine automatically on first `--build-source` build | `ce--…` |
| Build run + image | orchestrator (`IbmCloudProvider.deploy`) after plan approval | `<app>-build-…` |
| App | orchestrator after plan approval | `bobops-nimbus-books` |
| Secret | orchestrator from `plan.secretRefs` (`SECRET_<NAME>` in .env) | `bobops-nimbus-books-secrets` |
| Replay Control Center (Phase 14) | human | `bobops-control-center` |

All app/secret names are constrained by the core schema to `^bobops-[a-z0-9-]{3,40}$`.
Clean up after the hackathon: `ibmcloud ce project delete --name bobops-demo -f --hard` (human only).
