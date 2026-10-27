# Known Issues

Findings from the repository scan on 2026-10-27. Status values: `Open` · `In progress` · `Done` · `Deferred`.

| # | Issue | Priority | Status | Notes |
|---|---|---|---|---|
| 1 | No tests, front or back | High (before improvements) | Done | Vitest: 51 tests for `geometry.ts`, `plan.ts`, `migrate.ts`. Pytest: 9 API tests on in-memory SQLite. UI components are still untested |
| 2 | Containers run dev servers (`uvicorn --reload`, `vite dev`); DB credentials `kitchen/kitchen` hardcoded | High (before deploy) | Open | Needs a production compose: built frontend served statically, uvicorn without reload, secrets from env |
| 3 | No authentication: anyone reaching port 8000 can read/delete all projects | High (before deploy) | Open | Approach depends on who uses the app (private vs. public, single vs. multi-user) |
| 4 | No DB migrations (`create_all`, no Alembic) | Medium | Open | Fine until the table itself changes (e.g. adding an owner column for #3); project data is JSONB with client-side upgrades via `migrate.ts` |
| 5 | Postgres port 5432 published to the host | High (before deploy) | Open | On a VM this exposes the database to the internet |
| 10 | No HTTPS / reverse proxy | High (before deploy) | Open | Needed for a web app on a VM (e.g. Caddy with automatic TLS) |
| 11 | No database backups | Medium | Open | All projects live in the `pgdata` volume on one VM |
| 12 | No CI pipeline | Medium | Open | GitHub Actions: tests, typecheck, lint; deploy step later |
| 6 | No lint/format tooling (ESLint, Prettier, Ruff) | Medium | Done | ESLint, Prettier and Ruff configured; whole codebase formatted; lint passes (warnings tracked in #9) |
| 7 | Data model duplicated in `frontend/src/types.ts` and `backend/app/schemas.py` with nothing keeping them in sync | Medium | Done | `tsc` fails on drift (`src/lib/schemaSync.ts` vs types generated from OpenAPI); pytest fails if the generated schema is stale. Steps in README |
| 8 | Spec file named `.CLAUDE`, so Claude Code doesn't load it automatically | Low | Done | Renamed to `CLAUDE.md`, README updated (not committed yet) |
| 9 | 7 ESLint `react-refresh` warnings: component files also export helpers, so editing them reloads the full page instead of hot-swapping | Low | Open | Dev experience only; move the helpers into `lib/` when touching those files |

## Change log

- 2026-10-27: File created. #8 moved to In progress after the rename to `CLAUDE.md`.
- 2026-10-27: #1, #7, #8 Done. #6 In progress (tooling in place, reformat pending). Added #9 from the new lint run. Also fixed a type bug in `migrate.ts` (`LegacyWall` required `depth` on legacy items) found while writing tests.
- 2026-10-27: Plan is to deploy on a VM as a web app. #2, #3, #4, #5 moved from Deferred to Open (#2, #3, #5 block deployment). Added #10 HTTPS, #11 backups, #12 CI.
- 2026-10-27: Decision: build features first, then the deployment work (#2–5, #10–12).
- 2026-10-27: #6 Done: existing code reformatted with Prettier and Ruff; all tests, typecheck, lint and build pass.
