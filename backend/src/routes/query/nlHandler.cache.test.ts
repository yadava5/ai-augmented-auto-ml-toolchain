/**
 * When the generation cache is allowed to keep a statement.
 *
 * The pipeline reports a cache key; this handler decides whether to commit it.
 * The rule is that only SQL which actually executed gets cached, and when a
 * repair was needed it is the *repaired* statement that gets cached. Committing
 * at generation time instead would persist a statement already known to fail
 * and re-pay for its repair on every future hit.
 *
 * The failure branch is the one worth pinning: nothing else would notice a
 * cache that happily stored broken SQL and served it back.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/queryCache.js', () => ({
  getCachedQueryResult: vi.fn(),
  storeCachedQueryResult: vi.fn()
}));

vi.mock('../../services/sqlExecutor.js', () => ({
  executeReadOnlyQuery: vi.fn()
}));

// Only the two model-calling functions are faked. commitNlGeneration and
// readNlGeneration stay real — they are the subject of the assertions.
vi.mock('../../services/nlToSql/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/nlToSql/index.js')>(
    '../../services/nlToSql/index.js'
  );
  return {
    ...actual,
    generateSqlFromNaturalLanguageV2: vi.fn(),
    repairSqlFromExecutionErrorV2: vi.fn()
  };
});

import {
  __clearNlGenerationCacheForTests,
  generateSqlFromNaturalLanguageV2,
  readNlGeneration,
  repairSqlFromExecutionErrorV2,
  type GeneratedSqlV2
} from '../../services/nlToSql/index.js';
import { getCachedQueryResult } from '../../services/queryCache.js';
import { executeReadOnlyQuery } from '../../services/sqlExecutor.js';

import { resolveNlQueryExecution } from './nlHandler.js';

const mockGenerate = vi.mocked(generateSqlFromNaturalLanguageV2);
const mockRepair = vi.mocked(repairSqlFromExecutionErrorV2);
const mockExecute = vi.mocked(executeReadOnlyQuery);
const mockGetCached = vi.mocked(getCachedQueryResult);

const CACHE_KEY = 'test-cache-key';

function generated(sql: string): GeneratedSqlV2 {
  return {
    sql,
    explanation: { summary: 'x', assumptions: [], validationNotes: [] },
    provider: { provider: 'test', model: 'test-model' }
  } as unknown as GeneratedSqlV2;
}

const executionResult = { rows: [], columns: [], rowCount: 0 } as never;

describe('nlHandler generation-cache commits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearNlGenerationCacheForTests();
    delete process.env.AUTOML_NL2SQL_CACHE_DISABLED;
    mockGetCached.mockResolvedValue(null as never);
    // The pipeline is faked, so report the key the way the real one does.
    mockGenerate.mockImplementation(async (options) => {
      options.onCacheKey?.({ key: CACHE_KEY, hit: false });
      return generated('SELECT 1');
    });
  });

  it('caches SQL that executed', async () => {
    mockExecute.mockResolvedValue(executionResult);

    await resolveNlQueryExecution({ projectId: 'p1', query: 'q' });

    expect(readNlGeneration(CACHE_KEY)?.sql).toBe('SELECT 1');
  });

  it('caches nothing when the SQL fails and the repair fails too', async () => {
    mockExecute.mockRejectedValue(new Error('syntax error at or near "SELCT"'));
    mockRepair.mockResolvedValue(generated('SELECT 2'));

    await resolveNlQueryExecution({ projectId: 'p1', query: 'q' });

    // The whole point: a statement that never ran must not be served again.
    expect(readNlGeneration(CACHE_KEY)).toBeUndefined();
  });

  it('caches nothing when the SQL fails and repair itself throws', async () => {
    mockExecute.mockRejectedValue(new Error('boom'));
    mockRepair.mockRejectedValue(new Error('repair unavailable'));

    await resolveNlQueryExecution({ projectId: 'p1', query: 'q' }).catch(() => undefined);

    expect(readNlGeneration(CACHE_KEY)).toBeUndefined();
  });

  it('caches the repaired statement, not the one that failed', async () => {
    mockExecute
      .mockRejectedValueOnce(new Error('column "scr" does not exist'))
      .mockResolvedValue(executionResult);
    mockRepair.mockResolvedValue(generated('SELECT score FROM t'));

    await resolveNlQueryExecution({ projectId: 'p1', query: 'q' });

    expect(readNlGeneration(CACHE_KEY)?.sql).toBe('SELECT score FROM t');
  });

  it('caches nothing when the pipeline reports no key', async () => {
    mockGenerate.mockImplementation(async () => generated('SELECT 1'));
    mockExecute.mockResolvedValue(executionResult);

    await resolveNlQueryExecution({ projectId: 'p1', query: 'q' });

    expect(readNlGeneration(CACHE_KEY)).toBeUndefined();
  });
});
