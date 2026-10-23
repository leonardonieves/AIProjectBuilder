# Agent Guide — AI Project Builder

## Rules before changing anything

Read `AGENTS.md`. This is an independent demonstration project: never inspect sibling projects or client data. Do not install dependencies, build, test, lint, execute generated applications, or deploy without explicit authorization. Never infer passed tests from an agent narrative. Approval is tied to the precise plan revision and content hash. Browser requests cannot choose arbitrary output directories or shell commands.

Every new app must have English/Spanish translation catalogs (English first-use default), both readable light and dark themes, persisted preferences when storage is available, localized dates/numbers, and accessible keyboard controls. Centralize labels, placeholders, validation, errors, empty states, and accessibility text. A language change must never rewrite persisted user content, plans, evidence, or approvals.

## Component map

| Path | Responsibility |
| --- | --- |
| `src/main.jsx`, `src/i18n.jsx`, `src/locales/`, `src/themes.css` | Builder UI and i18n/theme baseline. |
| `server/index.js` | Local server, routes, and events. |
| `server/store.js`, `data/projects.sqlite` | Project snapshots, plan revisions, approvals, workflow persistence. Treat `data/` as private evidence. |
| `server/planner.js`, `server/planner-prompt.js`, `server/planner-contract.js` | Proposal creation and technical contract preparation. |
| `server/generation-contract.js` | v2 contract, exclusive file ownership, approval binding. |
| `server/generation-template.js`, `server/generation-browser-template.js` | Server-owned fullstack and browser-only scaffolding, data adapters, baseline i18n/theme, generated README. Agents cannot replace these files. |
| `server/brief-capabilities.js` | Rejects a server template when the brief explicitly requires browser storage or no application server. |
| `server/generation-engine.js` | Consent, independent attempts, integration, review, correction cycles, recovery, packaging. |
| `server/generation-review.js`, `server/generation-zip.js` | Static analysis without executing generated code; bounded manifest-based ZIP. |
| `shared/download-name.js`, `server/artifact-publication.js` | Safe project-named ZIP downloads and Windows-safe output publication. |
| `server/worker-runner.js`, `server/model-policy.js` | Constrained Codex adapter and model policy. |
| `generated-projects/<generation-id>/attempts/<attempt-id>/` | Retained hashed deliveries; not a completed application. |
| `generated-projects/<generation-id>/app/` | Final result only after successful packaging. |

`README.md` is the current entry point. `docs/ROADMAP.md` is a concise English status/next-steps record. The incident report explains the known Task Manager failure.

## v2 generation lifecycle

1. A proposal contains a normalized `aipb-contract-v2` block. New proposals select either React/Express/SQLite or browser-localStorage React/Vite. The browser template has contract version 3 inside the existing fenced-block format. Explicit browser-only/no-server requirements reject the server template before approval. Clarify other incompatibilities *before* approval.
2. Approval stores revision and SHA-256 plan hash. `prepare` reserves a workflow and displays the managed destination without creating the app or launching agents.
3. `start` requires separate consent, matching revision, `destination=managed-default`, `maxCorrections=2`, and `validation=static-only`. Independent frontend/backend process attempts log start/end times and exit codes. Claim parallelism only with actual overlapping process intervals.
4. Integration produces only files assigned to it. The engine verifies retained file paths, no symlinks, and hashes before reuse. Static analysis and an independent reviewer inspect source; generated code is not run.
5. Generated-code blockers may consume up to two correction cycles. A correction receives the role's previous verified source and retained peer source as data; unchanged, verified integration is not regenerated merely because frontend or domain changed. A blocking `template` finding blocks immediately because agents cannot edit the server-owned template. Success produces `REVIEW.json`, validates archive bounds, and publishes staging to `app` without overwriting. On Windows, a denied directory rename may use an exclusive-copy fallback. `completed` means statically reviewed, not tested.
6. `resume` accepts `interrupted`/`cancelled` and the narrowly supported packaging-stage `gen.internal` recovery when the saved failure stage is `packaging`, provided approval, contract, template and retained files remain valid. `reassess` is limited to `failed`/`gen.correctionsExhausted`. Neither repairs arbitrary `blocked` runs. Never edit persisted status manually.

## Investigation checklist

- Read generation ID, project ID, revision, approval hash, `status`, `stage`, `error`, cycle, selected deliveries, attempts, and reviews from SQLite **read-only**.
- Match a review finding to its exact source and owner. Distinguish deterministic `reviews[]` findings from the independent reviewer result in `data/worker-runs/<id>/result.json`.
- Classify an issue as template defect, agent source defect, contract defect, false positive, or incompatible user requirement. Preserve the original and normalized owner attribution.
- Check actual recovery-state guards before promising resume. A changed template changes `templateHash` and may make an existing prepared workflow stale.
- Do not use file existence or reviewer prose as evidence that the application ran or worked. Real validation needs the actual command, exit code/output, and separate browser observations.

## Known incident and rescue path

See `docs/INCIDENT_TASK_MANAGER_2026-10-20.md`. Independent agent processes produced retained deliveries, but a reviewer finding against the template's same-origin `fetch` blocked the final result. The original brief also conflicts with approved fullstack storage. A separate browser-only `browser-app/` is available for manual evaluation now; it is not the blocked generation's `app` output and has not been runtime-tested here.

The browser-only generator source now has a distinct contract, template, storage adapter, and static review path. The builder's local test suite and build passed on 2026-10-20, but no real generated-app or browser run has verified an end-to-end product. Preserve EN/ES and both themes. Historical approvals do not automatically migrate.

## Responsible handoff

State exactly what source changed, what was inspected, what actually ran, and what remains unverified. Do not share `data/codex-home`, raw logs, or the user's database. Source edits alone do not authorize account usage, installation, execution, or deployment.

## Current generated-app quality evidence (2026-10-20)

Read [`GENERATED_APP_EVALUATION.md`](GENERATED_APP_EVALUATION.md) before changing generation quality, planning, or reviewer guidance. It records user-reported results for a basic task manager and the restaurant reservation app **reserveaset**. These reports demonstrate an initial end-to-end generation capability, but also identify generic visual design and a reservation-creation flow that needs investigation. They are user reports, not independently reproduced results. Do not infer which persistence stack the task manager used: the user described it as having no database, while summarizing the generated examples overall as React + Node/Express + SQLite.

Treat visual finish and core-domain workflow correctness as separate acceptance criteria. A successful ZIP, static review, or working basic CRUD screen is not evidence that an application-specific flow such as creating a restaurant reservation works. Ask for the exact reproduction steps or a generated-app review copy before diagnosing reserveaset. Any install, build, test, server start, or browser/runtime check on generated output needs separate explicit authorization. Keep user content and approval history immutable; changes to an approved plan require a new revision and approval.

## Verification freshness

The generation-publication fix was followed by an authorized builder run of `npm test` (66/66, exit 0) and `npm run build` (exit 0) on 2026-10-20. These checks predate subsequent project-name download, workflow-progress UI, and navigation-retention source edits; those later edits were not tested or built. The two generated applications have not been independently reproduced or runtime-verified by this repository. See the roadmap for the current distinction between user-reported evaluation and repository evidence.
