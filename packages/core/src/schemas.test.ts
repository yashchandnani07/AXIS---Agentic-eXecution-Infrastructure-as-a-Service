/**
 * @file      packages/core/src/schemas.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Schema guard rails: fixtures valid, secrets rejected from env, name boundary enforced, diagnosis needs evidence.
 * @depends   vitest, ./schemas, ./fixtures, ./events
 * @usedBy    pnpm test
 * @agentNotes These tests encode safety rules from .bob/rules-multicloud-devops/03-cloud-safety-boundaries.md.
 */
import { describe, expect, it } from 'vitest';
import { stageForEvent } from './events';
import { EXAMPLE_APP_PROFILE, examplePlan } from './fixtures';
import {
  AppProfileSchema,
  DeploymentPlanSchema,
  DiagnosisSchema,
  RemediationActionSchema,
  TargetPlanSchema,
  servicesForProvider,
} from './schemas';

const target = examplePlan(['ibm-cloud']).targets[0]!;

describe('schemas', () => {
  it('fixtures are valid', () => {
    expect(AppProfileSchema.parse(EXAMPLE_APP_PROFILE).name).toBe('nimbus-books');
    expect(DeploymentPlanSchema.parse(examplePlan()).targets).toHaveLength(2);
  });
  it('rejects secrets in plain env', () => {
    const r = TargetPlanSchema.safeParse({ ...target, env: { ADMIN_TOKEN: 'x' } });
    expect(r.success).toBe(false);
  });
  it('enforces the bobops- name boundary', () => {
    expect(TargetPlanSchema.safeParse({ ...target, appName: 'prod-db' }).success).toBe(false);
  });
  it('enforces provider/service pairing', () => {
    expect(TargetPlanSchema.safeParse({ ...target, service: 'lambda' }).success).toBe(false);
  });
  it('offers two real, deployable architectures per cloud', () => {
    expect(servicesForProvider('ibm-cloud').map((s) => s.service)).toEqual(['code-engine', 'code-engine-scale-to-zero']);
    expect(servicesForProvider('aws').map((s) => s.service)).toEqual(['lambda', 'lambda-provisioned']);
  });
  it('accepts the cost-optimized/scale-to-zero variant of a target as a genuinely different valid plan', () => {
    const alt = examplePlan(['ibm-cloud'], { 'ibm-cloud': 'code-engine-scale-to-zero' }).targets[0]!;
    expect(TargetPlanSchema.parse(alt).service).toBe('code-engine-scale-to-zero');
    expect(alt.architectureRationale).not.toBe(target.architectureRationale);
  });
  it('requires a real architecture rationale, not a token label', () => {
    expect(TargetPlanSchema.safeParse({ ...target, architectureRationale: 'because' }).success).toBe(false);
  });
  it('refuses a plan with two targets for the same provider', () => {
    expect(DeploymentPlanSchema.safeParse({ ...examplePlan(['ibm-cloud']), targets: [target, target] }).success).toBe(false);
  });
  it('requires two evidence items in a diagnosis', () => {
    expect(DiagnosisSchema.safeParse({ summary: 's', rootCause: 'r', confidence: 'high', evidence: ['one'] }).success).toBe(false);
  });
  it('parses remediation actions', () => {
    expect(RemediationActionSchema.parse({ type: 'set_env', key: 'CATALOG_MODE', value: 'featured' }).type).toBe('set_env');
    expect(RemediationActionSchema.safeParse({ type: 'set_env', key: 'lower', value: 'x' }).success).toBe(false);
  });
  it('maps events to stages', () => {
    expect(stageForEvent('build.completed')).toBe('BUILD');
    expect(stageForEvent('guard.blocked')).toBeNull();
  });
});
