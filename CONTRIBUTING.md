# Contributing to Priority Mail

## Getting Started

1. Clone the repository
2. Follow the local setup instructions in `DEVELOPMENT.md`
3. Read `ARCHITECTURE.md` and `DECISIONS.md` before making significant changes

---

## Branching

| Branch pattern | Purpose |
|---|---|
| `main` | Stable, production-ready state |
| `dev` | Integration branch for features, reflects next release |
| `feature/<name>` | New features, branched from `dev` |
| `fix/<name>` | Bug fixes |
| `chore/<name>` | Refactors, dependency updates, tooling |

Always branch off `dev`. Keep branches short-lived.

---

## Commit Messages

Use the following prefixes:

| Prefix | Use for |
|---|---|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `refactor:` | Code changes with no behavior change |
| `chore:` | Dependencies, tooling, config |
| `docs:` | Documentation only |
| `test:` | Adding or updating tests |

Example: `feat: add confidential email routing to local AI`

---

## Pull Requests

- Keep PRs focused — one logical change per PR
- Include a clear description of what changed and why
- Update the relevant documentation files (see `DEVELOPMENT.md` for which docs to update)
- Add an entry to `CHANGELOG.md` under `[Unreleased]`
- Do not merge your own PR without review (when working in a team)

---

## Code Style

- TypeScript strict mode is enabled — do not use `any` unless unavoidable
- Prefer explicit types over inferred types for public interfaces
- Keep files focused — one concern per file
- Follow the existing patterns in each package (see `ARCHITECTURE.md`)

---

## Adding Rules to the Rules Engine

Rules in `connectors/gmail/src/rules-engine.ts` run before any AI call:

1. Add the new rule in the `applyRules` function following the existing pattern
2. Rules run in order — place higher-confidence rules earlier
3. Always set `confidence` (0.0–1.0), `skip_ai`, and `local_ai_only` on the result
4. Add a meaningful `rule_fired` string that identifies the rule in logs and the DB
5. Never route 2FA/OTP/security emails to AI — add them to `SECURITY_SENDER_DOMAINS` or extend `SECURITY_SUBJECT_RE`
6. Update `KNOWN_ISSUES.md` if the rule has known edge cases

---

## Adding AI Categories

Categories are defined in two places:

1. `Category` type in `connectors/gmail/src/rules-engine.ts`
2. `validCategories` array in `connectors/gmail/src/ai-classifier.ts`
3. The system prompt in `ai-classifier.ts`

All three must be kept in sync.

---

## Environment Variables

Never commit `.env` files. Always update `.env.example` when adding new variables, with a comment explaining what they do.

---

## Testing

There is no automated test suite yet (see `KNOWN_ISSUES.md`). When making changes:

- Run the connector locally against a real inbox: `npm run dev` in `connectors/gmail/`
- Verify `output/triaged.json` looks correct
- Start the full stack and confirm the dashboard renders: `docker compose up -d postgres backend frontend`
