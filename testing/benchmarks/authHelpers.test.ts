import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBenchmarkAuthResponse,
  getAuthHeaders,
  isBenchmarkAuthBypassEnabled,
} from '../helpers.ts';

test('benchmark auth helper produces a bearer token and bypass headers only in bypass mode', () => {
  const previous = process.env.BENCHMARK_AUTH_BYPASS;
  process.env.BENCHMARK_AUTH_BYPASS = 'true';

  try {
    assert.equal(isBenchmarkAuthBypassEnabled(), true);

    const auth = createBenchmarkAuthResponse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'benchmark@example.local',
      name: 'Benchmark User',
    });
    const headers = getAuthHeaders(auth);

    assert.match(auth.accessToken, /\.benchmark$/);
    assert.equal(auth.refreshToken, auth.accessToken);
    assert.deepEqual(auth.user, {
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'benchmark@example.local',
      name: 'Benchmark User',
      role: 'user',
      email_verified: true,
    });
    assert.equal(headers.Authorization, `Bearer ${auth.accessToken}`);
    assert.equal(headers['x-benchmark-user-id'], auth.user.user_id);
    assert.equal(headers['x-benchmark-user-email'], auth.user.email);
    assert.equal(headers['x-benchmark-user-name'], auth.user.name);
  } finally {
    if (previous === undefined) {
      delete process.env.BENCHMARK_AUTH_BYPASS;
    } else {
      process.env.BENCHMARK_AUTH_BYPASS = previous;
    }
  }
});
