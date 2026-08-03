import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { llmRateLimit, __resetLlmRateLimitForTests } from './llmRateLimit.js';

/**
 * The limits are deliberately generous outside production so the eval suite and
 * local probes never trip them, so these tests set production-shaped values via
 * env and re-import to pick them up.
 */
async function loadWithLimits(burst: number, daily: number) {
  vi.resetModules();
  process.env.AUTOML_LLM_BURST_PER_MIN = String(burst);
  process.env.AUTOML_LLM_DAILY_MAX = String(daily);
  return import('./llmRateLimit.js');
}

function reqFor(userId?: string, ip = '203.0.113.7'): Request {
  return { ip, user: userId ? { user_id: userId } : undefined } as unknown as Request;
}

function resSpy() {
  const headers: Record<string, string> = {};
  const body: { value?: unknown } = {};
  let status = 200;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body.value = payload;
      return this;
    }
  } as unknown as Response;
  return { res, headers, body, get status() { return status; } };
}

describe('llmRateLimit', () => {
  beforeEach(() => {
    __resetLlmRateLimitForTests();
  });

  it('allows traffic under the burst limit', async () => {
    const { llmRateLimit: limit } = await loadWithLimits(5, 1000);
    let passed = 0;
    for (let i = 0; i < 5; i++) {
      const r = resSpy();
      limit(reqFor('user-a'), r.res, (() => { passed++; }) as NextFunction);
    }
    expect(passed).toBe(5);
  });

  it('returns 429 with a Retry-After once the burst limit is exceeded', async () => {
    const { llmRateLimit: limit } = await loadWithLimits(3, 1000);
    for (let i = 0; i < 3; i++) {
      limit(reqFor('user-b'), resSpy().res, (() => {}) as NextFunction);
    }
    const blocked = resSpy();
    let called = false;
    limit(reqFor('user-b'), blocked.res, (() => { called = true; }) as NextFunction);

    expect(called).toBe(false);
    expect(blocked.status).toBe(429);
    expect(blocked.body.value).toMatchObject({ error_code: 'LLM_RATE_LIMITED' });
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('enforces the daily budget independently of the burst window', async () => {
    const { llmRateLimit: limit } = await loadWithLimits(1000, 4);
    for (let i = 0; i < 4; i++) {
      limit(reqFor('user-c'), resSpy().res, (() => {}) as NextFunction);
    }
    const blocked = resSpy();
    limit(reqFor('user-c'), blocked.res, (() => {}) as NextFunction);

    expect(blocked.status).toBe(429);
    expect(blocked.body.value).toMatchObject({ error_code: 'LLM_DAILY_BUDGET_EXCEEDED' });
  });

  it('buckets per user, so one user cannot exhaust another', async () => {
    const { llmRateLimit: limit } = await loadWithLimits(2, 1000);
    for (let i = 0; i < 2; i++) {
      limit(reqFor('noisy'), resSpy().res, (() => {}) as NextFunction);
    }
    const noisy = resSpy();
    limit(reqFor('noisy'), noisy.res, (() => {}) as NextFunction);
    expect(noisy.status).toBe(429);

    const quiet = resSpy();
    let quietPassed = false;
    limit(reqFor('quiet'), quiet.res, (() => { quietPassed = true; }) as NextFunction);
    expect(quietPassed).toBe(true);
  });

  it('falls back to IP when no user is attached, so an unauthenticated server is still bounded', async () => {
    const { llmRateLimit: limit } = await loadWithLimits(2, 1000);
    for (let i = 0; i < 2; i++) {
      limit(reqFor(undefined, '198.51.100.4'), resSpy().res, (() => {}) as NextFunction);
    }
    const blocked = resSpy();
    limit(reqFor(undefined, '198.51.100.4'), blocked.res, (() => {}) as NextFunction);
    expect(blocked.status).toBe(429);

    // A different address is unaffected.
    const other = resSpy();
    let passed = false;
    limit(reqFor(undefined, '198.51.100.5'), other.res, (() => { passed = true; }) as NextFunction);
    expect(passed).toBe(true);
  });

  it('is permissive by default outside production, so tests and evals do not trip it', () => {
    // The module under test was imported with no env overrides in this file's
    // top-level import, and NODE_ENV is not 'production' under vitest.
    let passed = 0;
    for (let i = 0; i < 200; i++) {
      llmRateLimit(reqFor('bulk'), resSpy().res, (() => { passed++; }) as NextFunction);
    }
    expect(passed).toBe(200);
  });
});
