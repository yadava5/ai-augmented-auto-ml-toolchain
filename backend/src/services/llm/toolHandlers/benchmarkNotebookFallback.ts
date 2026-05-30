import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { env } from '../../../config.js';
import { createDatasetRepository } from '../../../repositories/datasetRepository.js';
import type { ExecutionResult } from '../../../types/execution.js';
import type { ToolCall } from '../../../types/llm.js';
import {
  CELL_EDITOR_AI,
  type Cell,
  type CellOutput,
  type CellSummary,
  type CellType,
  type EditCellResult,
  type Notebook
} from '../../../types/notebook.js';

interface BenchmarkNotebookState {
  notebook: Notebook;
  cells: Cell[];
  executionCounter: number;
}

const projectStates = new Map<string, BenchmarkNotebookState>();

export function isBenchmarkNotebookFallbackEnabled(): boolean {
  return env.benchmarkAuthBypass && env.llmProvider === 'mock';
}

function getOrCreateState(projectId: string): BenchmarkNotebookState {
  const existing = projectStates.get(projectId);
  if (existing) {
    return existing;
  }

  const now = new Date();
  const state: BenchmarkNotebookState = {
    notebook: {
      notebookId: randomUUID(),
      projectId,
      name: 'Benchmark Notebook',
      kind: 'phase',
      metadata: { benchmarkFallback: true },
      createdAt: now,
      updatedAt: now
    },
    cells: [],
    executionCounter: 0
  };
  projectStates.set(projectId, state);
  return state;
}

function requestedNotebookId(args: ToolCall['args']): string | undefined {
  return typeof args?.notebookId === 'string' && args.notebookId.trim()
    ? args.notebookId
    : undefined;
}

function resolveState(projectId: string, args: ToolCall['args']): BenchmarkNotebookState {
  const state = getOrCreateState(projectId);
  const notebookId = requestedNotebookId(args);
  if (notebookId && notebookId !== state.notebook.notebookId) {
    throw new Error(`Notebook ${notebookId} not found in project`);
  }
  return state;
}

function findCell(projectId: string, cellId: string): { state: BenchmarkNotebookState; cell: Cell } {
  const state = getOrCreateState(projectId);
  const cell = state.cells.find((candidate) => candidate.cellId === cellId);
  if (!cell) {
    throw new Error(`Cell ${cellId} not found`);
  }
  if (cell.notebookId !== state.notebook.notebookId) {
    throw new Error(`Cell ${cellId} belongs to a different project`);
  }
  return { state, cell };
}

function toCellSummary(cell: Cell): CellSummary {
  return {
    cellId: cell.cellId,
    cellType: cell.cellType,
    title: cell.title,
    position: cell.position,
    executionStatus: cell.executionStatus,
    executionCount: cell.executionCount,
    executionOrder: cell.executionOrder,
    isDirty: cell.isDirty,
    lockedBy: cell.lockedBy,
    contentPreview: cell.content.slice(0, 100)
  };
}

function normalizePositions(cells: Cell[]): void {
  cells.sort((left, right) => left.position - right.position);
  cells.forEach((cell, index) => {
    cell.position = index;
  });
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function withAiEditor(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...(metadata ?? {}), lastEditedBy: CELL_EDITOR_AI };
}

function deriveProcessedSiblingName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) {
    return filename.endsWith('_processed') ? filename : `${filename}_processed`;
  }

  const base = filename.slice(0, dot);
  if (base.endsWith('_processed')) {
    return filename;
  }
  return `${base}_processed${filename.slice(dot)}`;
}

function metadataDatasetId(metadata: Record<string, unknown> | undefined): string | undefined {
  const preprocessing = metadata?.preprocessing;
  if (!preprocessing || typeof preprocessing !== 'object' || Array.isArray(preprocessing)) {
    return undefined;
  }

  const datasetId = (preprocessing as Record<string, unknown>).datasetId;
  return typeof datasetId === 'string' && datasetId.trim() ? datasetId : undefined;
}

async function copyProcessedDatasetSibling(projectId: string, cell: Cell): Promise<void> {
  const datasetId = metadataDatasetId(cell.metadata);
  if (!datasetId) {
    return;
  }

  const datasetRepository = createDatasetRepository(env.datasetMetadataPath);
  const dataset = await datasetRepository.getById(datasetId);
  if (!dataset || dataset.projectId !== projectId) {
    throw new Error(`Dataset ${datasetId} not found in project context`);
  }

  const sourcePath = join(env.datasetStorageDir, dataset.datasetId, dataset.filename);
  const processedFilename = deriveProcessedSiblingName(dataset.filename);
  const projectDir = join(env.executionWorkspaceDir, projectId);
  const destinations = [
    join(projectDir, processedFilename),
    join(projectDir, 'datasets', processedFilename),
    join(projectDir, 'datasets', dataset.datasetId, processedFilename)
  ];

  for (const destination of destinations) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
  }
}

export async function listCells(projectId: string, args: ToolCall['args']) {
  const state = resolveState(projectId, args);
  return {
    notebookId: state.notebook.notebookId,
    cells: state.cells.map(toCellSummary)
  };
}

export async function readCell(projectId: string, args: ToolCall['args']) {
  const cellId = typeof args?.cellId === 'string' ? args.cellId : '';
  if (!cellId) {
    throw new Error('cellId is required');
  }
  return findCell(projectId, cellId).cell;
}

export async function writeCell(projectId: string, args: ToolCall['args']) {
  const content = typeof args?.content === 'string' ? args.content : '';
  if (!content) {
    throw new Error('content is required');
  }

  const state = resolveState(projectId, args);
  const cellId = typeof args?.cellId === 'string' ? args.cellId : undefined;
  const metadata = withAiEditor(parseMetadata(args?.metadata));
  const now = new Date();
  const existing = cellId ? state.cells.find((cell) => cell.cellId === cellId) : undefined;

  if (cellId && !existing) {
    throw new Error(`Cell not found: ${cellId}`);
  }

  if (existing) {
    existing.title = typeof args?.title === 'string' ? args.title : existing.title;
    existing.content = content;
    existing.cellType = (args?.cellType as CellType | undefined) ?? existing.cellType;
    existing.metadata = metadata;
    existing.isDirty = existing.cellType === 'code';
    existing.updatedAt = now;
    return existing;
  }

  const cell: Cell = {
    cellId: randomUUID(),
    notebookId: state.notebook.notebookId,
    cellType: (args?.cellType as CellType | undefined) ?? 'code',
    title: typeof args?.title === 'string' ? args.title : undefined,
    content,
    position: state.cells.length,
    metadata,
    executionCount: 0,
    executionOrder: null,
    executionStatus: 'idle',
    executionDurationMs: null,
    executedAt: null,
    isDirty: false,
    output: [],
    outputRefs: [],
    lockedBy: null,
    lockedAt: null,
    createdAt: now,
    updatedAt: now
  };
  state.cells.push(cell);
  return cell;
}

export async function editCell(projectId: string, args: ToolCall['args']): Promise<EditCellResult> {
  const cellId = typeof args?.cellId === 'string' ? args.cellId : '';
  if (!cellId) {
    throw new Error('cellId is required');
  }

  const startLine = typeof args?.startLine === 'number' ? args.startLine : 0;
  const endLine = typeof args?.endLine === 'number' ? args.endLine : 0;
  const newContentArg = typeof args?.newContent === 'string' ? args.newContent : '';
  if (startLine < 1 || endLine < 1) {
    throw new Error('startLine and endLine must be positive (1-indexed)');
  }
  if (startLine > endLine) {
    throw new Error('startLine must be <= endLine');
  }

  const { cell } = findCell(projectId, cellId);
  const oldContent = cell.content;
  const lines = oldContent.split('\n');
  const startIndex = startLine - 1;
  const endIndex = endLine - 1;
  if (endIndex >= lines.length) {
    throw new Error(`endLine ${endLine} exceeds file length ${lines.length}`);
  }

  const linesRemoved = lines.slice(startIndex, endIndex + 1);
  const linesAdded = newContentArg.split('\n');
  const newContent = [
    ...lines.slice(0, startIndex),
    ...linesAdded,
    ...lines.slice(endIndex + 1)
  ].join('\n');

  cell.content = newContent;
  cell.metadata = withAiEditor(parseMetadata(args?.metadata));
  cell.isDirty = cell.cellType === 'code';
  cell.updatedAt = new Date();

  return {
    cell,
    oldContent,
    newContent,
    diff: {
      linesRemoved,
      linesAdded
    }
  };
}

export async function runCell(projectId: string, args: ToolCall['args']): Promise<ExecutionResult> {
  const cellId = typeof args?.cellId === 'string' ? args.cellId : '';
  if (!cellId) {
    throw new Error('cellId is required');
  }

  const { state, cell } = findCell(projectId, cellId);
  if (cell.cellType !== 'code') {
    throw new Error(`Cannot execute ${cell.cellType} cell`);
  }

  const runMetadata = parseMetadata(args?.metadata);
  if (runMetadata && Object.keys(runMetadata).length > 0) {
    cell.metadata = { ...cell.metadata, ...runMetadata };
  }

  const start = Date.now();
  try {
    await copyProcessedDatasetSibling(projectId, cell);
    const executionMs = Date.now() - start;
    const executionOrder = state.executionCounter + 1;
    state.executionCounter = executionOrder;
    const outputs: CellOutput[] = [{ type: 'text', content: 'Execution succeeded' }];

    cell.executionStatus = 'success';
    cell.executionDurationMs = executionMs;
    cell.executionCount += 1;
    cell.executionOrder = executionOrder;
    cell.executedAt = new Date();
    cell.isDirty = false;
    cell.output = outputs;
    cell.outputRefs = [];
    cell.updatedAt = new Date();

    return {
      status: 'success',
      stdout: 'Execution succeeded',
      stderr: '',
      outputs,
      executionMs,
      executionOrder
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Execution failed';
    const executionMs = Date.now() - start;
    const outputs: CellOutput[] = [{ type: 'error', content: message }];
    const executionOrder = state.executionCounter + 1;
    state.executionCounter = executionOrder;

    cell.executionStatus = 'error';
    cell.executionDurationMs = executionMs;
    cell.executionCount += 1;
    cell.executionOrder = executionOrder;
    cell.executedAt = new Date();
    cell.isDirty = false;
    cell.output = outputs;
    cell.outputRefs = [];
    cell.updatedAt = new Date();

    return {
      status: 'error',
      stdout: '',
      stderr: message,
      outputs,
      executionMs,
      error: message,
      executionOrder
    };
  }
}

export async function deleteCell(projectId: string, args: ToolCall['args']) {
  const cellId = typeof args?.cellId === 'string' ? args.cellId : '';
  if (!cellId) {
    throw new Error('cellId is required');
  }

  const { state } = findCell(projectId, cellId);
  state.cells = state.cells.filter((cell) => cell.cellId !== cellId);
  normalizePositions(state.cells);
  return { success: true, cellId };
}

export async function reorderCells(projectId: string, args: ToolCall['args']) {
  const cellIds = Array.isArray(args?.cellIds) ? args.cellIds : [];
  if (cellIds.length === 0) {
    throw new Error('cellIds array is required');
  }

  const state = resolveState(projectId, args);
  const byId = new Map(state.cells.map((cell) => [cell.cellId, cell]));
  for (const id of cellIds) {
    if (typeof id !== 'string') {
      throw new Error('All cellIds must be strings');
    }
    if (!byId.has(id)) {
      throw new Error(`Cell ${id} not found in notebook`);
    }
  }

  state.cells = (cellIds as string[]).map((id) => byId.get(id)!);
  normalizePositions(state.cells);
  return { success: true };
}

export async function insertCell(projectId: string, args: ToolCall['args']) {
  const content = typeof args?.content === 'string' ? args.content : '';
  if (!content) {
    throw new Error('content is required');
  }

  const state = resolveState(projectId, args);
  const position = typeof args?.position === 'number' ? args.position : 0;
  const now = new Date();
  const cell: Cell = {
    cellId: randomUUID(),
    notebookId: state.notebook.notebookId,
    cellType: (args?.cellType as CellType | undefined) ?? 'code',
    title: typeof args?.title === 'string' ? args.title : undefined,
    content,
    position,
    metadata: withAiEditor(parseMetadata(args?.metadata)),
    executionCount: 0,
    executionOrder: null,
    executionStatus: 'idle',
    executionDurationMs: null,
    executedAt: null,
    isDirty: false,
    output: [],
    outputRefs: [],
    lockedBy: null,
    lockedAt: null,
    createdAt: now,
    updatedAt: now
  };

  state.cells.forEach((existing) => {
    if (existing.position >= position) {
      existing.position += 1;
    }
  });
  state.cells.push(cell);
  normalizePositions(state.cells);
  return cell;
}
