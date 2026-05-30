import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

interface CreateProjectResponse {
  project: {
    id: string;
  };
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
}

interface RegisterBenchmarkUserOptions {
  email?: string;
  emailPrefix?: string;
  name?: string;
  password?: string;
  userId?: string;
}

const benchmarkApiBase = process.env.BENCHMARK_API_BASE;

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, '');
}

export function getApiOrigin() {
  const raw = benchmarkApiBase ?? process.env.AUTOML_API_BASE_URL ?? 'http://127.0.0.1:4000';
  const normalized = stripTrailingSlash(raw);
  return normalized.endsWith('/api') ? normalized.slice(0, -4) : normalized;
}

export function getApiBase() {
  return `${getApiOrigin()}/api`;
}

export function getFrontendBase() {
  return stripTrailingSlash(process.env.AUTOML_FRONTEND_BASE_URL ?? 'http://127.0.0.1:5173');
}

export function isBenchmarkAuthBypassEnabled() {
  return process.env.BENCHMARK_AUTH_BYPASS === 'true';
}

function buildUnsignedClientJwt(userId: string) {
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

function userString(auth: AuthResponse, key: string, fallback: string) {
  const value = auth.user[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function createBenchmarkAuthResponse(options: RegisterBenchmarkUserOptions = {}): AuthResponse {
  const userId = options.userId ?? randomUUID();
  const email = options.email ?? `${options.emailPrefix ?? 'benchmark'}-${userId.slice(0, 12)}@benchmark.local`;
  const name = options.name ?? 'Benchmark User';
  const accessToken = buildUnsignedClientJwt(userId);

  return {
    accessToken,
    refreshToken: accessToken,
    user: {
      user_id: userId,
      email,
      name,
      role: 'user',
      email_verified: true
    }
  };
}

export function getAuthHeaders(auth: AuthResponse): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`
  };

  if (isBenchmarkAuthBypassEnabled()) {
    headers['x-benchmark-user-id'] = userString(auth, 'user_id', 'benchmark-user');
    headers['x-benchmark-user-email'] = userString(auth, 'email', 'benchmark-user@benchmark.local');
    headers['x-benchmark-user-name'] = userString(auth, 'name', 'Benchmark User');
  }

  return headers;
}

export async function registerBenchmarkUser(
  request: APIRequestContext,
  options: RegisterBenchmarkUserOptions = {}
): Promise<AuthResponse> {
  if (isBenchmarkAuthBypassEnabled()) {
    return createBenchmarkAuthResponse(options);
  }

  const email = options.email ?? `${options.emailPrefix ?? 'playwright'}-${randomUUID()}@automl.test`;
  const response = await request.post(`${getApiBase()}/auth/register`, {
    data: {
      email,
      password: options.password ?? 'Playwright2026!',
      name: options.name ?? 'Playwright Bot'
    }
  });

  if (!response.ok()) {
    throw new Error(`Registration failed: ${response.status()} ${await response.text()}`);
  }

  return response.json() as Promise<AuthResponse>;
}

const API_BASE_URL = getApiOrigin();

export async function resetBackendData(request: APIRequestContext) {
  await request.delete(`${API_BASE_URL}/api/projects/reset`);
}

export async function apiCreateProject(request: APIRequestContext, payload: Record<string, unknown>) {
  const response = await request.post(`${API_BASE_URL}/api/projects`, {
    data: payload
  });

  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Project creation failed: ${response.status()} - ${text}`);
  }

  return (await response.json()) as CreateProjectResponse;
}
