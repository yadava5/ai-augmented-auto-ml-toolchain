import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../../config.js';
import { createDatasetRepository } from '../../../repositories/datasetRepository.js';

import { runCell, writeCell } from './cellHandlers.js';

describe('cell tool benchmark fallback', () => {
  const originalEnv = {
    benchmarkAuthBypass: env.benchmarkAuthBypass,
    databaseUrl: env.databaseUrl,
    datasetMetadataPath: env.datasetMetadataPath,
    datasetStorageDir: env.datasetStorageDir,
    executionWorkspaceDir: env.executionWorkspaceDir,
    llmProvider: env.llmProvider,
  };

  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'automl-cell-fallback-'));
    env.benchmarkAuthBypass = true;
    env.databaseUrl = undefined;
    env.datasetMetadataPath = join(tempRoot, 'datasets', 'metadata.json');
    env.datasetStorageDir = join(tempRoot, 'datasets', 'files');
    env.executionWorkspaceDir = join(tempRoot, 'workspaces');
    env.llmProvider = 'mock';
  });

  afterEach(() => {
    env.benchmarkAuthBypass = originalEnv.benchmarkAuthBypass;
    env.databaseUrl = originalEnv.databaseUrl;
    env.datasetMetadataPath = originalEnv.datasetMetadataPath;
    env.datasetStorageDir = originalEnv.datasetStorageDir;
    env.executionWorkspaceDir = originalEnv.executionWorkspaceDir;
    env.llmProvider = originalEnv.llmProvider;
  });

  it('writes and runs a benchmark preprocessing cell without database configuration', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const datasetRepository = createDatasetRepository(env.datasetMetadataPath);
    const dataset = await datasetRepository.create({
      projectId,
      filename: 'customers.csv',
      fileType: 'csv',
      size: 22,
      profile: {
        nRows: 2,
        columns: [],
        sample: []
      }
    });

    const sourceDir = join(env.datasetStorageDir, dataset.datasetId);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, dataset.filename), 'id,name\n1,Ada\n2,Lin\n', 'utf8');

    const cell = await writeCell(projectId, {
      title: 'Benchmark checkpoint',
      content: 'df = df.copy()',
      metadata: {
        preprocessing: {
          datasetId: dataset.datasetId,
          dataframeName: 'df'
        }
      }
    });

    const result = await runCell(projectId, { cellId: cell.cellId });

    expect(result.status).toBe('success');
    await expect(
      readFile(join(env.executionWorkspaceDir, projectId, 'datasets', dataset.datasetId, 'customers_processed.csv'), 'utf8')
    ).resolves.toContain('Ada');
  });
});
