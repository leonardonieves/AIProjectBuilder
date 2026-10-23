# AI Project Builder
Independent demonstration project. Never read or import sibling projects or client data.
No builds, tests, lint, dependency installations or deployments without explicit user authorization.
Do not claim multi-agent execution until real independent agent runs have evidence.
Do not claim tests passed from an agent narrative: require actual command, exit code and output.
Plan changes invalidate approval. Approval is tied to a revision and content hash.
Never allow browser-supplied shell commands or arbitrary output directories.
Write new code, identifiers, comments, and documentation in English. Spanish is allowed only where required for Spanish UI translation catalogs or preserved historical/user content; do not translate persisted evidence.

## Mandatory baseline for every new application
- Every application created from scratch MUST include i18n and both dark/light themes. Never omit these requirements from planning, implementation, review, tests or documentation.
- Centralize user-facing strings in translation catalogs, including labels, placeholders, accessibility text, validation, empty states and errors. Do not hard-code new UI strings.
- Provide language/theme selectors, persist preferences safely, and localize dates/numbers. Both themes must remain readable and keyboard accessible.
- AIProjectBuilder supports English and Spanish; English is the default on first use (do not infer Spanish from browser locale). Preserve the user's saved choice.
- Apply the same English/Spanish and theme baseline to generated apps unless the user explicitly requests different languages. i18n and dark/light support remain mandatory.
- Never translate or rewrite persisted user content, plans, evidence or approvals just because the interface language changed. Historical source text may retain its original language.
- Maintain this baseline throughout all future development, including new agent screens and planner prompts. Existing plans need a new revision and approval to incorporate these requirements.
