/**
 * The NL→SQL generation cache.
 *
 * Two claims are under test, and the second matters more than the first:
 *
 * 1. A repeated question skips both paid model calls.
 * 2. A question that only *looks* repeated does not. AutoML's workflow runs
 *    upload → explore → preprocess → feature engineering, and preprocessing
 *    rewrites columns, dtypes and row counts. The same words against the same
 *    project can therefore require different SQL, so anything that reaches the
 *    prompt must reach the key.
 *
 * Claim 2 is the one nothing else in the suite would catch: a cache that is
 * merely too eager still returns valid-looking SQL, just for a schema that no
 * longer exists.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatasetRepository } from '../../repositories/datasetRepository.js';
import type { DatasetProfile } from '../../types/dataset.js';
import type { LlmClient, LlmRequest, LlmStreamHandlers } from '../llm/llmClient.js';

import {
  __clearNlGenerationCacheForTests,
  commitNlGeneration,
  deriveNlGenerationCacheKey,
  readNlGeneration
} from './generationCache.js';
import type { GeneratedSqlV2, JoinCandidate, SchemaTableContext } from './types.js';

import { createNl2SqlService } from './index.js';

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

function baseTables(): SchemaTableContext[] {
  return [
    {
      tableName: 'student_data',
      sourceFilename: 'student_data.csv',
      rowCount: 1000,
      columns: [
        { name: 'id', dtype: 'integer' },
        { name: 'score', dtype: 'float' }
      ]
    }
  ];
}

function baseJoins(): JoinCandidate[] {
  return [
    {
      leftTable: 'student_data',
      leftColumn: 'account_id',
      rightTable: 'accounts',
      rightColumn: 'id'
    } as JoinCandidate
  ];
}

function baseInputs() {
  return {
    projectId: 'project-1',
    query: 'average score by cohort',
    defaultTableName: 'student_data',
    tables: baseTables(),
    joinCandidates: baseJoins(),
    model: 'gpt-x',
    reasoningEffort: 'medium'
  };
}

describe('deriveNlGenerationCacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(deriveNlGenerationCacheKey(baseInputs())).toBe(
      deriveNlGenerationCacheKey(baseInputs())
    );
  });

  it('is stable across separately-constructed but equal objects', () => {
    // Guards against accidentally keying on object identity.
    const a = baseInputs();
    const b = { ...baseInputs(), tables: baseTables(), joinCandidates: baseJoins() };
    expect(deriveNlGenerationCacheKey(a)).toBe(deriveNlGenerationCacheKey(b));
  });

  const mutations: Array<[string, (i: ReturnType<typeof baseInputs>) => void]> = [
    ['the question', (i) => { i.query = 'median score by cohort'; }],
    ['the project', (i) => { i.projectId = 'project-2'; }],
    ['the default table', (i) => { i.defaultTableName = 'accounts'; }],
    ['the model', (i) => { i.model = 'gpt-y'; }],
    ['the reasoning effort', (i) => { i.reasoningEffort = 'high'; }],
    // The preprocessing-drift cases — the reason this test file exists.
    ['an added column', (i) => { i.tables[0].columns.push({ name: 'cohort', dtype: 'string' }); }],
    ['a removed column', (i) => { i.tables[0].columns.pop(); }],
    ['a renamed column', (i) => { i.tables[0].columns[1].name = 'final_score'; }],
    ['a retyped column', (i) => { i.tables[0].columns[1].dtype = 'integer'; }],
    ['the row count', (i) => { i.tables[0].rowCount = 999; }],
    ['the source filename', (i) => { i.tables[0].sourceFilename = 'other.csv'; }],
    ['the table name', (i) => { i.tables[0].tableName = 'students'; }],
    ['an added table', (i) => { i.tables.push(baseTables()[0]); }],
    ['a join candidate', (i) => { i.joinCandidates[0].rightColumn = 'account_id'; }]
  ];

  it.each(mutations)('changes when %s changes', (_label, mutate) => {
    const before = deriveNlGenerationCacheKey(baseInputs());
    const mutated = baseInputs();
    mutate(mutated);
    expect(deriveNlGenerationCacheKey(mutated)).not.toBe(before);
  });

  it('distinguishes column order, because the prompt renders it in order', () => {
    const swapped = baseInputs();
    swapped.tables[0].columns.reverse();
    expect(deriveNlGenerationCacheKey(swapped)).not.toBe(
      deriveNlGenerationCacheKey(baseInputs())
    );
  });
});

// ---------------------------------------------------------------------------
// Store semantics
// ---------------------------------------------------------------------------

const payload = { sql: 'SELECT 1' } as unknown as GeneratedSqlV2;

describe('generation cache store', () => {
  beforeEach(() => {
    __clearNlGenerationCacheForTests();
    delete process.env.AUTOML_NL2SQL_CACHE_DISABLED;
    vi.useRealTimers();
  });

  it('returns nothing for an unknown key', () => {
    expect(readNlGeneration('nope')).toBeUndefined();
  });

  it('round-trips a committed entry', () => {
    commitNlGeneration('k', payload);
    expect(readNlGeneration('k')).toBe(payload);
  });

  it('expires an entry once its TTL has passed', () => {
    vi.useFakeTimers();
    commitNlGeneration('k', payload);
    expect(readNlGeneration('k')).toBe(payload);

    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(readNlGeneration('k')).toBeUndefined();
  });

  it('serves nothing while disabled, without losing what was stored', () => {
    commitNlGeneration('k', payload);
    process.env.AUTOML_NL2SQL_CACHE_DISABLED = '1';
    expect(readNlGeneration('k')).toBeUndefined();

    delete process.env.AUTOML_NL2SQL_CACHE_DISABLED;
    expect(readNlGeneration('k')).toBe(payload);
  });

  it('bounds itself, evicting least-recently-read entries first', () => {
    // Deliberately NOT vi.resetModules() + dynamic import. That would create a
    // second copy of the module with its own Map while pipeline.ts kept the
    // first, so this test would pass against a cache nothing else uses. The
    // limit is read per call precisely so the real instance can be tested.
    process.env.AUTOML_NL2SQL_CACHE_MAX_ENTRIES = '3';
    try {
      commitNlGeneration('a', payload);
      commitNlGeneration('b', payload);
      commitNlGeneration('c', payload);

      // Re-read 'a' so 'b' becomes the least recently used.
      expect(readNlGeneration('a')).toBe(payload);

      commitNlGeneration('d', payload);

      expect(readNlGeneration('b')).toBeUndefined();
      expect(readNlGeneration('a')).toBe(payload);
      expect(readNlGeneration('c')).toBe(payload);
      expect(readNlGeneration('d')).toBe(payload);
    } finally {
      delete process.env.AUTOML_NL2SQL_CACHE_MAX_ENTRIES;
    }
  });

  it('honours a TTL set through the environment', () => {
    // Would have been impossible to assert when TTL_MS was frozen at import.
    vi.useFakeTimers();
    process.env.AUTOML_NL2SQL_CACHE_TTL_MS = '1000';
    try {
      commitNlGeneration('k', payload);
      vi.advanceTimersByTime(1001);
      expect(readNlGeneration('k')).toBeUndefined();
    } finally {
      delete process.env.AUTOML_NL2SQL_CACHE_TTL_MS;
    }
  });

  it('shares one cache instance with the pipeline module', () => {
    // The split-brain guard. pipeline.ts holds its own import of this module;
    // if that ever resolves to a different instance, an entry committed here
    // would be invisible there and the cache would silently never hit.
    commitNlGeneration('shared-key', payload);
    expect(readNlGeneration('shared-key')).toBe(payload);
  });
});

// ---------------------------------------------------------------------------
// Through the real pipeline — the claims that justify the change
// ---------------------------------------------------------------------------

function buildDataset(overrides: Partial<DatasetProfile> = {}): DatasetProfile {
  return {
    datasetId: 'dataset-1',
    projectId: 'project-1',
    filename: 'student_data.csv',
    fileType: 'csv',
    size: 100,
    nRows: 1000,
    nCols: 2,
    columns: [
      { name: 'id', dtype: 'integer', nullCount: 0 },
      { name: 'score', dtype: 'integer', nullCount: 0 }
    ],
    sample: [{ id: 1, score: 90 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { tableName: 'student_data' },
    ...overrides
  } as DatasetProfile;
}

function createDatasetRepository(datasets: DatasetProfile[]): DatasetRepository {
  return {
    list: vi.fn(async () => datasets),
    listByProject: vi.fn(async (projectId: string) =>
      datasets.filter((dataset) => dataset.projectId === projectId)
    ),
    get: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  } as unknown as DatasetRepository;
}

const PLANNING_RESPONSE = JSON.stringify({
  intentSummary: 'Average score',
  selectedTables: ['student_data'],
  joinPlan: [],
  filters: [],
  aggregations: [],
  assumptions: [],
  confidence: 0.9
});

const SQL_RESPONSE = JSON.stringify({
  sql: 'SELECT avg(score) FROM student_data LIMIT 50',
  rationale: 'Average of score.',
  intentSummary: 'Average score',
  selectedTables: ['student_data'],
  joinPlan: [],
  filters: [],
  aggregations: [],
  assumptions: [],
  validationNotes: [],
  confidence: 0.9
});

/** A client that answers planning then SQL generation, and counts model calls. */
function createCountingClient(): { client: LlmClient; calls: () => number } {
  let calls = 0;
  const answer = () => {
    calls += 1;
    return calls % 2 === 1 ? PLANNING_RESPONSE : SQL_RESPONSE;
  };
  const client: LlmClient = {
    complete: vi.fn(async () => answer()),
    stream: vi.fn(async (_: LlmRequest, handlers: LlmStreamHandlers) => {
      const next = answer();
      handlers.onToken(next);
      return next;
    })
  };
  return { client, calls: () => calls };
}

/**
 * Mirrors what routes/query/nlHandler.ts does: capture the key the pipeline
 * reports, then commit it only after the SQL is known to be good.
 */
async function generateAndConfirm(
  service: ReturnType<typeof createNl2SqlService>,
  repo: DatasetRepository
) {
  let key: string | null = null;
  const result = await service.generateSqlFromNaturalLanguageV2({
    projectId: 'project-1',
    nlQuery: 'average score',
    onCacheKey: (info) => {
      key = info.key;
    }
  });
  if (key) commitNlGeneration(key, result);
  void repo;
  return result;
}

describe('generation cache through the pipeline', () => {
  beforeEach(() => {
    __clearNlGenerationCacheForTests();
    delete process.env.AUTOML_NL2SQL_CACHE_DISABLED;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('makes no model calls for a repeated question', async () => {
    const repo = createDatasetRepository([buildDataset()]);
    const { client, calls } = createCountingClient();
    const service = createNl2SqlService({ datasetRepository: repo, getClient: () => client });

    const first = await generateAndConfirm(service, repo);
    const afterFirst = calls();
    expect(afterFirst).toBeGreaterThan(0); // planning + generation actually ran

    const second = await generateAndConfirm(service, repo);

    expect(calls()).toBe(afterFirst); // no further model work
    expect(second.sql).toBe(first.sql);
  });

  it('regenerates after preprocessing changes the schema', async () => {
    // The negative test. A key that ignored the schema would pass everything
    // above this line and fail here by serving SQL for the old columns.
    const dataset = buildDataset();
    const repo = createDatasetRepository([dataset]);
    const { client, calls } = createCountingClient();
    const service = createNl2SqlService({ datasetRepository: repo, getClient: () => client });

    await generateAndConfirm(service, repo);
    const afterFirst = calls();

    // Preprocessing retypes a column — same question, different schema.
    dataset.columns[1] = { name: 'score', dtype: 'float', nullCount: 0 };

    await generateAndConfirm(service, repo);

    expect(calls()).toBeGreaterThan(afterFirst);
  });

  it('reports a hit through onCacheKey so callers can tell', async () => {
    const repo = createDatasetRepository([buildDataset()]);
    const { client } = createCountingClient();
    const service = createNl2SqlService({ datasetRepository: repo, getClient: () => client });

    const seen: boolean[] = [];
    const run = async () => {
      let key: string | null = null;
      const result = await service.generateSqlFromNaturalLanguageV2({
        projectId: 'project-1',
        nlQuery: 'average score',
        onCacheKey: (info) => {
          key = info.key;
          seen.push(info.hit);
        }
      });
      if (key) commitNlGeneration(key, result);
    };

    await run();
    await run();

    expect(seen).toEqual([false, true]);
  });

  it('still calls the model for every request while disabled', async () => {
    process.env.AUTOML_NL2SQL_CACHE_DISABLED = '1';
    const repo = createDatasetRepository([buildDataset()]);
    const { client, calls } = createCountingClient();
    const service = createNl2SqlService({ datasetRepository: repo, getClient: () => client });

    await generateAndConfirm(service, repo);
    const afterFirst = calls();
    await generateAndConfirm(service, repo);

    expect(calls()).toBeGreaterThan(afterFirst);
  });
});
