import { env } from '../../config.js';

/**
 * Stable code for "this deployment has no model credentials".
 *
 * It follows the repository's existing all-caps `error` convention (see the
 * 409 `WORKFLOW_ALREADY_RUNNING` in routes/workflows.ts), which the frontend
 * already promotes into its `code` slot in lib/api/llm.ts.
 */
export const LLM_NOT_CONFIGURED = 'LLM_NOT_CONFIGURED';

/**
 * Operator-facing copy. It names the variable to set rather than saying
 * "contact your administrator", because on this project the person reading
 * it is the person who runs the server.
 */
export const LLM_NOT_CONFIGURED_MESSAGE =
  'No model API key is configured. Set OPENAI_API_KEY in backend/.env to enable the AI models. '
  + 'Everything that does not call a model — uploads, profiling, SQL, charts, notebooks and training — works without it.';

export class LlmNotConfiguredError extends Error {
  readonly code = LLM_NOT_CONFIGURED;
  /** 503, not 401: the deployment is incomplete, the caller's session is fine. */
  readonly status = 503;

  constructor(message: string = LLM_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = 'LlmNotConfiguredError';
  }
}

/** True when a model credential is present. The single source of truth. */
export function isLlmConfigured(): boolean {
  return env.openaiApiKey.trim().length > 0;
}

/**
 * Fail before the network call rather than after it.
 *
 * Without this, an unset key reaches OpenAI and comes back as a 401
 * `AuthenticationError`, which the global error handler in app.ts flattens
 * into a generic 500 "Internal Server Error" — a round-trip to be told
 * something we already knew at startup, reported as if the server broke.
 *
 * Called at the two chokepoints every model call funnels through
 * (createLlmClient and embeddingService.getOpenAI) rather than at each route,
 * so a route added later cannot forget the guard.
 */
export function assertLlmConfigured(): void {
  if (!isLlmConfigured()) {
    throw new LlmNotConfiguredError();
  }
}
