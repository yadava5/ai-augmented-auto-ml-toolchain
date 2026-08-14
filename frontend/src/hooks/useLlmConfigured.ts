import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api/client';

export interface LlmConfiguredState {
  /** `null` means "unknown" — the probe has not answered, or answered unusably. */
  configured: boolean | null;
  /** Backend-supplied explanation, when it sent one. */
  message: string | null;
}

const UNKNOWN: LlmConfiguredState = { configured: null, message: null };

let cachedState: LlmConfiguredState | null = null;
let pendingRequest: Promise<LlmConfiguredState> | null = null;

/**
 * Narrow `checks.llm` out of an unknown health payload.
 * Returns null for anything that is not an explicit boolean `configured`.
 */
function readLlmCheck(payload: unknown): LlmConfiguredState | null {
  if (!payload || typeof payload !== 'object') return null;

  const checks = (payload as { checks?: unknown }).checks;
  if (!checks || typeof checks !== 'object') return null;

  const llm = (checks as { llm?: unknown }).llm;
  if (!llm || typeof llm !== 'object') return null;

  const { configured, message } = llm as { configured?: unknown; message?: unknown };
  if (typeof configured !== 'boolean') return null;

  // `message` is optional on the backend check — absent when a key IS configured.
  return { configured, message: typeof message === 'string' ? message : null };
}

async function loadLlmConfigured(): Promise<LlmConfiguredState> {
  // `apiFetch` (raw Response) rather than `apiRequest`: /api/health answers 503
  // whenever a *critical* check fails, and `apiRequest` funnels every non-2xx
  // through `parseResponse`, which throws an ApiError. The body carries the
  // `checks.llm` block either way, so we read it ourselves and ignore the status.
  try {
    const response = await apiFetch('/health');
    // Fail safe: an unreachable backend, a non-JSON body or a missing llm block
    // is "unknown", never "not configured". Telling someone their API key is
    // missing on the strength of a failed probe would be a false accusation.
    return readLlmCheck(await response.json()) ?? UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

/**
 * Single-flight the probe and cache only definitive answers, so repeated mounts
 * (the composer bar remounts freely) don't re-hit /health, while a transient
 * failure still retries on the next mount. Mirrors `useLlmModelCatalog`.
 */
function requestLlmConfigured(): Promise<LlmConfiguredState> {
  if (cachedState) {
    return Promise.resolve(cachedState);
  }

  if (!pendingRequest) {
    pendingRequest = loadLlmConfigured()
      .then((state) => {
        if (state.configured !== null) {
          cachedState = state;
        }
        return state;
      })
      .finally(() => {
        pendingRequest = null;
      });
  }

  return pendingRequest;
}

export function resetLlmConfiguredCacheForTests() {
  cachedState = null;
  pendingRequest = null;
}

/**
 * Reports whether the backend has a model API key configured, from /api/health.
 * `configured === false` is the only value that means "no key" — treat `null`
 * as "don't show anything".
 */
export function useLlmConfigured(): LlmConfiguredState {
  const [state, setState] = useState<LlmConfiguredState>(() => cachedState ?? UNKNOWN);

  useEffect(() => {
    if (cachedState) {
      return;
    }

    let cancelled = false;

    void requestLlmConfigured().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
