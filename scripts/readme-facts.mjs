#!/usr/bin/env node
/**
 * Verify — and repair — every number the README asserts.
 *
 * WHY THIS EXISTS
 *
 * A prose document has no mechanism that makes a stale number *fail*. Hand-
 * maintained figures drift, always, and they drift silently, which is the part
 * that matters — a README whose numbers are quietly wrong is worse than one
 * with no numbers, because it spends credibility it no longer has.
 *
 * This README is unusually exposed to that, because it leans on counts as
 * evidence: 44 tool definitions, 12 of them over MCP, nine tool arrays, four
 * loop caps, 24 migrations. Every one of those is a claim about code that
 * somebody will change without reading this file.
 *
 * So the numbers stop being prose and become assertions.
 *
 * THE DESIGN, AND WHY IT IS NOT MARKERS
 *
 * The obvious approach is to fence each number in an HTML comment and
 * regenerate it. That fails here for two reasons: several counts live inside
 * mermaid diagrams, where an HTML comment is a syntax error, and markers make
 * the source unreadable at exactly the density this README uses them.
 *
 * Instead each fact declares the SITES where it is asserted, as regexes that
 * capture the digits. The checker recomputes the fact and compares.
 *
 * The load-bearing rule is this:
 *
 *     A SITE REGEX THAT MATCHES ZERO TIMES IS A FAILURE.
 *
 * Not a skip. A failure. That is the whole point. If a claim is reworded so its
 * regex no longer matches, the fact has escaped its check and the file has
 * silently stopped being verified. A checker that quietly passes when it can no
 * longer find what it was checking is not a checker.
 *
 * COUNT AT THE DEFINITION SITE
 *
 * `toolDefinitions` is counted from the `name:` keys in the seven group files
 * under `services/llm/tools/`, which is where a tool is DEFINED. It is not
 * counted from `tools/index.ts`, where the same definition is re-exported nine
 * times over into nine differently-filtered arrays — counting there would give
 * a number several times too large and would move whenever a stage's tool list
 * changed.
 *
 * `mcpTools` is the deliberate exception, and it is not an inconsistency. The
 * claim is "twelve of those are additionally *registered* over MCP", so the
 * registration call IS the definition of that claim, and it is counted at
 * `server.registerTool(` in `mcpServer.ts`. The two numbers mean different
 * things and the README is careful to keep them apart; so is this file.
 *
 * TWO CLASSES OF FACT
 *
 *   static   — recomputable from source, cheaply, with no build, no database
 *              and no network. Recomputed on every run.
 *
 *   recorded — require executing something. Read from docs/readme-facts.json,
 *              which carries the value, the command that produced it and the
 *              date it was taken.
 *
 * EVERY FACT IN THIS REPOSITORY IS STATIC, AND THAT IS DELIBERATE.
 *
 * The README's Testing section states its own rule: "the pass counts are not
 * stated here because this pass did not execute them, and the standing rule in
 * this repository is that a number without a command that regenerates it gets
 * deleted rather than softened." It then publishes only file and fixture
 * counts, which are static. So there is nothing recorded to assert.
 *
 * `--record` still exists and still runs the Vitest suites. It writes the
 * counts and the pass/fail/skip outcome into the artifact so that the numbers
 * are *available* with provenance if the README ever wants them — and so that
 * a green artifact can never be mistaken for a green suite, because `--record`
 * keeps the counts from a red run on purpose. Nothing in `--check` reads them.
 * A missing artifact is therefore not an error here; it becomes one the moment
 * a `recorded` fact is added below.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 *
 *   - Dependency version numbers in the Tech Stack tables (React 19.1, Vite
 *     7.3, pandas 2.2.2, and about twenty more). They are real claims and they
 *     do drift; they are also one lockfile read each and would triple the size
 *     of this file for the least interesting numbers on the page. Named here so
 *     the omission is a decision rather than an oversight.
 *   - `sed -n '21,60p' .../dockerBuilder.ts` and "one 40-line function", in the
 *     Verify-it block and the bullet above it. Both were exact at the commit
 *     this README was written on. Both are LINE-RANGE claims, which is a claim
 *     form that goes stale on any edit above or inside the function — an
 *     uncommitted change already invalidated them while this checker was being
 *     written. Pinning them here would encode a transient working-tree state
 *     into the README. The durable fix is to reword the claim as a grep, which
 *     is a prose change, not a checker change.
 *
 * USAGE
 *   node scripts/readme-facts.mjs            # --check: verify, exit 1 on drift
 *   node scripts/readme-facts.mjs --write    # rewrite the numbers in place
 *   node scripts/readme-facts.mjs --record   # run the suites, refresh the artifact
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(REPO, 'docs', 'readme-facts.json');

/* ── helpers ─────────────────────────────────────────────────────────── */

const read = (p) => readFileSync(join(REPO, p), 'utf8');

const countIn = (path, re) => (read(path).match(re) || []).length;

/** Files directly under `dir` matching `test`. */
const filesIn = (dir, test) =>
  existsSync(join(REPO, dir)) ? readdirSync(join(REPO, dir)).filter(test) : [];

/**
 * The text of a `const NAME<...> = [ ... ];` array literal.
 *
 * Scoped extraction rather than a whole-file grep: `stageConfig.ts` contains a
 * STAGE_TOOLS map, a text-stage Set and a deterministic-stage Set alongside the
 * lifecycle array, and a file-wide count would silently mix them.
 */
function arrayLiteral(path, name) {
  const src = read(path);
  const start = src.search(new RegExp(`^(?:export )?const ${name}\\b[^=]*=\\s*\\[`, 'm'));
  if (start === -1) throw new Error(`${path}: no \`const ${name} = [\` declaration`);
  /* Seek past the `=` first. These declarations are annotated
     `const X: LifecycleStageDefinition[] = [...]`, and taking the first `[`
     after the name lands on the empty pair inside the TYPE, which closes
     immediately and yields a count of zero — a silent zero, which is the worst
     possible answer for a checker to produce. */
  const open = src.indexOf('[', src.indexOf('=', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`${path}: the ${name} array literal is not closed`);
}

const countInArray = (path, name, re) => (arrayLiteral(path, name).match(re) || []).length;

/** The union members of `export type Name = 'a' | 'b' | ...;`. */
function unionMembers(path, name) {
  const m = read(path).match(new RegExp(`export type ${name}\\s*=([^;]*);`));
  if (!m) throw new Error(`${path}: no \`export type ${name} = ...;\``);
  return (m[1].match(/'[a-z0-9_-]+'/gi) || []).length;
}

/** The members of `export const Name = z.enum([...])`. */
function zodEnumMembers(path, name) {
  const m = read(path).match(new RegExp(`export const ${name}\\s*=\\s*z\\.enum\\(\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${path}: no \`export const ${name} = z.enum([...])\``);
  return (m[1].match(/'[a-z0-9_]+'/gi) || []).length;
}

/** A single numeric capture, required to be unambiguous. */
function theNumber(path, re, what) {
  const hits = [...new Set([...read(path).matchAll(re)].map((m) => m[1]))];
  if (hits.length === 0) throw new Error(`${path}: could not find ${what}`);
  if (hits.length > 1) throw new Error(`${path}: ${what} has disagreeing values ${hits.join(', ')}`);
  return Number(hits[0]);
}

/**
 * `git ls-files` with the exact pathspecs the README publishes.
 *
 * The README documents these commands verbatim as the way to reproduce the
 * counts, so the checker uses the same semantics rather than walking the disk.
 * Tracked-file semantics also mean a scratch file dropped into a test directory
 * cannot silently move a published number.
 */
function lsFiles(...pathspecs) {
  const args = pathspecs.map((p) => `'${p}'`).join(' ');
  const out = execSync(`git ls-files ${args}`, { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).length;
}

const jsonLength = (p) => JSON.parse(read(p)).length;

const TOOLS_DIR = 'backend/src/services/llm/tools';
const TOOL_DEF = /^ +name: '[a-z_]+',/gm;
const GRAPH_STATE = 'backend/src/services/workflows/graphState.ts';
const CONFIG = 'backend/src/config.ts';
const DOCKER_BUILDER = 'backend/src/services/container/dockerBuilder.ts';
const PREPROCESSING_RUNTIME = 'backend/src/services/llm/langgraph/preprocessingRuntime.ts';
const STAGE_CONFIG = 'backend/src/services/workflows/phases/preprocessing/stageConfig.ts';
const FEATURE_PHASE = 'backend/src/services/workflows/phases/featureEngineering.ts';
const TRAINING_PHASE = 'backend/src/services/workflows/phases/training.ts';

const toolFiles = () => filesIn(TOOLS_DIR, (n) => n.endsWith('.ts'));
const perToolFile = () =>
  toolFiles().map((n) => [n, countIn(`${TOOLS_DIR}/${n}`, TOOL_DEF)]);
const toolDefinitions = () => perToolFile().reduce((a, [, n]) => a + n, 0);
/** Group files are files that DEFINE at least one tool: index.ts defines none. */
const toolGroupFiles = () => perToolFile().filter(([, n]) => n > 0).length;

const configDefault = (key) =>
  theNumber(CONFIG, new RegExp(`${key}:\\s*parseInteger\\([^,]+,\\s*(\\d+)\\)`, 'g'), `the ${key} default`);

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];
const toWord = (n) => WORDS[n] ?? String(n);
const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const stripCommas = (s) => s.replace(/,/g, '');

/* ── the facts ───────────────────────────────────────────────────────── */

/**
 * `sites` regexes MUST contain exactly one capture group, around the number.
 *
 * A site may be a bare RegExp (checked against README.md) or an object:
 *   { re, file }  — check some other file instead
 *   { re, word }  — the number is spelled out in English ("seven", "Twelve")
 *
 * Word sites are compared case-insensitively and rewritten preserving case,
 * because this README opens sentences with them: "Twelve of those are
 * additionally exposed…", "Four of those seven are driven…".
 */
const FACTS = {
  /* ── the tool surface ── */
  toolDefinitions: {
    kind: 'static',
    describe: `tool definitions declared in ${TOOLS_DIR}/*.ts`,
    compute: toolDefinitions,
    sites: [
      /\*\*(\d+) tool definitions\*\* declared across/g,
      /tools\/ — (\d+) definitions, \d+ group files/g,
      /filtered view of the same (\d+) definitions/g,
      /All (\d+) tool definitions and their handlers/g,
      /tools\/ +(\d+) tool definitions across \d+ group files/g,
      /# (\d+) tool definitions, at the definition site/g,
      /tools\/\*\.ts \| wc -l +# (\d+)/g,
    ],
  },
  toolGroupFiles: {
    kind: 'static',
    describe: `files under ${TOOLS_DIR}/ that define at least one tool`,
    compute: toolGroupFiles,
    sites: [
      { re: /declared across (\w+) group files/g, word: true },
      /tools\/ — \d+ definitions, (\d+) group files/g,
      /tools\/ +\d+ tool definitions across (\d+) group files/g,
    ],
  },
  mcpTools: {
    /* Registration is the claim. See the header note. */
    kind: 'static',
    describe: 'server.registerTool(...) calls in services/mcp/mcpServer.ts',
    compute: () => countIn('backend/src/services/mcp/mcpServer.ts', /server\.registerTool\(/g),
    sites: [
      { re: /(\w+) of those are additionally exposed over the Model Context Protocol/g, word: true },
      /<br\/>(\d+) registered tools/g,
      /MCP server exposing (\d+) of the tools/g,
      /# (\d+) of them registered over MCP/g,
      /mcpServer\.ts +# (\d+)/g,
      /* The same count, asserted in the printed booklet and in the diagram
         that draws it. A number repeated in a second file is a number that
         gets corrected in one file and not the other — and these two are the
         furthest from anyone who would think to update them. */
      { re: /MCP registry: (\d+) tools/g, file: 'booklet/src/content.ts' },
      { re: /the (\d+) registered tools laid out in/g, file: 'booklet/src/diagrams/MCPToolRegistry.tsx' },
    ],
  },
  toolArrays: {
    kind: 'static',
    describe: 'LlmToolDefinition[] arrays exported from tools/index.ts',
    compute: () => countIn(`${TOOLS_DIR}/index.ts`, /^export const LLM_[A-Z_]+: LlmToolDefinition\[\]/gm),
    sites: [
      { re: /exports (\w+) different tool arrays/g, word: true },
      { re: /(\w+) near-duplicate arrays/g, word: true },
      { re: /costs (\w+) hand-maintained tool arrays/g, word: true },
    ],
  },
  discoveryTools: {
    kind: 'static',
    describe: 'tools pulled from LLM_TOOL_DEFINITIONS into LLM_ONBOARDING_TOOLS',
    compute: () => countInArray(`${TOOLS_DIR}/index.ts`, 'LLM_ONBOARDING_TOOLS', /LLM_TOOL_DEFINITIONS\.find\(/g),
    sites: [{ re: /the (\w+) discovery tools plus/g, word: true }],
  },

  /* ── phases and lifecycles ── */
  uiPhases: {
    kind: 'static',
    describe: 'members of the Phase union in frontend/src/types/phase.ts',
    compute: () => unionMembers('frontend/src/types/phase.ts', 'Phase'),
    sites: [
      { re: /walk through (\w+) workspace phases/g, word: true },
      { re: /exposes \*\*(\w+) phases\*\*/g, word: true },
      { re: /of those (\w+) are driven by the LangGraph agent/g, word: true },
      { re: /phase\.ts +the (\w+) workspace phases/g, word: true },
      /phase\.ts +# (\d+)/g,
      { re: /workflow has (\w+) phases/g, word: true, file: 'video/docs/CAPTURE.md' },
    ],
  },
  workflowPhases: {
    kind: 'static',
    describe: 'members of WorkflowPhaseSchema in frontend/src/types/workflow.ts',
    compute: () => zodEnumMembers('frontend/src/types/workflow.ts', 'WorkflowPhaseSchema'),
    sites: [
      { re: /In the (\w+) that are agent-driven/g, word: true },
      { re: /(\w+) of those \w+ are driven by the LangGraph agent/g, word: true },
      { re: /enumerates exactly (\w+) workflow phases/g, word: true },
      { re: /the (\w+) phase implementations/g, word: true },
      { re: /workflow\.ts +the (\w+) LangGraph workflow phases/g, word: true },
      /workflow\.ts +# (\d+)/g,
    ],
  },
  preprocessingStages: {
    kind: 'static',
    describe: 'stages in PREPROCESSING_LIFECYCLE (phases/preprocessing/stageConfig.ts)',
    compute: () => countInArray(STAGE_CONFIG, 'PREPROCESSING_LIFECYCLE', /\{ name: '/g),
    sites: [{ re: /Preprocessing's (\w+) stages/g, word: true }],
  },
  lifecycleStages: {
    kind: 'static',
    describe: 'stages in FEATURE_ENGINEERING_LIFECYCLE (phases/featureEngineering.ts)',
    compute: () => countInArray(FEATURE_PHASE, 'FEATURE_ENGINEERING_LIFECYCLE', /\{ name: '/g),
    sites: [{ re: /share a parallel (\w+)-stage shape/g, word: true }],
  },

  /* ── the loop caps ── */
  loopCaps: {
    kind: 'static',
    describe: 'MAX_* caps exported from workflows/graphState.ts',
    compute: () => countIn(GRAPH_STATE, /^export const MAX_/gm),
    sites: [
      { re: /(\w+) separate loop caps guard the graph/g, word: true },
      { re: /The (\w+) loop caps\./g, word: true },
      { re: /and the (\w+) loop caps\./g, word: true },
    ],
  },
  maxWorkflowIterations: {
    kind: 'static',
    describe: 'MAX_WORKFLOW_ITERATIONS in graphState.ts',
    compute: () => theNumber(GRAPH_STATE, /MAX_WORKFLOW_ITERATIONS = (\d+)/g, 'MAX_WORKFLOW_ITERATIONS'),
    sites: [/— (\d+) iterations, \d+ calls of any one tool/g],
  },
  maxSingleToolCalls: {
    kind: 'static',
    describe: 'MAX_SINGLE_TOOL_CALLS in graphState.ts',
    compute: () => theNumber(GRAPH_STATE, /MAX_SINGLE_TOOL_CALLS = (\d+)/g, 'MAX_SINGLE_TOOL_CALLS'),
    sites: [/(\d+) calls of any one tool/g],
  },
  maxIdenticalToolCalls: {
    kind: 'static',
    describe: 'MAX_IDENTICAL_TOOL_CALLS in graphState.ts',
    compute: () => theNumber(GRAPH_STATE, /MAX_IDENTICAL_TOOL_CALLS = (\d+)/g, 'MAX_IDENTICAL_TOOL_CALLS'),
    sites: [/(\d+) identical calls/g],
  },
  maxStageHops: {
    kind: 'static',
    describe: 'MAX_STAGE_HOPS_WITHOUT_TOOL in graphState.ts',
    compute: () => theNumber(GRAPH_STATE, /MAX_STAGE_HOPS_WITHOUT_TOOL = (\d+)/g, 'MAX_STAGE_HOPS_WITHOUT_TOOL'),
    sites: [/(\d+) stage hops without a tool call/g],
  },
  maxAutoRepair: {
    kind: 'static',
    describe: 'maxAutoRepairAttempts in llm/langgraph/preprocessingRuntime.ts',
    compute: () => theNumber(PREPROCESSING_RUNTIME, /maxAutoRepairAttempts:\s*(\d+)[,\s]/g, 'maxAutoRepairAttempts'),
    sites: [
      /at most \*\*(\d+) times\*\*/g,
      /failed, under (\d+) repairs/g,
      /maxAutoRepairAttempts: (\d+)"/g,
    ],
  },

  /* ── the sandbox ── */
  tmpfsMounts: {
    kind: 'static',
    describe: '--tmpfs flags in container/dockerBuilder.ts',
    compute: () => countIn(DOCKER_BUILDER, /'--tmpfs'/g),
    sites: [
      { re: /(\w+) `nosuid` tmpfs mounts/g, word: true },
      /(\d+) × `--tmpfs`/g,
    ],
  },
  tmpfsHomeMounts: {
    kind: 'static',
    describe: '--tmpfs flags other than /tmp',
    compute: () => countIn(DOCKER_BUILDER, /'--tmpfs'/g) - 1,
    sites: [{ re: /`\/tmp` \d+ MB, (\w+) smaller home dirs/g, word: true }],
  },
  tmpfsTmpMb: {
    kind: 'static',
    describe: 'the executionTmpfsMb default in config.ts',
    compute: () => configDefault('executionTmpfsMb'),
    sites: [/`\/tmp` (\d+) MB, \w+ smaller home dirs/g],
  },
  memoryMb: {
    kind: 'static',
    describe: 'the executionMaxMemoryMb default in config.ts',
    compute: () => configDefault('executionMaxMemoryMb'),
    sites: [
      /(\d+) MB \(`EXECUTION_MAX_MEMORY_MB`\)/g,
      /EXECUTION_MAX_MEMORY_MB=(\d+)/g,
    ],
  },
  memoryGb: {
    kind: 'static',
    describe: 'the executionMaxMemoryMb default in GB',
    compute: () => configDefault('executionMaxMemoryMb') / 1024,
    sites: [
      /(\d+) GB memory cap/g,
      /workspace holds (\d+) GB of memory/g,
      { re: /Docker: (\d+)GB RAM/g, file: 'booklet/src/content.ts' },
    ],
  },
  cpuPercent: {
    kind: 'static',
    describe: 'the executionMaxCpuPercent default in config.ts',
    compute: () => configDefault('executionMaxCpuPercent'),
    sites: [
      /EXECUTION_MAX_CPU_PERCENT=(\d+)/g,
      /`EXECUTION_MAX_CPU_PERCENT`, divided by (\d+)\)/g,
    ],
  },
  cpuLimit: {
    kind: 'static',
    describe: 'the --cpus value: executionMaxCpuPercent / 100',
    compute: () => configDefault('executionMaxCpuPercent') / 100,
    sites: [
      /\| ([\d.]+) \(`EXECUTION_MAX_CPU_PERCENT`/g,
      /GB memory cap, ([\d.]+) CPU/g,
      { re: /GB RAM · ([\d.]+) CPU/g, file: 'booklet/src/content.ts' },
    ],
  },
  executionTimeoutMs: {
    kind: 'static',
    describe: 'the executionTimeoutMs default in config.ts',
    compute: () => configDefault('executionTimeoutMs'),
    sites: [
      /`EXECUTION_TIMEOUT_MS`, (\d+) ms/g,
      /EXECUTION_TIMEOUT_MS=(\d+)/g,
    ],
  },

  /* ── persistence and retrieval ── */
  migrations: {
    kind: 'static',
    describe: 'SQL files in backend/migrations/',
    compute: () => filesIn('backend/migrations', (n) => n.endsWith('.sql')).length,
    sites: [
      /across \*\*(\d+) migrations\*\*/g,
      /migrations\/ +(\d+) SQL migrations/g,
    ],
  },
  embeddingDimension: {
    kind: 'static',
    describe: 'EMBEDDING_DIMENSION in services/embeddingService.ts',
    compute: () =>
      theNumber('backend/src/services/embeddingService.ts', /export const EMBEDDING_DIMENSION = (\d+)/g, 'EMBEDDING_DIMENSION'),
    sites: [/text-embedding-3-small` \((\d+) dimensions\)/g],
  },
  nlToSqlPhases: {
    kind: 'static',
    describe: 'distinct phaseId values in nlToSql/pipeline.ts',
    compute: () =>
      new Set([...read('backend/src/services/nlToSql/pipeline.ts').matchAll(/phaseId: '([a-z_]+)'/g)].map((m) => m[1])).size,
    sites: [
      { re: /runs (\w+) named phases/g, word: true },
      { re: /The (\w+)-phase NL→SQL pipeline/g, word: true },
      /nlToSql\/ +(\d+)-phase pipeline/g,
    ],
  },
  errorTreeDepth: {
    kind: 'static',
    describe: 'the DecisionTreeClassifier max_depth in errorAttributionService.ts',
    compute: () =>
      theNumber('backend/src/services/errorAttributionService.ts', /DecisionTreeClassifier\(max_depth=(\d+)/g, 'the error-tree max_depth'),
    sites: [/DecisionTreeClassifier\(max_depth=(\d+)\)/g],
  },

  /* ── the repository itself ── */
  backendTestFiles: {
    kind: 'static',
    describe: "git ls-files 'backend/**/*.test.ts'",
    compute: () => lsFiles('backend/**/*.test.ts'),
    sites: [
      /\| Backend test files \| (\d+) \|/g,
      /'backend\/\*\*\/\*\.test\.ts' \| wc -l +# (\d+)/g,
    ],
  },
  frontendTestFiles: {
    kind: 'static',
    describe: "git ls-files 'frontend/**/*.test.ts' 'frontend/**/*.test.tsx'",
    compute: () => lsFiles('frontend/**/*.test.ts', 'frontend/**/*.test.tsx'),
    sites: [
      /\| Frontend test files \| (\d+) \|/g,
      /'frontend\/\*\*\/\*\.test\.tsx' \| wc -l +# (\d+)/g,
    ],
  },
  landingTestFiles: {
    kind: 'static',
    describe: "git ls-files 'landing/**/*.test.ts*'",
    compute: () => lsFiles('landing/**/*.test.ts*'),
    sites: [/\| Landing test files \| (\d+) \|/g],
  },
  playwrightSpecs: {
    kind: 'static',
    describe: "git ls-files 'testing/tests/*.spec.ts'",
    compute: () => lsFiles('testing/tests/*.spec.ts'),
    sites: [
      /\| Playwright specs \| (\d+) \|/g,
      /'testing\/tests\/\*\.spec\.ts' \| wc -l +# (\d+)/g,
    ],
  },
  nl2sqlEvalCases: {
    kind: 'static',
    describe: 'cases in testing/fixtures/nl2sql_eval.json',
    compute: () => jsonLength('testing/fixtures/nl2sql_eval.json'),
    sites: [
      /\| NL→SQL eval cases \*\*defined\*\* \| (\d+) \|/g,
      /both are small: (\d+) and \d+ cases/g,
    ],
  },
  ragEvalCases: {
    kind: 'static',
    describe: 'cases in testing/fixtures/rag_eval.json',
    compute: () => jsonLength('testing/fixtures/rag_eval.json'),
    sites: [
      /\| RAG eval cases \*\*defined\*\* \| (\d+) \|/g,
      /both are small: \d+ and (\d+) cases/g,
      /rag_eval\.json'\)+" +# (\d+)/g,
    ],
  },
  securityWorkflows: {
    kind: 'static',
    describe: 'workflow files in .github/workflows/ other than ci.yml',
    compute: () =>
      filesIn('.github/workflows', (n) => /\.ya?ml$/.test(n) && n !== 'ci.yml').length,
    sites: [{ re: /(\w+) other workflows do run/g, word: true }],
  },
  nodeMajor: {
    kind: 'static',
    describe: 'the major version pinned in .node-version',
    compute: () => Number(read('.node-version').trim().split('.')[0]),
    sites: [
      /node-(\d+)-brightgreen/g,
      /\*\*Runtime\*\* \| Node\.js (\d+),/g,
      /Node\.js (\d+) \(`\.node-version`\)/g,
    ],
  },
  licenseLines: {
    kind: 'static',
    describe: 'lines in LICENSE',
    compute: () => read('LICENSE').replace(/\n$/, '').split('\n').length,
    sites: [/verbatim (\d+)-line GPL-3\.0 text/g],
  },
};

/**
 * Cross-fact invariants. Sums and identities that must hold arithmetically, so
 * a number cannot go stale without another one noticing.
 */
const INVARIANTS = [
  {
    name: 'the per-group-file tool counts sum to the stated total',
    holds: (f) => perToolFile().reduce((a, [, n]) => a + n, 0) === f.toolDefinitions,
    explain: (f) =>
      `${perToolFile().map(([n, c]) => `${n}=${c}`).join(' ')} sums to ` +
      `${perToolFile().reduce((a, [, n]) => a + n, 0)}, not ${f.toolDefinitions}.`,
  },
  {
    name: 'every group file defines at least one tool, and index.ts defines none',
    holds: (f) =>
      f.toolGroupFiles === toolFiles().length - 1 &&
      countIn(`${TOOLS_DIR}/index.ts`, TOOL_DEF) === 0,
    explain: (f) =>
      `${TOOLS_DIR}/ holds ${toolFiles().length} .ts files of which ${f.toolGroupFiles} define ` +
      `a tool, and index.ts defines ${countIn(`${TOOLS_DIR}/index.ts`, TOOL_DEF)}. The README's ` +
      `"seven group files" counts definers, not directory entries — a new group file or a tool ` +
      `defined inline in index.ts breaks that reading.`,
  },
  {
    name: 'MCP exposes a subset of the defined tools',
    holds: (f) => f.mcpTools <= f.toolDefinitions,
    explain: (f) =>
      `${f.mcpTools} tools are registered over MCP but only ${f.toolDefinitions} are defined. ` +
      `One of the two counts is being read from the wrong place.`,
  },
  {
    name: 'the LangGraph workflow phases are a subset of the UI phases',
    holds: (f) => f.workflowPhases < f.uiPhases,
    explain: (f) =>
      `${f.workflowPhases} workflow phases vs ${f.uiPhases} UI phases. The README's "four of ` +
      `those seven are driven by the agent" no longer describes the split.`,
  },
  {
    name: 'feature engineering and training share one lifecycle shape',
    holds: (f) =>
      countInArray(TRAINING_PHASE, 'TRAINING_LIFECYCLE', /\{ name: '/g) === f.lifecycleStages,
    explain: (f) =>
      `TRAINING_LIFECYCLE has ${countInArray(TRAINING_PHASE, 'TRAINING_LIFECYCLE', /\{ name: '/g)} ` +
      `stages, FEATURE_ENGINEERING_LIFECYCLE has ${f.lifecycleStages}. The README says they are ` +
      `parallel; they are not.`,
  },
  {
    name: 'the four loop caps are the four MAX_ constants the README names',
    holds: (f) =>
      f.loopCaps === 4 &&
      [f.maxWorkflowIterations, f.maxSingleToolCalls, f.maxIdenticalToolCalls, f.maxStageHops]
        .every((v) => Number.isInteger(v) && v > 0),
    explain: (f) =>
      `graphState.ts exports ${f.loopCaps} MAX_ constants; the README names four and quotes ` +
      `${f.maxWorkflowIterations}/${f.maxSingleToolCalls}/${f.maxIdenticalToolCalls}/${f.maxStageHops}. ` +
      `A fifth cap is unmentioned, or one was removed.`,
  },
  {
    name: 'the tmpfs mounts are /tmp plus the smaller home dirs',
    holds: (f) => f.tmpfsHomeMounts === f.tmpfsMounts - 1,
    explain: (f) => `${f.tmpfsHomeMounts} != ${f.tmpfsMounts} - 1`,
  },
  {
    name: 'the --cpus value is the percent divided by 100',
    holds: (f) => Math.abs(f.cpuLimit - f.cpuPercent / 100) < 1e-9,
    explain: (f) => `${f.cpuPercent} / 100 = ${f.cpuPercent / 100}, not ${f.cpuLimit}.`,
  },
  {
    name: 'the memory cap in GB is the MB default over 1024',
    holds: (f) => Math.abs(f.memoryGb - f.memoryMb / 1024) < 1e-9,
    explain: (f) => `${f.memoryMb} MB / 1024 = ${f.memoryMb / 1024} GB, not ${f.memoryGb}.`,
  },
  {
    name: 'the sandbox still sets none of the flags the README says it does not',
    /* The README's "what is not enforced" paragraph is a claim about ABSENCE,
       and absence is the one kind of claim that silently becomes false when
       somebody does the right thing. If a hardening flag lands, the honest
       paragraph turns into a false modesty — so it fails here. Scoped to
       backend/ and deploy/, because this README names the flags it does not
       use and would otherwise match itself. */
    holds: () =>
      ['pids-limit', 'cap-drop', 'no-new-privileges', 'seccomp'].every((flag) => {
        const out = execSync(`git grep -c "${flag}" -- backend deploy || true`, {
          cwd: REPO,
          encoding: 'utf8',
        });
        return out.trim() === '';
      }),
    explain: () => {
      const found = ['pids-limit', 'cap-drop', 'no-new-privileges', 'seccomp'].filter((flag) =>
        execSync(`git grep -c "${flag}" -- backend deploy || true`, { cwd: REPO, encoding: 'utf8' }).trim()
      );
      return (
        `the sandbox now sets ${found.join(', ')} somewhere under backend/ or deploy/, but the ` +
        `Sandboxing section still says "there is no --pids-limit, no --cap-drop, no ` +
        `--security-opt no-new-privileges and no custom seccomp profile anywhere in the ` +
        `repository". Update the prose — this is good news that the README is denying.`
      );
    },
  },
];

/* ── resolve ─────────────────────────────────────────────────────────── */

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

function loadArtifact() {
  /* Absent by design when nothing is recorded — see the header note. */
  if (!existsSync(ARTIFACT)) return null;
  return JSON.parse(readFileSync(ARTIFACT, 'utf8'));
}

function resolveFacts() {
  const artifact = loadArtifact();
  const needsArtifact = Object.values(FACTS).some((f) => f.kind === 'recorded');
  if (needsArtifact && !artifact)
    fail(
      `${relative(REPO, ARTIFACT)} is missing, and this file declares recorded facts.\n` +
        `      Run: node scripts/readme-facts.mjs --record`
    );
  const values = {};
  for (const [id, fact] of Object.entries(FACTS)) {
    if (fact.kind === 'static') {
      values[id] = fact.compute();
    } else {
      const rec = artifact.facts?.[id];
      if (rec === undefined)
        fail(
          `fact "${id}" is recorded, but ${relative(REPO, ARTIFACT)} has no entry for it.\n` +
            `      Run: node scripts/readme-facts.mjs --record`
        );
      values[id] = rec.value;
    }
  }
  return { values, artifact };
}

/* ── check / write ───────────────────────────────────────────────────── */

const decimalsOf = (found) => (found.includes('.') ? found.split('.')[1].length : null);

function sameNumber(found, expected) {
  const f = Number(stripCommas(found));
  if (Number.isNaN(f)) return false;
  const d = decimalsOf(found);
  return d === null ? Number(expected) === f : Number(Number(expected).toFixed(d)) === f;
}

function render(found, expected, word) {
  if (word) {
    const w = toWord(expected);
    return found[0] === found[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;
  }
  const d = decimalsOf(found);
  if (d !== null) return Number(expected).toFixed(d);
  return found.includes(',') ? withCommas(expected) : String(expected);
}

function run(mode) {
  const { values } = resolveFacts();
  const problems = [];
  let rewrites = 0;

  const files = new Map();
  const load = (rel) => {
    if (!files.has(rel))
      files.set(rel, { text: readFileSync(join(REPO, rel), 'utf8'), dirty: false });
    return files.get(rel);
  };
  const lineOf = (src, index) => src.slice(0, index).split('\n').length;

  for (const [id, fact] of Object.entries(FACTS)) {
    const expected = values[id];
    for (const raw of fact.sites) {
      const site = raw instanceof RegExp ? { re: raw, word: false } : raw;
      const rel = site.file ?? 'README.md';
      const entry = load(rel);
      const re = new RegExp(
        site.re.source,
        site.re.flags.includes('g') ? site.re.flags : `${site.re.flags}g`
      );
      const matches = [...entry.text.matchAll(re)];

      /* The rule that makes this a checker and not a decoration. */
      if (matches.length === 0) {
        problems.push(
          `${id}: a claim site in ${rel} matched NOTHING.\n` +
            `      pattern  ${site.re}\n` +
            `      This means the sentence was reworded and this fact is no longer\n` +
            `      verified anywhere. Update the pattern in scripts/readme-facts.mjs,\n` +
            `      or delete the site if the claim is genuinely gone.`
        );
        continue;
      }

      /* Right-to-left so earlier offsets stay valid while rewriting. */
      for (const m of [...matches].reverse()) {
        const found = m[1];
        const ok = site.word
          ? found.toLowerCase() === toWord(expected)
          : sameNumber(found, expected);
        if (ok) continue;

        const want = render(found, expected, site.word);
        if (mode === 'write') {
          const replaced = m[0].replace(found, want);
          entry.text =
            entry.text.slice(0, m.index) + replaced + entry.text.slice(m.index + m[0].length);
          entry.dirty = true;
          rewrites++;
        } else {
          problems.push(
            `${id}: ${rel}:${lineOf(entry.text, m.index)} says ${found}, but ${fact.describe} is ${expected}.\n` +
              `      context  ${m[0].trim().slice(0, 100)}`
          );
        }
      }
    }
  }

  for (const inv of INVARIANTS) {
    if (!inv.holds(values)) {
      problems.push(`invariant broken — ${inv.name}\n      ${inv.explain(values)}`);
    }
  }

  if (mode === 'write') {
    const written = [];
    for (const [rel, entry] of files) {
      if (!entry.dirty) continue;
      writeFileSync(join(REPO, rel), entry.text);
      written.push(rel);
    }
    console.log(
      rewrites === 0
        ? '  ✓ Everything already agrees with the source. Nothing rewritten.'
        : `  ✓ rewrote ${rewrites} number${rewrites === 1 ? '' : 's'} in ${written.join(', ')}.`
    );
    if (problems.length) {
      console.error('\n  Some problems cannot be fixed by rewriting a number:\n');
      for (const p of problems) console.error(`  ✗ ${p}\n`);
      process.exit(1);
    }
    return;
  }

  if (problems.length) {
    console.error(`\n  README.md disagrees with the code in ${problems.length} place(s):\n`);
    for (const p of problems) console.error(`  ✗ ${p}\n`);
    console.error(
      `  Fix by re-running the source of truth, not by editing prose:\n` +
        `    node scripts/readme-facts.mjs --write    # apply the code's numbers to the README\n`
    );
    process.exit(1);
  }

  const n = Object.keys(FACTS).length;
  const sites = Object.values(FACTS).reduce((a, f) => a + f.sites.length, 0);
  console.log(
    `  ✓ ${n} facts, asserted at ${sites} sites across ${files.size} file(s), ` +
      `all agree with the code (${INVARIANTS.length} invariants hold).`
  );
}

/* ── record ──────────────────────────────────────────────────────────── */

/**
 * Vitest's summary lines. The shapes that matter:
 *
 *   Tests  635 passed (635)
 *   Tests  540 passed | 11 skipped (551)
 *   Tests  2 failed | 549 passed (551)
 *
 * The parenthesised figure is the TOTAL, and reading only that makes a skipped
 * suite indistinguishable from a passing one. So the breakdown is parsed too.
 */
function parseVitest(out) {
  const files = out.match(/Test Files\s+.*?\((\d+)\)/);
  const tests = out.match(/Tests\s+(.*?)\((\d+)\)/);
  if (!files || !tests)
    throw new Error('could not find Vitest\'s "Test Files"/"Tests" summary lines in the output');
  const pick = (word) => {
    const m = tests[1].match(new RegExp(`(\\d+)\\s+${word}`));
    return m ? Number(m[1]) : 0;
  };
  return {
    files: Number(files[1]),
    tests: Number(tests[2]),
    passed: pick('passed'),
    skipped: pick('skipped'),
    failed: pick('failed'),
  };
}

function record() {
  const sh = (cmd) => {
    console.log(`  → ${cmd}`);
    try {
      return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      /* Vitest exits non-zero on a failing test but still prints its summary.
         We want the summary either way — a red suite still has a real count,
         and recording it is more honest than refusing to. */
      return `${e.stdout || ''}${e.stderr || ''}`;
    }
  };

  const beCmd = 'npm --prefix backend run test';
  const feCmd = 'npm --prefix frontend run test';
  const be = parseVitest(sh(beCmd));
  const fe = parseVitest(sh(feCmd));

  const today = new Date().toISOString().slice(0, 10);
  const artifact = {
    $comment:
      'Recorded facts for README.md — figures that require executing something. Regenerate with ' +
      '`node scripts/readme-facts.mjs --record`. NOTE: the README deliberately states no pass ' +
      'counts (see its Testing section), so nothing in here is currently asserted by --check. ' +
      'It exists so the numbers are available WITH provenance if the README ever quotes them, ' +
      'and so a run that was not green leaves a different file behind than one that was.',
    recordedAt: today,
    machine: `${process.platform}-${process.arch}, node ${process.version}`,
    facts: {
      testFilesBackend: { value: be.files, command: beCmd },
      testsBackend: { value: be.tests, command: beCmd },
      testFilesFrontend: { value: fe.files, command: feCmd },
      testsFrontend: { value: fe.tests, command: feCmd },
      testsTotal: { value: be.tests + fe.tests, command: 'the sum of the two runs above' },
      testsSkipped: {
        value: be.skipped + fe.skipped,
        command: 'the "N skipped" segment of both Vitest summary lines',
      },
    },
    /* Recorded but deliberately NOT asserted. A green artifact must not be
       mistakable for a green suite: --record keeps the counts from a failing
       run on purpose, so without this block a red suite and a clean one leave
       identical files behind. */
    suiteOutcome: {
      backend: { passed: be.passed, failed: be.failed, skipped: be.skipped },
      frontend: { passed: fe.passed, failed: fe.failed, skipped: fe.skipped },
      allGreen: be.failed === 0 && fe.failed === 0,
    },
  };
  mkdirSync(dirname(ARTIFACT), { recursive: true });
  writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\n  ✓ wrote ${relative(REPO, ARTIFACT)} (recorded ${today})`);
  if (!artifact.suiteOutcome.allGreen) {
    console.log('    NOTE: the suites were NOT green. The counts are recorded anyway; the outcome');
    console.log('          is in suiteOutcome so this file cannot be mistaken for a pass.');
  }
  console.log('    Nothing in --check reads these values today; see the header of this script.');
}

/* ── main ────────────────────────────────────────────────────────────── */

const arg = process.argv[2] ?? '--check';
if (arg === '--record') record();
else if (arg === '--write') run('write');
else if (arg === '--check') run('check');
else {
  console.error(`unknown option ${arg}\nusage: readme-facts.mjs [--check|--write|--record]`);
  process.exit(2);
}
