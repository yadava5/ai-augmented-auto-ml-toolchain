import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // The suite has always assumed a configured model provider — the tests
      // that exercise LLM paths mock the provider and never make a request.
      // That assumption used to be invisible because an unset key only failed
      // later, at the network call the mocks replaced. Now that an unset key
      // is refused up front, the assumption has to be stated.
      //
      // This declares the environment; it does not weaken any assertion. The
      // tests that cover the unconfigured case set `env.openaiApiKey = ''`
      // themselves (llmAvailability.test.ts, realtimeSession.test.ts), so the
      // guard is still exercised in both directions.
      OPENAI_API_KEY: 'sk-test-not-a-real-key'
    },
    clearMocks: true,
    restoreMocks: true,
    onConsoleLog() {
      return false;
    }
  }
});
