# Repository Guidelines

## Project Structure & Module Organization
- `src/` hosts the Node services; `src/server/` exposes the Express+Socket.IO web API and Deep Dive terminal, `src/recipes/` orchestrates agent recipes.
- `bin/` contains CLI entry scripts (`wingman`, `wingman-web`) used by npm scripts; keep them executable.
- `lib/` holds shared utilities (auto setup, triggers, persistence); update adjacent tests when touching these.
- `public/` serves the static web UI; images and assets live here.
- Long-running automation sits under `scheduler/`; helper tools belong in `scripts/`. Tests live in both `tests/` (runtime scenarios) and `__tests__/` (unit/database helpers).

## Build, Test, and Development Commands
- `npm run setup` scaffolds `~/.wingman` config; rerun with `--force` after changing secrets or recipe schemas.
- `npm start` runs the scheduler-aware server; for CLI-only workflows use `npm run cli`.
- `npm run web` launches the web UI with terminal bridge; add `:no-scheduler` variants when debugging scheduler-free.
- `npm run scheduler` executes cron-driven tasks in isolation.
- `npm test` runs Jest suites across `tests/` and `__tests__/`; append `-- --watch` during iterative work.

## Coding Style & Naming Conventions
- Code is CommonJS JavaScript targeting Node 18; prefer 2-space indentation and single quotes, matching existing files.
- Organize modules by feature (session, recipes, mcp); new shared helpers belong in `lib/` with descriptive camelCase filenames.
- Format changes with Prettier: `npx prettier --write "src/**/*.js" "lib/**/*.js"` before pushing.
- Keep environment-sensitive constants in ALL_CAPS and load them via `dotenv` to mirror current patterns.

## Testing Guidelines
- Use Jest with async-friendly helpers; place unit specs next to the runtime they're covering (`__tests__/database-archive.test.js` etc.).
- Name specs `*.test.js` and group integration flows in `tests/` to mirror existing coverage.
- Seed data through the recipes or `data/` fixtures rather than mocking file IO directly.
- Update or create scheduler tests when extending cron jobs; stub external shells to keep runs deterministic.

## Commit & Pull Request Guidelines
- Follow the existing concise, present-tense style (`fix cli`, `tasks and projects`); keep subject ≤ 72 chars and avoid trailing punctuation.
- Each PR should describe intent, flag schema/config changes, and list the verification commands you ran.
- Link relevant issues or recipes, and attach CLI or UI screenshots when altering user-visible behavior.
- Ensure migrations or setup changes mention impacts on `~/.wingman`, and include rollback steps when possible.

## Configuration & Security
- Secrets live in `~/.wingman/.env`; never commit personal keys. Use template placeholders in shared configs.
- Rotate generated SQLite artifacts with `npm run clean` and commit only sanitized fixtures under `data/`.
