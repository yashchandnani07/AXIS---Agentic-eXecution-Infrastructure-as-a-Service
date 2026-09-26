<!-- @file infra/aws/README.md  @phase P7  @purpose One-time AWS setup for BobOps (human, admin profile). -->
# AWS infrastructure (V1 second cloud)

The orchestrator runs as the **least-privilege IAM user `bobops-deployer`**. It can only touch Lambda functions named
`bobops-*`, can only pass the `bobops-lambda-execution` role, and can read logs. It cannot create IAM roles or delete
anything.

```powershell
# 1) Execution role (CloudFormation)
aws cloudformation deploy --template-file infra/aws/lambda-execution-role.yaml --stack-name bobops-iam --capabilities CAPABILITY_NAMED_IAM --region us-east-1
aws cloudformation describe-stacks --stack-name bobops-iam --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text
#    → put the printed ARN into .env as AWS_LAMBDA_ROLE_ARN

# 2) Deployer user with the least-privilege policy
aws iam create-user --user-name bobops-deployer
aws iam put-user-policy --user-name bobops-deployer --policy-name bobops-deployer --policy-document file://infra/aws/deployer-policy.json
aws iam create-access-key --user-name bobops-deployer
#    → put AccessKeyId / SecretAccessKey into .env as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

| Resource | Created by | Name |
|---|---|---|
| Execution role | CloudFormation stack `bobops-iam` | `bobops-lambda-execution` |
| Deployer user | human (CLI above) | `bobops-deployer` |
| Function, versions, alias `live`, Function URL | orchestrator after plan approval | `bobops-nimbus-books` |
| Log group | Lambda on first invoke | `/aws/lambda/bobops-nimbus-books` |

Cleanup after the hackathon (human): delete the function, the `bobops-iam` stack and the `bobops-deployer` user.
