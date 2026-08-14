import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { resetLlmConfiguredCacheForTests, useLlmConfigured } from '../useLlmConfigured';

// ── Helpers ────────────────────────────────────────────────────

const LLM_MESSAGE =
  'No model API key is configured. Set OPENAI_API_KEY in backend/.env to enable the AI models.';

function healthBody(llm: unknown) {
  return JSON.stringify({ status: 'degraded', checks: { llm } });
}

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

// ── Setup / Teardown ───────────────────────────────────────────

beforeEach(() => {
  resetLlmConfiguredCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLlmConfiguredCacheForTests();
});

// ── Tests ──────────────────────────────────────────────────────

describe('useLlmConfigured', () => {
  it('reports configured: false when the backend says so', async () => {
    const fetchSpy = mockFetch(
      new Response(healthBody({ status: 'degraded', critical: false, configured: false, message: LLM_MESSAGE }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useLlmConfigured());

    await waitFor(() => expect(result.current.configured).toBe(false));
    expect(result.current.message).toBe(LLM_MESSAGE);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/health$/);
  });

  it('reads the llm block even when /health answers 503', async () => {
    // The discriminating case: apiRequest would throw on a non-2xx before the
    // body is read, so this is what proves apiFetch + manual .json() is right.
    const fetchSpy = mockFetch(
      new Response(healthBody({ status: 'degraded', critical: false, configured: false, message: LLM_MESSAGE }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useLlmConfigured());

    await waitFor(() => expect(result.current.configured).toBe(false));
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('reports configured: true with no message', async () => {
    mockFetch(
      new Response(healthBody({ status: 'ok', critical: false, configured: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useLlmConfigured());

    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.message).toBeNull();
  });

  it('stays null when the request rejects', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useLlmConfigured());

    // Wait for the failure to actually be observed before asserting — otherwise
    // "still null" would pass vacuously against a probe that never ran.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(result.current.configured).toBeNull();
    expect(result.current.message).toBeNull();
  });

  it('stays null when the body is not JSON', async () => {
    const fetchSpy = mockFetch(new Response('<html>bad gateway</html>', { status: 502 }));

    const { result } = renderHook(() => useLlmConfigured());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(result.current.configured).toBeNull();
  });

  it('stays null when the checks.llm block is absent', async () => {
    const fetchSpy = mockFetch(
      new Response(JSON.stringify({ status: 'ok', checks: { database: { status: 'ok' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useLlmConfigured());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(result.current.configured).toBeNull();
  });

  it('stays null when configured is not a boolean', async () => {
    const fetchSpy = mockFetch(
      new Response(healthBody({ status: 'degraded', configured: 'false' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useLlmConfigured());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(result.current.configured).toBeNull();
  });

  it('does not re-probe /health once a definitive answer is cached', async () => {
    const fetchSpy = mockFetch(
      new Response(healthBody({ status: 'degraded', critical: false, configured: false, message: LLM_MESSAGE }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const first = renderHook(() => useLlmConfigured());
    await waitFor(() => expect(first.result.current.configured).toBe(false));

    const second = renderHook(() => useLlmConfigured());
    expect(second.result.current.configured).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('retries after a failed probe instead of caching the unknown', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(healthBody({ status: 'degraded', critical: false, configured: false, message: LLM_MESSAGE }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const first = renderHook(() => useLlmConfigured());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(first.result.current.configured).toBeNull();

    const second = renderHook(() => useLlmConfigured());
    await waitFor(() => expect(second.result.current.configured).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
