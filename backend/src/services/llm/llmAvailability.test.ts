import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../config.js';

import {
  assertLlmConfigured,
  isLlmConfigured,
  LLM_NOT_CONFIGURED,
  LlmNotConfiguredError
} from './llmAvailability.js';
import { normalizeLlmStreamError } from './streamErrors.js';

const originalKey = env.openaiApiKey;

afterEach(() => {
  env.openaiApiKey = originalKey;
});

describe('isLlmConfigured', () => {
  it('is false when the key is unset', () => {
    env.openaiApiKey = '';
    expect(isLlmConfigured()).toBe(false);
  });

  it('is false when the key is only whitespace', () => {
    // A .env line like `OPENAI_API_KEY= ` reads as a present-but-useless key.
    env.openaiApiKey = '   ';
    expect(isLlmConfigured()).toBe(false);
  });

  it('is true when a key is present', () => {
    env.openaiApiKey = 'sk-test';
    expect(isLlmConfigured()).toBe(true);
  });
});

describe('assertLlmConfigured', () => {
  it('throws a typed 503 error when the key is unset', () => {
    env.openaiApiKey = '';
    expect(() => assertLlmConfigured()).toThrow(LlmNotConfiguredError);

    try {
      assertLlmConfigured();
      expect.unreachable('assertLlmConfigured should have thrown');
    } catch (error) {
      const typed = error as LlmNotConfiguredError;
      // 503, never 401 — the caller's session is valid, the server is
      // incomplete. A 401 here would make the frontend try to refresh the
      // user's token and eventually sign them out.
      expect(typed.status).toBe(503);
      expect(typed.code).toBe(LLM_NOT_CONFIGURED);
      expect(typed.message).toContain('OPENAI_API_KEY');
    }
  });

  it('does not throw when a key is present', () => {
    env.openaiApiKey = 'sk-test';
    expect(() => assertLlmConfigured()).not.toThrow();
  });
});

describe('normalizeLlmStreamError ordering', () => {
  it('reports a missing key as LLM_NOT_CONFIGURED, not as a provider fault', () => {
    // Regression guard for detection ORDER. LlmNotConfiguredError is a plain
    // Error, so it matches none of the OpenAI SDK `instanceof` branches. If
    // its check is moved below them it falls through to the JSON-fingerprint
    // fallback and is reported as UPSTREAM_UNKNOWN with retryable:true —
    // blaming a provider that was never contacted, and telling the user to
    // retry something that cannot succeed until a key is set.
    const normalized = normalizeLlmStreamError(new LlmNotConfiguredError());

    expect(normalized.code).toBe(LLM_NOT_CONFIGURED);
    expect(normalized.retryable).toBe(false);
    expect(normalized.status).toBe(503);
    expect(normalized.message).toContain('OPENAI_API_KEY');
  });
});
