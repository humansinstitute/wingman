# Wingman Restructure Plan

This document describes a pragmatic restructuring of the repository to make it easier for new users to understand, install, and contribute. It also sets us up for a future Bun-compatible build without committing to a big-bang rewrite.

## Goals
- Reduce root clutter: only a handful of top-level files remain.
- Single obvious entry points for server and CLI.
- Consolidate implementation under `src/` (server, CLI, wrappers, shared libs).
- All runtime artifacts live under `~/.wingman` (config, sessions, logs, cache, tmp).
- Preserve Deep Dive terminal workflow and `wingman-cli` usability.
- Keep Node today; be Bun-ready tomorrow.

## Principles
- Prefer clear, shallow directories over many small files at root.
- Make the “golden path” obvious: README → install → start server → use CLI.
- Keep compatibility shims lightweight and time-bound.
- Document just enough; delete outdated docs.

## Target Top-Level Layout
- `README.md` — Quickstart + Repo Map + Debugging.
- `package.json` — Minimal scripts; future `bunfig.toml` alongside.
- `.env.example` — Only runtime flags (not secrets).
- `public/` — Static assets (Deep Dive terminal, icons, manifest, CSS).
- `src/` — All implementation code (details below).
- `bin/` — Thin entrypoints (Node today; Bun later) wired via `package.json#bin`.
- `scripts/` — Dev/ops scripts (no business logic).
- `examples/` — Minimal demos (menu, sample recipes/configs).
- `docs/` — Short, up-to-date docs only.
- `ZZ_Archive/` — Kept-but-not-used assets (as last resort).

Root stays clean: no miscellaneous JS, no legacy markdowns, no logs or temp JSONs checked in.

## Target `src/` Layout
- `src/server/`
  - `http/` — Express/Fastify routes and socket handlers (REST + WS).
  - `managers/` — `multi-session-manager`, `server-config-manager`, etc.
  - `adapters/` — process spawn, env injection, logging transports.
  - `index.ts` — `createServer()` and route registration.
- `src/cli/`
  - `tmux/` — tmux config helpers and bindings.
  - `commands/` — `start`, `menu`, `paste`, etc.
  - `index.ts` — CLI bootstrap and argument parsing.
- `src/wrappers/`
  - `session-aware-wrapper.ts` — default wrapper.
  - `sub-recipe-wrapper.ts` — sub_recipe-aware wrapper.
  - `index.ts` — factory/selector for wrappers.
- `src/shared/`
  - `types/` — `Sessions`, `Message`, config schemas.
  - `config/` — load/merge/validate; source of truth for `WINGMAN_HOME`.
  - `logger/` — env-gated logs; payload preview truncation.
  - `utils/` — small cross-cutting helpers.
- `src/mcp/`
  - `registry.ts` — server-config-manager-backed registry.
  - `builtin/` — descriptors for builtin servers.
- `src/web/`
  - `api-client/` — fetch client shared by web/CLI.
  - `deep-dive/` — terminal JS that calls the API.
- `src/index.ts` — top-level exports (server + cli factories).

## Persistent Data (only under `~/.wingman`)
- Respect `WINGMAN_HOME` (defaults to `~/.wingman`).
- Structure:
  - `~/.wingman/config/` — user config, defaults, and MCP registry entries.
    - `settings.json`
    - `servers/` — MCP server definitions
  - `~/.wingman/sessions/` — active + archived conversation state
  - `~/.wingman/logs/` — opt-in debug/runtime logs
  - `~/.wingman/cache/` — recipe caches and artifacts
  - `~/.wingman/tmp/` — ephemeral files
  - `~/.wingman/secrets.enc` — optional encrypted secrets
- Env flags:
  - `WINGMAN_HOME` — base directory for persistence
  - `WINGMAN_DEBUG=1` or `LOG_LEVEL=debug` — enable verbose logging

No logs or temp JSONs should be produced inside the repo directories.

## Entrypoints (Node today, Bun later)
- `bin/wingman` → `node dist/cli/index.js`
- `bin/wingman-server` → `node dist/server/index.js`
- `bin/wingman-web` → starts server and serves `public/`

Package.json `bin` mappings:
- `"wingman": "bin/wingman"`
- `"wingman-server": "bin/wingman-server"`

These shims stay Node/Bun-neutral so we can swap `node` → `bun` later.

## Recommended NPM Scripts
- `dev:server` — start server in watch mode (ts-node/nodemon or bun dev later)
- `dev:web` — server + static `public/`
- `build` — `tsc` (today) or `bun build` (future)
- `servers:init` — seed `~/.wingman/config/servers/*`
- `clean` — remove `dist/` and `~/.wingman/tmp/*`
- `clean:artifacts` — prune temp JSONs, local logs, caches under `WINGMAN_HOME`

## API Convergence
- Prefer `/api/sessions/*` for new features.
- Keep `/api/goose/*` as a thin compatibility shim that delegates to the multi-session manager.
- Gate noisy payload logs behind env flags and truncate previews.

## Incremental Migration Plan (Checklists)

Phase 1 — Create structure and move code
- [ ] Create `src/server`, `src/cli`, `src/wrappers`, `src/shared`, `src/mcp`, `src/web`.
- [ ] Move server code to `src/server/*` (routes → `http/`, managers → `managers/`).
- [ ] Move wrappers to `src/wrappers/*` and expose a single factory.
- [ ] Move CLI code to `src/cli/*` (+ `tmux/` where applicable).
- [ ] Move shared libs to `src/shared/*` (types, config, logger, utils).
- [ ] Update imports to the new locations (no path aliases yet).

Phase 2 — Entrypoints and scripts
- [ ] Add `bin/wingman`, `bin/wingman-server`, `bin/wingman-web` shims.
- [ ] Map them in `package.json#bin`.
- [ ] Update `npm run web` (or add) to call `wingman-web`.
- [ ] Verify `npm run web` still runs the server.

Phase 3 — Persistence cleanup
- [ ] Centralize resolution of `WINGMAN_HOME` in `src/shared/config`.
- [ ] Audit file reads/writes; route all persistence to `WINGMAN_HOME`.
- [ ] Add `scripts/migrate/move-old-artifacts.js` to relocate stray `logs/*.log` and `temp/*.json` into `~/.wingman`.
- [ ] Ensure no repo-relative logs or temp files are created during normal runs.

Phase 4 — Docs and examples
- [ ] Update `README.md` with Repo Map, Quickstart, Debugging (WINGMAN_DEBUG, log locations).
- [ ] Keep Deep Dive terminal under `public/`; confirm mobile-friendly paste overlay is documented.
- [ ] Move example `menu.sh` → `examples/menu.sh` and reference it.
- [ ] Remove outdated long-form docs; keep short, focused pages under `docs/`.

Phase 5 — Clean up and archive
- [ ] Remove abandoned root files (`*.backup`, legacy `*-claude.*`, duplicated docs).
- [ ] Move only must-keep references into `ZZ_Archive/` with a README explaining why.
- [ ] Add `npm run clean` and `clean:artifacts` to prune caches and tmp.

## Compatibility and Stability Notes
- Keep `wingman-cli` behavior unchanged aside from import paths.
- Maintain `/api/goose/*` as a shim until consumers migrate to `/api/sessions/*`.
- Simplify tmux config (copy/paste stability) but avoid disruptive keybinding changes.

## Bun-Ready Guidance
- Use ESM-only (`"type": "module"`), avoid CJS-only patterns.
- Prefer APIs that work in Node and Bun:
  - `fetch` (Node 20+ global or `undici`), `ws` for WebSocket.
  - `child_process.spawn` or a Bun-compatible wrapper.
- Build strategy:
  - Today: `tsc` to `dist/`.
  - Tomorrow: `bun build src/server/index.ts --outfile dist/server.js` (and similar for CLI).
- No require hooks; import JSON via `fs`.
- Use URL-safe path handling (`URL`, `fileURLToPath`).

## Clean-Up Targets (common offenders)
- Root `*.backup`, `*-claude.*`, old overlapping docs.
- Helper scripts living at root → move to `scripts/` and gate with `WINGMAN_DEBUG`.
- Replace duplicate `/api/goose/*` code paths with shims that delegate to session manager.

## Onboarding Improvements
- README sections:
  - Install (Node 20+ or Bun), Quickstart (two commands), Deep Dive terminal usage.
  - Config & Data (points to `~/.wingman` and `WINGMAN_HOME`).
  - Debugging (`WINGMAN_DEBUG=1`, log locations, how to tail logs).
  - Repo Map mirroring this structure.
- Examples:
  - `examples/menu.sh` minimal.
  - `examples/recipes/*.json` tiny, runnable.

## Verification Checklist (post-migration)
- [ ] `npm run web` serves the app and websockets connect.
- [ ] CLI starts, sends/receives messages, and copy/paste works in tmux.
- [ ] Logs only appear under `~/.wingman/logs/` when `WINGMAN_DEBUG=1`.
- [ ] No files are written into the repo during normal use.
- [ ] `/api/sessions/*` endpoints work; `/api/goose/*` shims still respond.

## Appendix A — Example Trees

Proposed top-level tree:

```
.
├── README.md
├── package.json
├── public/
├── src/
│   ├── server/
│   │   ├── http/
│   │   ├── managers/
│   │   ├── adapters/
│   │   └── index.ts
│   ├── cli/
│   │   ├── tmux/
│   │   ├── commands/
│   │   └── index.ts
│   ├── wrappers/
│   ├── shared/
│   │   ├── types/
│   │   ├── config/
│   │   ├── logger/
│   │   └── utils/
│   ├── mcp/
│   ├── web/
│   │   ├── api-client/
│   │   └── deep-dive/
│   └── index.ts
├── bin/
├── scripts/
├── examples/
├── docs/
└── ZZ_Archive/
```

`~/.wingman` tree (default `WINGMAN_HOME`):

```
~/.wingman/
├── config/
│   ├── settings.json
│   └── servers/
├── sessions/
├── logs/
├── cache/
├── tmp/
└── secrets.enc
```

## Appendix B — Minimal Old → New Mapping (to refine during move)
- `server.js` → `src/server/index.ts` (+ split routes/managers accordingly)
- `wingman-cli.js` → `src/cli/index.ts` (tmux helpers → `src/cli/tmux/*`)
- `session-aware-goose-wrapper.js` → `src/wrappers/session-aware-wrapper.ts`
- `sub-recipe-aware-wrapper.js` → `src/wrappers/sub-recipe-wrapper.ts`
- `shared-state.js` / common helpers → `src/shared/*`
- Legacy MCP registry → `src/mcp/registry.ts` with `server-config-manager` backend
- Deep Dive JS → `src/web/deep-dive/*` (served from `public/`)

(Adjust specific filenames as we move; keep PRs focused and reviewable.)

---

Use this document as the living source of truth during the restructure. Update checkboxes as tasks complete, and trim sections that no longer apply once the migration is done.
