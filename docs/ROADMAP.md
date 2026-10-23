# Roadmap and current verification status

## Current product status (2026-10-20)

AIProjectBuilder has demonstrated its basic app-generation goal in two user-tried examples: a basic task manager and **reserveaset**, a restaurant-reservation app. The user's feedback is encouraging on basic feasibility, but does **not** establish production readiness. The task manager reportedly worked but was basic; the restaurant app had reservation-creation problems; both felt visually similar and unfinished. These are user reports, not independently reproduced checks. See [`GENERATED_APP_EVALUATION.md`](GENERATED_APP_EVALUATION.md) for exact boundaries and quality goals.

The user summarized the stack across the examples as React + Node/Express + SQLite, while also describing the first task manager as having no database. Keep that ambiguity visible; do not attribute a specific stack to that instance without confirmation.

## Next product-quality priorities

1. Raise the generated visual-design bar so applications have a polished, domain-specific identity rather than a shared rustic/default CRUD appearance. Keep the existing i18n, accessibility, and dark/light baseline.
2. Improve task-specific planning and review for complete journeys. For **reserveaset**, capture exact reservation-creation reproduction steps before diagnosing or changing the app; confirm actual date/time, capacity, conflict and persistence rules with the approved requirements.
3. Add meaningful generated-app acceptance coverage once authorized. Distinguish static source review from tests and manual browser verification; a completed ZIP alone is not evidence of runtime correctness.
4. Re-verify the builder after the latest project-name download, workflow-progress, and navigation-retention UI changes. The last authorized run (66/66 tests plus successful build) predates those changes.

## Current product directions

1. **Builder v2:** source implementation for Describe → Proposal → Generate → Download with React/Express/SQLite and browser-localStorage templates. A prior October 20 Task Manager generation later required packaging recovery after Windows denied a directory rename. Successful source packaging still does not establish runtime-tested application behavior.
2. **Browser-only Task Manager rescue:** standalone source in `generated-projects/1339ea5d-1869-49c2-8b6a-252e90168a58/browser-app/`. Matches the original no-server, browser-storage brief; manual runtime verification remains pending.
3. **Browser-only generation:** new contract/template, planner selection, brief compatibility guard, static review, and source-only tests have been added. The path has not yet been validated by authorized test execution or a real generated-app run. Do not silently retrofit an approved fullstack workflow.

## Completed in source

- Project persistence with plans, revisions, approvals, events, and workflow snapshots.
- Approval binding to revision and content hash; generation also binds contract/template hashes.
- Managed output directories and constrained worker adapter; independent frontend/backend attempts, integration, static analysis, independent review, selective correction, bounded ZIP.
- Builder English/Spanish UI and light/dark baseline; mandatory for generated apps.
- Browser-only rescue app with local storage, task CRUD subset from the original brief (create, toggle, filter, delete), optional date, EN/ES, and light/dark source.
- Windows-safe artifact-publication fallback, project-name ZIP downloads, generation workflow milestones, and completion-step retention.

## Pending work

- The user chose browser-only generation for explicit no-server/browser-storage briefs. Create a new plan revision and approval for the existing Task Manager project; the old fullstack approval stays historical.
- Resolve the reviewer/template prompt ambiguity without suppressing real template defects; address frontend findings if fullstack source is reused.
- With explicit authorization, run actual tests/builds where appropriate and record commands, exit codes, output, and browser observations. No such validation was performed during the browser-app rescue.
- Validate the new browser-only generator path and its output only after explicit authorization. Maintain i18n, themes, security, and recovery guarantees.
- Design export/backup if users will rely on browser-only task data long-term.
- Improve visual and domain-workflow quality based on user evaluation; no reserveaset failure has yet been reproduced in this repository.
- Re-run tests/build after the latest source changes only with explicit authorization; separately authorize and record any generated-app runtime testing.

## Evidence policy

A generated ZIP is statically reviewed source, not a tested product. Agent summaries are not test results. A final `app` directory is distinct from retained attempts. Old implementation notes must not override current workflow state; see the incident report and read-only SQLite snapshot for the October 20 failure.
