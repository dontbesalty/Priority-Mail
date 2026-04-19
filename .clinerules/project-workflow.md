# Project Workflow Rules

## Project Documentation Rules

At the start of every task:

- Read `README.md`
- Read `CHANGELOG.md`
- Read `CONTRIBUTING.md`
- Read `DECISIONS.md`
- Read `ROADMAP.md`
- Read `ARCHITECTURE.md`
- Read `DEVELOPMENT.md`
- Read `API.md`
- Read `DATABASE.md`
- Read `DEPLOYMENT.md`
- Read `SECURITY.md`
- Read `INTEGRATIONS.md`
- Read `KNOWN_ISSUES.md`

Before making any code changes:

- Determine which of the above documents are affected
- Follow existing architecture, coding, API, and deployment patterns
- Do not introduce new behavior that conflicts with `DECISIONS.md`, `ROADMAP.md`, or `ARCHITECTURE.md`
- Reuse existing conventions whenever possible

After making changes, update documentation as needed:

- Update `README.md` for setup, usage, features, configuration, or user-visible changes
- Update `CHANGELOG.md` for every meaningful feature, fix, refactor, breaking change, or security update
- Update `CONTRIBUTING.md` if the development workflow, branching, commit rules, or contribution process changes
- Update `DECISIONS.md` when a significant architectural or technical decision is made or changed
- Update `ROADMAP.md` when project priorities, planned features, or milestones change
- Update `ARCHITECTURE.md` when the structure, components, or data flow changes
- Update `DEVELOPMENT.md` when local setup, scripts, tools, or developer workflow changes
- Update `API.md` when endpoints, request/response formats, auth, or integrations change
- Update `DATABASE.md` when schema, migrations, storage strategy, or DB requirements change
- Update `DEPLOYMENT.md` when infrastructure, environments, CI/CD, or rollout process changes
- Update `SECURITY.md` when auth, permissions, secrets, encryption, or security processes change
- Update `INTEGRATIONS.md` when external APIs, connectors, plugins, or third-party systems change
- Update `KNOWN_ISSUES.md` when new limitations, bugs, technical debt, or unresolved issues are identified

Documentation rules:

- Keep documentation concise and up to date
- Only modify the sections affected by the change
- Do not rewrite entire files unless necessary
- Keep examples accurate and consistent with the codebase
- Prefer small, focused documentation updates over large rewrites

Before completing a task:

- Verify all changed code matches the documentation
- Verify all affected documentation files were updated
- Add a clear entry to `CHANGELOG.md`
- Summarize:
  - files changed
  - why they changed
  - any remaining risks or follow-up work