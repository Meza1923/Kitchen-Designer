# Issues and Questions

Three sections, each with its own owner:

- **Open questions:** the developer (Claude) asks, the reviewer (Gemini) adds a second opinion, the product owner decides, and the reviewer writes down the decision. Status: `Awaiting owner` → `Decided` → `Applied` (applied by the developer).
- **Review findings:** the reviewer logs them, and the developer fixes or answers them. Status: `Open` · `Fixed` · `Won't fix` (with a reason) · `Owner to decide`.
- **Known issues:** bugs and tech debt, logged by either agent. Status: `Open` · `In progress` · `Done` · `Deferred`.

## Open questions

| Q# | Question | Options | Developer recommends | Reviewer view | Owner decision (date) | Status |
|---|---|---|---|---|---|---|

## Review findings

| R# | Feature / branch | Severity | File:line | Finding and failure scenario | Developer response | Status |
|---|---|---|---|---|---|---|

## Known issues

Findings from the repository scan on 2026-10-27.

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

### UI review (2026-10-27)

Found by driving the app in a browser: adding every element type, dragging, the Inspector, the problems list and filler fixes, undo/redo, all views, save/load, wall and island management, room resizing, and exports.

| # | Issue | Priority | Status | Notes |
|---|---|---|---|---|
| 13 | Adding an element when there's no free slot drops it at X 0, on top of whatever is there, with no message | High | Open | Seen with cabinets added to a full wall, and with a window added over wall cabinets. It contradicts the palette hint "new elements go into the first free slot". `findFreeX` falls back to 0. |
| 14 | Shrinking the room squeezes cabinets on top of each other without warning | High | Open | Room width 400 → 100: two 60 cm cabinets were clamped into 100 cm and overlap by 20 cm. The island is left outside the room. |
| 15 | A filler added by a fix next to a fridge or tall cabinet is base-height (87 cm), and gets its own countertop sliver | High | Open | R2 fix on Wall B: a 10 cm filler between the wall and a 185 cm fridge, with a "COUNTERTOP 10" slab on it. The filler should match the height of the unit it serves, and a filler with no base unit beside it shouldn't carry a countertop. |
| 16 | The project-wide problems list is hard to find and mislabelled | Medium | Open | It shows only when nothing is selected, but every newly added element is auto-selected, so it's usually hidden. It sits under the heading "Wall A · Schedule" although it covers the whole project. The red and amber counts have no labels. |
| 17 | R14 "wall to wall" fires, with a fix button, on a run whose cabinets overlap | Medium | Open | After a room shrink, overlapping cabinets counted as "wall to wall". The scribe fix would narrow a cabinet in an already broken run. |
| 18 | Load dialog: clicking a project's name does nothing; only the small "Open" button loads it | Medium | Open | The whole row highlights on hover, so it looks clickable. |
| 19 | Auto-placement puts the sink and cooktop side by side | Medium | Open | Adding a sink, then a cooktop, puts them on neighbouring cabinets, which immediately triggers R7 (sink-to-cooktop) and R17 (triangle). Placement could keep the clearances the rules ask for. |
| 20 | The ✕ on a wall tab removes the wall, but looks like "close tab" | Medium | Open | It asks for confirmation and offers "Restore Wall A", so nothing is lost. But next to the rename pencil, ✕ reads as closing the view. |
| 21 | An island shows no front side in the plan | Low | Open | It's a plain dashed rectangle, so you can't tell which way its cabinets will face before adding them. |
| 22 | Applying one fix gives no feedback | Low | Open | The problem disappears from the list, but nothing is selected or highlighted, so it's unclear what changed. "Add all" shows a message; a single fix doesn't. |
| 23 | The 3D view's side panel only offers doors/drawers | Low | Open | No Inspector and no problems list in 3D. Clicking a fridge or tall unit does nothing. |
| 24 | "Save to DB" is developer wording | Low | Open | "Save" or "Save project" is clearer for designers and clients. |

Checked and working: dragging (with live red overlap feedback), Inspector width/position edits, Delete, undo/redo, the R2 one-click filler (adds the filler, shifts the fridge, clears the problem), save and load, removing and restoring a wall, adding an island, PNG export (elevation or plan, matching the view), Print/PDF and JSON export. No console errors in any session.

## Change log

- 2026-10-27: File created. #8 moved to In progress after the rename to `CLAUDE.md`.
- 2026-10-27: #1, #7, #8 Done. #6 In progress (tooling in place, reformat pending). Added #9 from the new lint run. Also fixed a type bug in `migrate.ts` (`LegacyWall` required `depth` on legacy items) found while writing tests.
- 2026-10-27: Plan is to deploy on a VM as a web app. #2, #3, #4, #5 moved from Deferred to Open (#2, #3, #5 block deployment). Added #10 HTTPS, #11 backups, #12 CI.
- 2026-10-27: Decision: build features first, then the deployment work (#2–5, #10–12).
- 2026-10-27: #6 Done: existing code reformatted with Prettier and Ruff; all tests, typecheck, lint and build pass.
- 2026-10-27: UI review in a real browser (Playwright with the local Chrome, against an isolated copy of the app with an empty SQLite DB). Added #13–#24.
- 2026-11-06: Split into Open questions (developer asks, reviewer records the owner's decision), Review findings (reviewer → developer) and Known issues. Roles defined in `CLAUDE.md` / `GEMINI.md`; spec moved to `PROJECT.md`.
