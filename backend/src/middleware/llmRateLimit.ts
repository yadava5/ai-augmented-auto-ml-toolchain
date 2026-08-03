/**
 * Rate limit and daily budget for the routes that spend money.
 *
 * Auth (`authRateLimit.ts`) and inference (`deploymentRateLimit.ts`) were both
 * limited. The LLM routes were not — `createLlmRouter`, `createQueryRouter`,
 * `createPlanChatRouter`, `createRealtimeSessionRouter`,
 * `createFeatureEngineeringRouter` and `createWorkflowRouter` all mount bare in
 * `app.ts`, and every one of them can reach `openai` (NL→SQL pipeline, embedding
 * service, realtime session, workflow turn executor). Any authenticated user —
 * or any bug that retries in a loop — could spend without bound.
 *
 * Two limits, because they catch different failures:
 *
 *   BURST  a runaway client or a retry loop. Minutes matter.
 *   DAILY  sustained draining that stays under the burst limit all day.
 *
 * Deliberately dependency-free, in the shape of `deploymentRateLimit.ts`, for
 * two reasons. `express-rate-limit` is not declared in backend/package.json —
 * it resolves only as a transitive dependency of @modelcontextprotocol/sdk —
 * so adding a second import of it would deepen a dependency edge nobody chose.
 * And the backend runs as a single process on a VM (deploy/beta provisions GCP,
 * it is not serverless), so a process-local counter is a correct counter here.
 * That is NOT true of Cadence, whose in-memory limiter is per-instance on
 * Vercel and therefore effectively `limit x instances`.
 *
 * Keyed by user id, falling back to IP when the deployment runs without a
 * database (auth is only mounted when `hasDatabaseConfiguration()`), so an
 * unauthenticated local dev server is still bounded rather than unlimited.
 */

import type { Request, Response, NextFunction } from 'express';

/** Request shape after `requireAuth`; typed locally so this file imports nothing. */
type MaybeAuthedRequest = Request & { user?: { user_id?: string } };

const isProd = process.env.NODE_ENV === 'production';

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const BURST_WINDOW_MS = 60_000;
/** Generous outside production so vitest, the eval suite and local probes never trip it. */
const BURST_MAX = num('AUTOML_LLM_BURST_PER_MIN', isProd ? 20 : 1_000);
const DAILY_MAX = num('AUTOML_LLM_DAILY_MAX', isProd ? 300 : 100_000);
/** Bounds memory; the process is long-lived on a VM, so this cannot grow forever. */
const MAX_ENTRIES = 5_000;

interface Bucket {
  /** Timestamps inside the burst window. */
  hits: number[];
  /** UTC date the daily counter belongs to, as YYYY-MM-DD. */
  day: string;
  dayCount: number;
  /** Last touch, for eviction. */
  seen: number;
}

const buckets = new Map<string, Bucket>();

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

function evictIfCrowded(): void {
  if (buckets.size <= MAX_ENTRIES) return;
  // Drop the least-recently-seen entries. Sorting only happens at the cap.
  const bySeen = [...buckets.entries()].sort((a, b) => a[1].seen - b[1].seen);
  for (let i = 0; i < bySeen.length - MAX_ENTRIES; i++) buckets.delete(bySeen[i][0]);
}

function keyFor(req: MaybeAuthedRequest): string {
  const userId = req.user?.user_id;
  if (userId) return `u:${userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

/**
 * Guards a router that can reach a paid provider. Mount it in front of the
 * router rather than globally — `app.ts` interleaves LLM and non-LLM routers,
 * so a blanket `router.use` would also throttle project CRUD and uploads.
 */
export function llmRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = keyFor(req as MaybeAuthedRequest);
  const today = utcDay(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [], day: today, dayCount: 0, seen: now };
    buckets.set(key, bucket);
    evictIfCrowded();
  }
  bucket.seen = now;

  // Roll the daily counter at the UTC boundary.
  if (bucket.day !== today) {
    bucket.day = today;
    bucket.dayCount = 0;
  }

  // Compact the burst window in place, same single-pass approach as
  // deploymentRateLimit.ts.
  const cutoff = now - BURST_WINDOW_MS;
  let write = 0;
  for (let read = 0; read < bucket.hits.length; read++) {
    if (bucket.hits[read] > cutoff) bucket.hits[write++] = bucket.hits[read];
  }
  bucket.hits.length = write;

  if (bucket.dayCount >= DAILY_MAX) {
    res.setHeader('Retry-After', String(secondsUntilNextUtcDay(now)));
    res.status(429).json({
      error: `Daily limit of ${DAILY_MAX} model-backed requests reached. Resets at 00:00 UTC.`,
      error_code: 'LLM_DAILY_BUDGET_EXCEEDED'
    });
    return;
  }

  if (bucket.hits.length >= BURST_MAX) {
    const oldest = bucket.hits[0] ?? now;
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((oldest + BURST_WINDOW_MS - now) / 1000))));
    res.status(429).json({
      error: `Too many model-backed requests. Limit is ${BURST_MAX} per minute.`,
      error_code: 'LLM_RATE_LIMITED'
    });
    return;
  }

  bucket.hits.push(now);
  bucket.dayCount += 1;
  next();
}

function secondsUntilNextUtcDay(now: number): number {
  const next = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/** Test seam — the module keeps process-local state by design. */
export function __resetLlmRateLimitForTests(): void {
  buckets.clear();
}
