import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { env } from './config.js';
import { resolveDeploymentPredictTarget, rewriteDeploymentPredictPath } from './services/deploymentPredictProxy.js';
import type { DeploymentRecord } from './types/deployment.js';

function makeDeployment(overrides: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return {
    deploymentId: 'deployment-1',
    modelId: 'model-1',
    projectId: 'project-1',
    name: 'endpoint',
    status: 'healthy',
    port: 55001,
    endpointUrl: 'http://127.0.0.1:55001',
    config: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildUnsignedBenchmarkJwt(userId: string) {
  const encode = (value: unknown) => Buffer
    .from(JSON.stringify(value), 'utf8')
    .toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: userId,
    exp: now + 60 * 60,
    iat: now
  })}.benchmark`;
}

describe('rewriteDeploymentPredictPath', () => {
  it('rewrites the mounted root path to the inference predict endpoint', () => {
    expect(rewriteDeploymentPredictPath('/')).toBe('/predict');
  });

  it('preserves query params when rewriting to the inference predict endpoint', () => {
    expect(rewriteDeploymentPredictPath('/?explain=true')).toBe('/predict?explain=true');
  });
});

describe('resolveDeploymentPredictTarget', () => {
  it('prefers the live cache entry when available', () => {
    const deployment = makeDeployment({ port: 55001 });

    expect(resolveDeploymentPredictTarget(deployment, {
      deploymentId: deployment.deploymentId,
      modelId: deployment.modelId,
      projectId: deployment.projectId,
      containerId: 'container-1',
      port: 55007,
      status: 'healthy',
      consecutiveFailures: 0,
    })).toBe('http://127.0.0.1:55007');
  });

  it('falls back to the persisted deployment port when cache is unavailable', () => {
    expect(resolveDeploymentPredictTarget(makeDeployment({ port: 55008 }))).toBe('http://127.0.0.1:55008');
  });

  it('rejects deployments that are not healthy or have no port', () => {
    expect(() => resolveDeploymentPredictTarget(makeDeployment({ status: 'failed', port: 55008 }))).toThrow(
      'Deployment not available',
    );
    expect(() => resolveDeploymentPredictTarget(makeDeployment({ port: undefined }))).toThrow(
      'Deployment not available',
    );
  });
});

describe('createApp auth routing', () => {
  const originalDatabaseUrl = env.databaseUrl;
  const originalBenchmarkAuthBypass = env.benchmarkAuthBypass;

  afterEach(() => {
    env.databaseUrl = originalDatabaseUrl;
    env.benchmarkAuthBypass = originalBenchmarkAuthBypass;
  });

  it('allows benchmark auth bootstrap without database configuration', async () => {
    env.databaseUrl = undefined;
    env.benchmarkAuthBypass = true;

    const response = await request(createApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${buildUnsignedBenchmarkJwt('playwright-user')}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: 'playwright-user@benchmark.local',
      email_verified: true,
      role: 'user'
    });
  });
});
