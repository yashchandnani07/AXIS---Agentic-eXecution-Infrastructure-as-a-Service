/**
 * @file      apps/demo-service/src/lambda.ts  (golden copy: docs/demo/golden/lambda.ts)
 * @phase     P3 (golden) / generated live by IBM Bob (deployment-asset-authoring skill)
 * @owner     Product & Experience
 * @purpose   AWS Lambda entry point: adapts Lambda Function URL events to the runtime-agnostic Hono app.
 * @depends   hono/aws-lambda, ./app
 * @usedBy    packages/provider-aws bundleLambda() (esbuild entry src/lambda.ts, handler "lambda.handler")
 * @agentNotes The export MUST be named `handler`.
 */
import { handle } from 'hono/aws-lambda';
import { createApp } from './app';

export const handler = handle(createApp(process.env));
