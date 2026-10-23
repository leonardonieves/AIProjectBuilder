# AI Project Builder

Independent local demonstration project. The binding project rules are in [AGENTS.md](AGENTS.md). Do not read sibling projects or client data. Do not run builds, tests, lint, installations, or deployments without explicit user authorization.

## Current status

The builder demonstrated generating two example apps that the user evaluated: a basic task manager and **reserveaset**, a restaurant reservation app. The task manager reportedly worked for basic use but was intentionally simple; reserveaset had issues when creating a reservation. The user also felt the applications looked too similar, rustic, and unfinished. These are user-reported product observations, not independently reproduced test results. See the [generated-app evaluation notes](docs/GENERATED_APP_EVALUATION.md).

The builder has also received a Windows publication fallback, project-named ZIP downloads, clearer bilingual workflow guidance, visible generation milestones, and a fix that keeps the Generate step selected when a run completes. The last authorized builder test/build run (66 tests and Vite build, both successful) occurred before those latest UI and filename changes. Current source therefore still needs authorized re-verification; neither example app has repository-recorded runtime/browser validation. Historical Task Manager incidents remain documented separately: [original incident](docs/INCIDENT_TASK_MANAGER_2026-10-20.md), [new-project incident](docs/INCIDENT_TASK_MANAGER_NEW_PROJECT_2026-10-20.md), and [revision-5 incident](docs/INCIDENT_TASK_MANAGER_REV5_2026-10-20.md).

The **generator** now has a browser-localStorage template and a brief compatibility guard in source. A new proposal can select it; the old approved fullstack revision remains historical and cannot be silently converted. The browser generation path has **not** yet been tested or exercised by a real agent run. A separate [manual rescue app](generated-projects/1339ea5d-1869-49c2-8b6a-252e90168a58/browser-app/README.md) remains available, but is not generated output or evidence that the builder works.

## Builder workflow

1. Describe a fictional application and request a technical proposal.
2. Review the proposal and its `aipb-contract-v2` block. New proposals can select a browser-localStorage React/Vite template or a local React/Express/SQLite template. Explicit browser-only/no-server briefs must select the browser template. Existing approved plans are not silently rewritten.
3. Approve a specific plan revision and SHA-256 content hash. A plan edit invalidates current approval.
4. Prepare generation. The UI shows the managed destination `generated-projects/<generation-id>/app` before consent; preparation alone does not create the app or launch agents.
5. Explicitly authorize generation and static review. Frontend and backend use independent process attempts, followed by integration and review. This does not authorize installs, builds, tests, runtime execution, or deployment.
6. Download only when the generation reaches `completed`. The ZIP is statically reviewed source, **not a tested working product**.
7. The ZIP filename is based on the project name. On completion the wizard stays on Generate; Download remains selectable as a separate step.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/` | Builder UI, EN/ES catalogs, theme system. |
| `server/index.js` | Local HTTP routes and server entry point. |
| `server/store.js` | SQLite project snapshots, revisions, approvals, and workflows. |
| `server/planner*.js` | Proposal generation and prompt/contract handling. |
| `server/generation-contract.js` | Approved technical contract and file ownership. |
| `server/generation-template.js`, `server/generation-browser-template.js` | Server-owned fullstack and browser-only scaffolding. |
| `server/brief-capabilities.js` | Conservative guard against a server template for explicit browser-only briefs. |
| `server/generation-engine.js` | Consent, agent attempts, integration, review, correction cycles, recovery, and packaging. |
| `server/artifact-publication.js` | Safe final-folder publication when Windows denies a directory rename. |
| `shared/download-name.js` | Sanitized project-name archive filename and UTF-8 response header shared by UI/server. |
| `server/generation-review.js` | Static source analysis without running generated code. |
| `server/worker-runner.js` | Constrained Codex process adapter. |
| `data/` | Private SQLite data, credentials, run results, and evidence. Never share casually. |
| `generated-projects/` | Retained deliveries and completed generated applications. |

Read the [agent guide](docs/AGENT_GUIDE.md) before modifying generator behavior. The [roadmap](docs/ROADMAP.md) distinguishes existing source from outstanding validation.
Read the [generated-app evaluation notes](docs/GENERATED_APP_EVALUATION.md) for user-reported quality gaps and acceptance guidance.
Use the [generator validation guide](docs/GENERATOR_VALIDATION.md) for a new Task Manager proposal and an evidence-based manual check of the generated output.

## Local setup and operation

The builder requires a compatible Node runtime, npm dependencies, and an authenticated Codex CLI in its dedicated `data/codex-home`. `Instalar.ps1`, `Preparar-Codex.ps1`, and `Iniciar.ps1` are the supplied local setup/start scripts. **Do not execute them without authorization.** The builder normally serves `http://127.0.0.1:4310`; generated fullstack apps use a different local port. Neither should be published publicly.

## Safety and evidence

- Approval binds a revision and content hash; generation also checks contract/template hashes and retained file hashes.
- Browser input cannot supply shell commands or arbitrary output directories.
- Agent narratives are not test evidence. Record actual command, exit code, and output before saying tests passed.
- Process timestamps can demonstrate independent and overlapping agent execution; a summary alone cannot.
- English/Spanish i18n and light/dark themes are mandatory for every new app. English is the default on first use. Preserve the user's saved preference and persisted content.
- Keep `data/codex-home` and raw logs private. Back up SQLite only with the server stopped, including WAL/SHM files when present.
