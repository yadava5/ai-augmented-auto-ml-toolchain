<p align="center">
  <img src="docs/branding/readme-light.svg#gh-light-mode-only" width="800" alt="Agentic AutoML Platform">
  <img src="docs/branding/readme-dark.svg#gh-dark-mode-only" width="800" alt="Agentic AutoML Platform">
</p>

<h1 align="center">Agentic AutoML Platform</h1>

<p align="center">
  <strong>A phase-based ML workspace where a LangGraph agent writes the Python, runs it in a locked-down Docker kernel, and checks its own output — with the tool set narrowed stage by stage so the model cannot skip the review step.</strong>
</p>

<p align="center">
  <a href="https://agentic-automl-platform.vercel.app/"><strong>Landing site</strong></a> •
  <a href="https://agentic-automl-platform.vercel.app/system-card"><strong>System Card</strong></a> •
  <a href="#workflow">Workflow</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#what-the-agent-decides-and-what-is-fixed">What the agent decides</a> •
  <a href="#testing">Testing</a> •
  <a href="#getting-started">Getting Started</a>
</p>

<p align="center">
  <img src="https://github.com/yadava5/ai-augmented-auto-ml-toolchain/actions/workflows/ci.yml/badge.svg" alt="CI">
  <img src="https://img.shields.io/badge/tests-Vitest%20%2B%20Playwright-brightgreen?style=flat-square" alt="tests">
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-22-brightgreen?style=flat-square&logo=nodedotjs" alt="node">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="typescript">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="react">
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white" alt="express">
  <img src="https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="postgresql">
</p>

---

## Overview

Agentic AutoML turns a dataset and a folder of domain documents into trained, comparable models without the operator writing the pipeline by hand. You upload a CSV and walk through seven workspace phases. In the four that are agent-driven — onboarding, preprocessing, feature engineering and training — an LLM proposes a step, generates Python for it, executes that Python in a sandboxed container, and reads the result back before proposing the next one. The other three (explorer, experiments, deployment) are conventional features, and the [Workflow](#workflow) table says which is which. The notebook stays visible and editable throughout; the agent writes into the same cells you do.

It is a TypeScript monorepo: React 19 frontend, Express 5 API, PostgreSQL 16 with pgvector for metadata and embeddings, and a `python:3.11-slim` container running Jupyter Kernel Gateway for execution. The agentic core is a LangGraph state machine (`backend/src/services/workflows/`) with one `PhaseConfig` per phase, driving a set of **44 tool definitions** declared across seven group files in `backend/src/services/llm/tools/`. Twelve of those are additionally exposed over the Model Context Protocol.

### Why it's interesting

- **The tool list is a control surface, not a menu.** `tools/index.ts` builds a different allowed-tool array per lifecycle stage. `LLM_FEATURE_PROPOSAL_TOOLS` deliberately excludes `materialize_feature_code`, so on the first turn the model *cannot* skip proposal review by jumping straight to code generation. Restricting the schema is cheaper and more reliable than prompting the model not to.
- **A stage taxonomy that admits some steps are not the model's call.** `StageConfig.mode` in `phaseConfig.ts` is `'text' | 'action' | 'deterministic' | 'llm_delegated'`. Preprocessing marks `write_code`, `record_execution`, `validate` and `commit` as **deterministic** — those run fixed code paths regardless of what the model would prefer.
- **Bounded self-repair with a real number.** A failed or invalid step routes back to `generate_code` with the error attached, at most **2 times** (`maxAutoRepairAttempts`, `preprocessingRuntime.ts`). Four separate loop caps guard the graph — 48 iterations, 10 calls of any one tool, 5 identical calls, 24 stage hops without a tool call (`graphState.ts`).
- **Execution constraints written as `docker run` flags, not as prose.** Non-root user, read-only root filesystem, 2 GB memory cap, 1.0 CPU, five `nosuid` tmpfs mounts, datasets bind-mounted `:ro`, and an `--internal` Docker network. Every argument is assembled in one function you can read end to end: `buildDockerRunArgs` in `container/dockerBuilder.ts`. See [Sandboxing](#sandboxing) for what is *not* enforced.
- **A regression fixed by removing a tool.** `FEATURE_ENGINEERING_DISCOVERY_TOOLS` is the discovery list minus `get_dataset_profile`, with a comment explaining why: its output is already injected into every feature-engineering request, so leaving the tool available made the model re-profile the dataset in a loop with no matching history entry to stop it.
- **The numbers on this page are a build gate.** Every count below is recomputed from the source that defines it by `npm run readme:check`, which fails CI on disagreement *and* on a claim it can no longer find. See [Verify it](#verify-it).

---

## Workflow

The workspace exposes **seven phases**, routed as `/project/:projectId/:phase` (`frontend/src/App.tsx`). The phase identifiers and labels below come from `frontend/src/types/phase.ts`.

Four of those seven are driven by the LangGraph agent. The other three are conventional application features with LLM assistance in places, not agent-run pipelines — `WorkflowPhaseSchema` in `frontend/src/types/workflow.ts` enumerates exactly four workflow phases: `onboarding`, `preprocessing`, `feature_engineering`, `training`.

| Order | Route segment | Label | LangGraph phase |
| --- | --- | --- | --- |
| 0 | `upload` | Data Upload | `onboarding` |
| 1 | `data-viewer` | Explorer | — |
| 2 | `preprocessing` | Processing | `preprocessing` |
| 3 | `feature-engineering` | Feature Engineering | `feature_engineering` |
| 4 | `training` | Training | `training` |
| 5 | `experiments` | Experiments | — |
| 6 | `deployment` | Deployment | — |

Inside an agent-driven phase, a turn walks a lifecycle. Preprocessing's nine stages (`phases/preprocessing/stageConfig.ts`) are the fullest example:

```mermaid
flowchart LR
    A[answer] --> B[plan_step]
    B --> C[generate_code]
    C --> D[write_code]
    D --> E[record_execution]
    E --> F[validate]
    F --> G{"requiresApproval?"}
    G -- yes --> H[await_approval]
    G -- no --> I[commit]
    H --> I
    I --> J[summarize]
    F -. "failed, under 2 repairs" .-> C
```

Feature engineering and training share a parallel ten-stage shape — `answer → analyze_data / configure_experiment → propose → generate_code → write_code → execute → validate → await_review → register → summarize` — from `phases/featureEngineering.ts` and `phases/training.ts`.

### Upload and planning

<p align="center">
  <img src="docs/screenshots/upload.png" width="100%" alt="Data upload with a project plan created by the LLM agent">
</p>

Datasets (CSV, JSON, XLSX) and domain documents (PDF, DOCX, Markdown) land in a project workspace. The `onboarding` phase is a single `converse` stage with a deliberately small tool set — the four discovery tools plus `ask_user` and `plan_exit` (`LLM_ONBOARDING_TOOLS`) — so the model can inspect the data and interview the operator, but cannot write or run code before a plan exists.

### Data exploration

<p align="center">
  <img src="docs/screenshots/eda.png" width="100%" alt="Automated EDA with statistical profiling and distribution charts">
</p>

Profiling runs on upload: column detection, numeric and categorical analysis, a missing-value matrix, and sampling for large frames (`backend/src/services/eda/`). This phase is not agent-driven; it is deterministic statistics feeding the charts.

### Natural language to SQL

<p align="center">
  <img src="docs/screenshots/nl-to-sql.png" width="100%" alt="Natural language to SQL query interface with results">
</p>

Ask in English or write SQL directly. The pipeline in `services/nlToSql/pipeline.ts` runs four named phases — `schema_context`, `planning`, `sql_generation`, `validation` — streaming progress events for each. Generated SQL goes through `services/sqlValidator.ts`, which parses the statement with `pgsql-ast-parser`, rejects anything not starting with `SELECT` or `WITH`, rejects a second statement, blocks the application tables and system-catalog prefixes listed in `sqlTablePolicy.ts` unless the table is one of the project's own, and appends a `LIMIT` when the query has none. A failed query is retried through `repair.ts` with the error fed back.

### Preprocessing

<p align="center">
  <img src="docs/screenshots/preprocessing.png" width="100%" alt="LLM-driven preprocessing with tool calls in notebook cells">
</p>

The agent proposes a transformation, generates the cell, runs it in the container, and validates the result against row and null counts before committing. Committed steps checkpoint the derived dataset, and `list_checkpoints` / `restore_checkpoint` let you roll back. Divergence between the recorded step and the notebook's actual state has its own pair of tools (`detect_step_divergence`, `reconcile_diverged_step`).

### Training

<p align="center">
  <img src="docs/screenshots/training.png" width="100%" alt="Model training workspace with LLM chat and notebook">
</p>

An interactive notebook backed by a persistent Jupyter kernel, so variables survive across cell executions within a session. The agent writes and runs training cells, then calls `evaluate_results` and `register_model`.

### Experiments

<p align="center">
  <img src="docs/screenshots/experiments.png" width="100%" alt="Experiment leaderboard with model comparison and metrics">
</p>

A leaderboard, Optuna tuning studies (`tuningService.ts` builds and runs the study script in the container), and error attribution that trains a `DecisionTreeClassifier(max_depth=4)` on correct-vs-incorrect predictions to find where a model fails (`errorAttributionService.ts`). Driven by `/api/experiments` and the services behind it, not by the LangGraph graph.

Two details worth stating exactly. **Champion selection is computed client-side** — `findChampionModelId(models)` inside a `useMemo` in `components/experiments/Leaderboard.tsx`; no endpoint returns a champion. And **SHAP is optional**: `evaluationService.ts` emits a script that tries `shap.TreeExplainer` then `shap.LinearExplainer`, and `GET /:modelId/shap` returns `204` when no `shap.json` was produced, so a model without explanations is a normal outcome rather than an error.

### Deployment

Deployment builds an inference container per model (`inferenceServerBuilder.ts`, `inferenceDockerBuilder.ts`) and exposes it through `/api/deployments`: schema, prediction proxy, container logs, request logs with feedback, stats, drift checks, partial-dependence, and scoped API keys. **This router only mounts when `DATABASE_URL` is configured** (`hasDatabaseConfiguration()` in `app.ts`) — without a database the endpoints are absent rather than failing, and `/api/auth` answers `503` for the same reason.

---

## Architecture

```mermaid
flowchart TB
    subgraph FE["Frontend — React 19 + Vite"]
        Pages["Pages / phase workspace"]
        Stores["Zustand stores"]
        ApiLib["lib/api typed fetch"]
        Monaco["Monaco notebook + Jedi completions"]
    end

    subgraph BE["Backend — Express 5"]
        MW["middleware/<br/>JWT auth, project access, LLM rate limit"]
        Routes["routes/ mounted under /api"]
    end

    subgraph AGENT["Agent core — services/workflows"]
        Graph["graph.ts — LangGraph state machine"]
        Planner["planner.ts + phaseRequestBuilder.ts"]
        PhaseCfg["phases/ — onboarding, preprocessing,<br/>featureEngineering, training"]
        ToolExec["toolExecutor.ts"]
    end

    subgraph LLM["LLM services — services/llm"]
        Client["llmClient + providers/openaiClient"]
        Tools["tools/ — 44 definitions, 7 group files"]
        Prompts["prompts/"]
    end

    MCP["services/mcp — MCP server<br/>12 registered tools"]

    subgraph EXEC["Execution — services/container + kernel"]
        DockerB["dockerBuilder.ts"]
        ImgMgr["imageManager.ts"]
        NetMgr["networkManager.ts"]
        Kernel["kernel/ — Jupyter protocol"]
    end

    subgraph DATA["Persistence"]
        PG[("PostgreSQL 16 + pgvector")]
        Repos["repositories/ — file + DB stores"]
    end

    Runtime["Docker: python:3.11-slim<br/>Jupyter Kernel Gateway"]
    OpenAI["OpenAI API"]

    Pages --> Stores
    Pages --> ApiLib
    Monaco --> ApiLib
    ApiLib --> MW
    MW --> Routes
    Routes --> Graph
    Routes --> Repos
    Graph --> Planner
    Planner --> PhaseCfg
    PhaseCfg --> Tools
    Graph --> ToolExec
    ToolExec --> Client
    Client --> OpenAI
    ToolExec --> Kernel
    ToolExec --> Repos
    MCP --> Tools
    Kernel --> Runtime
    DockerB --> Runtime
    ImgMgr --> Runtime
    NetMgr --> Runtime
    Repos --> PG
    Routes -. "WebSocket: cell output, tuning progress" .-> Pages
```

### The hard part: narrowing the tool set per stage

The interesting design decision is not the graph. It is that **`tools/index.ts` exports nine different tool arrays**, each a filtered view of the same 44 definitions, and the phase config picks one per lifecycle stage.

This exists because prompting a model not to do something is unreliable and schema restriction is not. Two cases, both with the reasoning committed in comments beside the code:

- **`LLM_FEATURE_PROPOSAL_TOOLS`** contains `propose_feature` and nothing else from the feature lifecycle. Without that narrowing the model would call `materialize_feature_code` on turn one and the operator would never see a proposal to approve. The gate is enforced by absence.
- **`get_dataset_profile` is filtered out of the three feature-engineering arrays that build on `FEATURE_ENGINEERING_DISCOVERY_TOOLS`** — the engineering, proposal and continue sets — while the two lifecycle arrays keep it. Its data is already injected into the request through the `dataset` parameter, so at those stages the model would call the tool, get a result with no matching conversation history, and re-profile forever. The fix was removing the tool from those stages, not rewriting the prompt.

The cost is real: nine near-duplicate arrays that must be kept consistent by hand, and a stage that is missing a tool fails in a way that looks like a model failure. The tradeoff was accepted because the alternative failure mode — the agent silently skipping a human review gate — is worse.

### Sandboxing

Every argument below is in `backend/src/services/container/dockerBuilder.ts`, and asserted in `dockerBuilder.test.ts`.

| Constraint | Flag | Default |
| --- | --- | --- |
| Non-root user | `--user sandbox` | user created in `Dockerfile.python-runtime` |
| Read-only root filesystem | `--read-only` | always |
| Memory cap | `--memory` | 2048 MB (`EXECUTION_MAX_MEMORY_MB`) |
| CPU cap | `--cpus` | 1.0 (`EXECUTION_MAX_CPU_PERCENT`, divided by 100) |
| Writable scratch | 5 × `--tmpfs`, all `nosuid` | `/tmp` 1024 MB, four smaller home dirs |
| Datasets | `-v …/datasets:/datasets:ro` | read-only bind mount |
| Network | `--network automl-sandbox` | created via `docker network create --internal`, which blocks outbound traffic (`networkManager.ts`) |
| Host reachability | `--add-host host.docker.internal:0.0.0.0` | blackholes the host name even if the network is overridden |

**What is not enforced, stated plainly.** There is no `--pids-limit`, no `--cap-drop`, no `--security-opt no-new-privileges` and no custom seccomp profile anywhere in the repository. The execution timeout (`EXECUTION_TIMEOUT_MS`, 600000 ms) is applied by the application when it calls the kernel, not by Docker. The network isolation is a **default, not a floor**: `EXECUTION_NETWORK` is an environment variable, and the beta deploy template renders `EXECUTION_NETWORK=bridge` (`deploy/beta/render-backend-env.sh`), which restores outbound network access for executed code. Treat this as a sandbox for accidents and resource exhaustion, not as a boundary that has been tested against a determined attacker.

That paragraph is a claim about *absence*, which is the one kind of claim that silently becomes false when somebody does the right thing — so `readme:check` greps `backend/` and `deploy/` for all four flags and fails if any of them lands while this text still denies it.

### Data model

```mermaid
erDiagram
    users ||--o{ projects : owns
    projects ||--o{ documents : contains
    projects ||--o{ notebooks : contains
    projects ||--o{ workflows : runs
    projects ||--o{ models : produces
    documents ||--o{ chunks : "split into"
    chunks ||--|| embeddings : "vectorized as"
    notebooks ||--o{ cells : contains
    notebooks ||--o{ savepoints : "checkpointed by"
    workflows ||--o{ experiments : records
    models ||--o{ deployments : "served by"
```

Persistence is deliberately split. Project and dataset metadata are file-backed under `backend/storage/`; auth, notebooks, cells, savepoints, workflows, experiments, models, deployments, plan chats, the query cache and embeddings live in Postgres across **24 migrations** (`backend/migrations/`).

Document retrieval is **pure vector similarity** — `documentSearchService.ts` embeds the query with `text-embedding-3-small` (1536 dimensions) and orders by pgvector cosine distance over an HNSW index (`015_pgvector_embeddings.sql`). There is no keyword or BM25 leg and no reranker; earlier descriptions of this as hybrid search were wrong.

---

## What the agent decides, and what is fixed

This matters more here than in most projects, so it gets its own section.

**Decided by the model.** Which transformation or feature to propose and why; the Python source for each step; whether the validation result justifies another attempt; when a phase is finished. Requests go to **OpenAI** (`openai` SDK, `providers/openaiClient.ts`). The model catalog offers `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini` and `gpt-5.4-nano` with a selectable reasoning effort; the default is `gpt-5.4` (`modelCatalog.ts`, `config.ts`). `LLM_PROVIDER=mock` swaps in a deterministic client for tests.

**Fixed by construction.** Stage order within a lifecycle. The `deterministic` stages — writing the cell, recording the execution, validating, committing — which run application code and ignore model preference. The tool array available at each stage. The four loop caps. SQL statement validation. The container flags.

**Not what it looks like: approval is per-step and the model sets the flag.** `requiresApproval` is an optional boolean *parameter on the model's own tool schema* for `propose_transformation_step` and `validate_step_result` (`tools/preprocessingTools.ts`), and it defaults to `false` in three places (`preprocessingRuntime.ts`, `preprocessing/stateSync.ts`, `featureTools/executionTools.ts`). The graph routes to `await_approval` only when that flag is true. So preprocessing is **not** gated on every step by default — the model chooses which steps to escalate. Feature engineering and training are stronger: `await_review` is an ordered lifecycle stage, and training additionally treats `propose_model` as an approval stage (`APPROVAL_STAGES`, `phases/training.ts`). If you need every preprocessing step reviewed, that is a change to the runtime default, not a setting.

---

## Tech Stack

### Frontend

| Category | Technologies |
| --- | --- |
| **Framework** | React 19.1, TypeScript 5.8, Vite 7.3 |
| **State** | Zustand 5.0 with persistence |
| **Routing** | React Router 7.13, phase-based |
| **UI** | Tailwind CSS 3.4, Radix UI, shadcn/ui |
| **Editor** | Monaco 4.7 with Jedi-backed Python completions and hover docs |
| **Charts** | Recharts 3.5 |

### Backend

| Category | Technologies |
| --- | --- |
| **Runtime** | Node.js 22, Express 5.2, TypeScript 5.6 |
| **Agent** | `@langchain/langgraph` 1.2, `@modelcontextprotocol/sdk` 1.27 |
| **LLM** | `openai` 6.27 |
| **Database** | PostgreSQL 16 with pgvector, `pg` 8.16, hand-written SQL |
| **Validation** | Zod 3.23, `pgsql-ast-parser` 12.0 |
| **Realtime** | `ws` 8.18 |
| **Logging** | `pino` 10.3 |

### Execution and infrastructure

| Category | Technologies |
| --- | --- |
| **Sandbox image** | `python:3.11-slim` + Jupyter Kernel Gateway 3.0.1 |
| **Python libraries** | pandas 2.2.2, numpy 1.26.4, scikit-learn 1.5.1, scipy 1.14.0, Optuna 4.2.0, SHAP 0.46.0, matplotlib 3.9.2, plotly 5.23.0 |
| **Dev database** | `pgvector/pgvector:pg16` managed by `scripts/dev/` |
| **CI** | GitHub Actions — `ci.yml`, `codeql.yml`, `gitleaks.yml`, `scorecard.yml` |

### Presentation surfaces

| Directory | What it is | Stack |
| --- | --- | --- |
| `landing/` | Marketing site, **live at [agentic-automl-platform.vercel.app](https://agentic-automl-platform.vercel.app/)**; imports real preview components from `frontend/src` | Astro 5, React, Tailwind |
| `booklet/` | Project booklet, and the source of the [System Card](https://agentic-automl-platform.vercel.app/system-card) | Vite 6, React 19 |
| `poster/` | Senior-design expo poster, exports to PDF and frames | Vite 6, React 19 |
| `video/` | Product and branding videos, plus a slide deck | Remotion 4.0 |

The System Card is a booklet build committed into `landing/public/system-card/` so no deploy can drop the page. Because it is a build output living beside its sources, `npm run check:system-card` compares recorded hashes of both and fails CI when they diverge — editing `booklet/src/` without rebuilding is otherwise invisible to lint, test and build.

The landing site is what this repository's root `vercel.json` builds and deploys. The application itself is run locally: the landing page's sign-in links resolve to `http://localhost:5173` unless `PUBLIC_FRONTEND_ORIGIN` is set at build time (`landing/src/lib/appLinks.ts`).

---

## Testing

Five commands exist. Their scope is described below from the committed configuration; **the pass counts are not stated here because a pass count is a claim about a run, not about the tree**, and the standing rule in this repository is that a number without a command that regenerates it gets deleted rather than softened. `npm run readme:record` writes the suite counts, their commands and the date into `docs/readme-facts.json` for anyone who wants them with provenance.

| Command | Runner | Covers | Runs in CI |
| --- | --- | --- | --- |
| `npm run test` | Vitest 4 | Backend + frontend unit and integration | Yes |
| `npm run test:landing` | Vitest | Landing components, copy and post-build output | Yes |
| `npm run benchmark` | Playwright | End-to-end journeys against a built app | No |
| `npm run eval` | `tsx testing/tests/evalRunner.ts` | NL→SQL exact-match and RAG phrase-containment against a running API | No |
| `npm run benchmark:api` | autocannon | API load profile | No |

What is countable from committed files, and the command for each:

| Quantity | Value | Source |
| --- | --- | --- |
| Backend test files | 130 | `git ls-files 'backend/**/*.test.ts' \| wc -l` |
| Frontend test files | 122 | `git ls-files 'frontend/**/*.test.ts' 'frontend/**/*.test.tsx' \| wc -l` |
| Landing test files | 17 | `git ls-files 'landing/**/*.test.ts*' \| wc -l` |
| Playwright specs | 11 | `git ls-files 'testing/tests/*.spec.ts' \| wc -l` |
| NL→SQL eval cases **defined** | 3 | `testing/fixtures/nl2sql_eval.json` |
| RAG eval cases **defined** | 15 | `testing/fixtures/rag_eval.json` |

Those are file and fixture counts, not test-case counts — a Vitest file holds many cases, and `describe.each` makes the true total impossible to read off the source correctly. Anyone wanting the case count should run the suite and take it from the run summary.

**What CI actually does**, in order, because a README that describes the wrong workflow is the exact failure this page is built against. `ci.yml` runs `readme:check` as its own dependency-free job, then a `lint-build-test` job that runs `npm run check:system-card` before any install, installs `backend`, `frontend` and `landing` with `npm ci`, and runs `npm run lint`, `npm run test`, `npm run build`, `npm run build:landing` and `npm run test:landing` — landing is built before it is tested because part of that suite reads `landing/dist`. The Playwright benchmarks, the eval runner and the API benchmark **do not run in CI**. The eval suite in particular needs a live backend and a real OpenAI key, so it is a local, manually-invoked check. Three other workflows do run: CodeQL on push, PR and weekly; Gitleaks secret scanning on push, PR and weekly; and OpenSSF Scorecard weekly, which uploads SARIF and sets `publish_results: true`.

The eval runner is also worth reading before trusting its output. NL→SQL scoring is **exact string comparison** against an expected SQL string, case-insensitively — a semantically identical query with different whitespace or column order counts as a failure. RAG scoring checks that every expected phrase appears in the answer. Both are deliberately blunt, and both are small: 3 and 15 cases.

---

## Implemented vs delegated vs planned

### Implemented in this repository

- The LangGraph phase framework: `PhaseConfig`, the four phase implementations, the stage-scoped tool arrays, the planner, the turn executor and finalizer, and the four loop caps.
- All 44 tool definitions and their handlers, including the preprocessing checkpoint and divergence-reconciliation tools.
- The four-phase NL→SQL pipeline with its own generation cache, confidence tiering, join planning, repair pass and read-only SQL validator.
- The container layer: `docker run` argument construction, image build and reuse, the internal network, cleanup, and the Jupyter kernel protocol client.
- Notebook services — CRUD, cell locking, savepoint checkpoint and restore, recovery, dataset export and sync.
- Auth: JWT with email verification, Google OAuth, per-route rate limits, project-ownership and deployment-ownership middleware.
- The inference server builder that packages a registered model into a servable container.

### Delegated, on purpose

- **Model inference** — OpenAI's API. No model is trained, fine-tuned or hosted for the agent itself.
- **Graph execution semantics** — `@langchain/langgraph` owns the state machine runtime; this repository supplies the nodes, the state annotations and the routing predicates.
- **MCP transport and protocol** — `@modelcontextprotocol/sdk`.
- **The ML itself** — scikit-learn, Optuna and SHAP inside the container. The platform orchestrates and sandboxes ML; it does not implement estimators, samplers or explainers.
- **Vector search** — pgvector's HNSW index and cosine operator, rather than an external vector database.
- **SQL parsing** — `pgsql-ast-parser`, so the read-only validator resolves table references from an AST instead of a regex.
- **Python execution** — Jupyter Kernel Gateway, which is why kernel state persists across cells for free.

### Planned, not in this build

- **A retrieval leg that is not vector-only.** The keyword and reranking half of a genuine hybrid search is not written. `documentSearchService.ts` is one cosine-ordered query.
- **A hardened sandbox.** `--pids-limit`, `--cap-drop`, `no-new-privileges` and a seccomp profile are all absent, and the beta deployment currently runs containers on `bridge`. Closing that is a known open item, not a shipped guarantee.
- **Approval-required-by-default preprocessing.** The flag exists and the `await_approval` stage works; making it the default is a behaviour change nobody has made.
- **Published benchmark results.** `docs/benchmarks/` holds a policy README and no data; `testing/benchmarks/runs/` is git-ignored by design (`testing/.gitignore`). There are no benchmark numbers in this README because there are no committed benchmark artifacts to quote.
- **A managed deployment of the application itself.** The landing site deploys from this repository; the backend and frontend do not. Runbooks exist (`docs/beta-zero-paid-deploy.md`, `deploy/beta/`) and target a single GCP host behind DuckDNS with the frontend on Vercel.

---

## Getting Started

### Prerequisites

- Node.js 22 (`.node-version`)
- Docker, running — required for both the dev Postgres and every code execution
- An OpenAI API key for any LLM-backed feature

### Quick start

```bash
git clone https://github.com/yadava5/ai-augmented-auto-ml-toolchain.git
cd ai-augmented-auto-ml-toolchain

npm run install:all   # backend, frontend, testing, landing, video, poster, booklet
npm run dev           # managed Postgres + migrations + both dev servers
```

Backend on `http://localhost:4000`, frontend on `http://localhost:5173`.

`npm run dev` starts a `pgvector/pgvector:pg16` container named `automl-postgres-<port>` and runs migrations. If it created or started that container, it stops it on shutdown; a compatible container that was already running is left alone.

### Environment variables

Copy `backend/.env.example` and fill in the secrets. The settings that change behaviour most are below, **shown at the defaults compiled into `backend/src/config.ts`** — which is not always what `.env.example` ships, and the config default is what runs when the variable is unset:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5433/automl
OPENAI_API_KEY=sk-...
LLM_PROVIDER=openai            # or `mock` for deterministic tests
OPENAI_DEFAULT_MODEL=gpt-5.4

EXECUTION_MAX_MEMORY_MB=2048
EXECUTION_MAX_CPU_PERCENT=100
EXECUTION_TIMEOUT_MS=600000    # .env.example ships half this; the code default is what you get unset
EXECUTION_NETWORK=automl-sandbox   # `--internal`; `bridge` restores egress
```

Note that `/api/auth` answers `503` and `/api/deployments` is not mounted at all when `DATABASE_URL` is unset.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Managed Postgres, migrations, backend and frontend |
| `npm run build` | Backend `tsc` + frontend Vite build |
| `npm run test` | Backend + frontend Vitest |
| `npm run lint` | ESLint across backend and frontend |
| `npm run db:migrate` | Apply pending migrations, idempotent |
| `npm run audit` | Dependency audit across root, backend, frontend, testing |
| `npm run readme:check` | Verify every number on this page against the code (`readme:write` repairs them, `readme:record` re-measures the suites) |
| `npm run check:system-card` | Verify the committed System Card still matches its booklet sources |
| `npm run benchmark` | Playwright end-to-end, headless |
| `npm run eval` | NL→SQL and RAG evaluation against a running API |
| `npm run benchmark:api` | autocannon API load run |
| `npm run dev:landing` / `npm run build:landing` | Astro landing site |
| `npm run video:dev` / `npm run poster:pdf` / `npm run booklet:pdf` | Presentation assets |

The full script list, including the Vercel and GCP deployment helpers, is in the root `package.json`.

---

## Project Structure

```
backend/
  src/routes/               Express routers mounted under /api
  src/middleware/           JWT auth, project + deployment ownership, rate limits
  src/services/
    workflows/              LangGraph graph, planner, turn executor
      phases/               onboarding, preprocessing, featureEngineering, training
    llm/
      tools/                44 tool definitions across 7 group files
      providers/            openaiClient + a deterministic mock client
      langgraph/            preprocessing runtime and state annotations
      prompts/              system and user prompt builders
    mcp/                    MCP server exposing 12 of the tools
    container/              dockerBuilder, imageManager, networkManager, cleanup
    kernel/                 Jupyter Kernel Gateway protocol client
    nlToSql/                4-phase pipeline, repair, generation cache
    sqlValidator.ts         read-only SQL gate over pgsql-ast-parser
    eda/                    profiling, statistics, missing matrix, sampling
    notebook/               CRUD, cell locking, savepoints, recovery
    websocket/              notebook and deployment WS servers
  src/repositories/         file-backed and Postgres-backed stores
  migrations/               24 SQL migrations
  docker/                   Dockerfile.python-runtime

frontend/src/
  App.tsx                   routes, including /project/:projectId/:phase
  types/phase.ts            the seven workspace phases
  types/workflow.ts         the four LangGraph workflow phases
  components/               shadcn/ui + Radix + custom
  stores/                   Zustand
  lib/api/                  typed fetch wrappers

testing/                    Playwright specs, eval runner, benchmark control plane
scripts/                    dev orchestrator, dependency audit, README + System Card gates
deploy/beta/                GCP + DuckDNS + Vercel runbook scripts
landing/  video/  poster/  booklet/    presentation surfaces
docs/                       API contracts, design system, branding, recorded facts
```

---

## Technical Decisions

**Restrict the schema instead of instructing the model.** Approval gates and step ordering are enforced by which tools exist at a stage, not by prompt text. This is more reliable and costs nine hand-maintained tool arrays plus failures that present as model errors when an array is wrong.

**Split persistence between files and Postgres.** Project and dataset metadata are files; everything relational is Postgres. Files made early iteration fast and keep large dataset metadata out of the database, at the price of two consistency stories instead of one and no transaction spanning both.

**One long-lived container per workspace, not one per execution.** Kernel state persisting across cells is the whole point of a notebook, and container startup dominates short cells. The cost is that a workspace holds 2 GB of memory for its lifetime and `containerReuse.ts` exists to decide when a container is still safe to reuse.

**Pure SQL over an ORM.** The NL→SQL feature generates SQL and validates it as text; an ORM in the middle would have been an obstacle. Queries are hand-written and readable, and schema changes are explicit migrations rather than inferred.

---

## Verify it

Every number above terminates in something you can open. From a clean clone:

```bash
# 44 tool definitions, at the definition site — not the registration site
grep -rhoE "^ +name: '[a-z_]+'," backend/src/services/llm/tools/*.ts | wc -l      # 44
grep -rcE  "^ +name: '[a-z_]+'," backend/src/services/llm/tools/*.ts             # per group file

# 12 of them registered over MCP
grep -c "server.registerTool(" backend/src/services/mcp/mcpServer.ts             # 12

# The seven UI phases, versus the four LangGraph phases. Anchored on the
# declarations rather than on line numbers, for the reason below.
sed -n '/^export type Phase =/,/;$/p'              frontend/src/types/phase.ts     # 7
sed -n '/^export const WorkflowPhaseSchema/,/^\]);$/p' frontend/src/types/workflow.ts  # 4

# Loop caps and the auto-repair bound
grep -n "^export const MAX_" backend/src/services/workflows/graphState.ts
grep -n "maxAutoRepairAttempts: 2" backend/src/services/llm/langgraph/preprocessingRuntime.ts

# Every sandbox flag, in one function. Matched by name rather than by line
# number, because a line range is a claim that goes stale the next time anyone
# adds a comment above it — which is exactly what happened to the range that
# used to be here.
sed -n '/^export function buildDockerRunArgs/,/^}$/p' backend/src/services/container/dockerBuilder.ts

# What the sandbox does NOT set — each of these prints nothing.
# Scoped to source, because this README names the flags it does not use.
git grep -c "pids-limit"        -- backend deploy
git grep -c "cap-drop"          -- backend deploy
git grep -c "no-new-privileges" -- backend deploy
git grep -c "seccomp"           -- backend deploy

# Retrieval is vector-only — no tsvector, no BM25, no reranker
cat backend/src/services/documentSearchService.ts

# Test-file and eval-fixture counts
git ls-files 'backend/**/*.test.ts' | wc -l                                      # 130
git ls-files 'frontend/**/*.test.ts' 'frontend/**/*.test.tsx' | wc -l            # 122
git ls-files 'testing/tests/*.spec.ts' | wc -l                                   # 11
python3 -c "import json;print(len(json.load(open('testing/fixtures/rag_eval.json'))))"   # 15
```

Or run them all at once: `npm run readme:check` recomputes every number above from the source that defines it — including the copies that live outside this file, in `booklet/src/content.ts`, `booklet/src/diagrams/MCPToolRegistry.tsx` and `video/docs/CAPTURE.md` — and fails the build on any disagreement. It also fails when a sentence has been reworded so that the checker can no longer find the claim it was checking, because a check that quietly stops checking is worse than no check. It runs as its own dependency-free job in `ci.yml`, so a documentation-only pull request still gets a verdict without waiting for three installs.

What it does **not** check is prose: paths, file names, and the shape of CI. Those are read, not computed. A green `readme:check` means the numbers agree with the code, not that every sentence is true.

CI status is the badge at the top, from `.github/workflows/ci.yml`. Security workflows are `codeql.yml`, `gitleaks.yml` and `scorecard.yml` in the same directory.

---

## Documentation

- [`docs/api-contracts.md`](docs/api-contracts.md) — request/response contracts
- [`docs/design-system.md`](docs/design-system.md) — UI guidelines and component patterns
- [`docs/beta-zero-paid-deploy.md`](docs/beta-zero-paid-deploy.md) — zero-paid beta deploy runbook (Vercel + DuckDNS + single-host backend)
- [`docs/readme-facts.json`](docs/readme-facts.json) — suite counts with the command and date that produced them

---

## Authors

Built as a Miami University CSE 449 senior design project, class of 2026.

- **[Ayush Yadav](https://github.com/yadava5)** — Author. Built the entire frontend and end-to-end integration.
- **Shree Chaturvedi** — Optimization and strategy.

It was developed on Miami University's GitLab and mirrored to GitHub; `origin` is the GitLab project and `github` is the mirror.

---

## License

Agentic AutoML is licensed under the **[GNU General Public License v3.0](LICENSE)** — the verbatim 649-line GPL-3.0 text is in the repository root.

Because the project is co-owned, any change of license would require agreement from both owners. None has been made. GPL-3.0 is the license today and is the only one that applies to this code.

---

<p align="center">
  Built with TypeScript, LangGraph, PostgreSQL and Docker ·
  <a href="https://agentic-automl-platform.vercel.app/">agentic-automl-platform.vercel.app</a>
</p>
