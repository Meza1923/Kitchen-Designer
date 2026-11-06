# Issues and Questions

Three sections, each with its own owner:

- **Open questions:** the developer (Claude) asks, the reviewer (Gemini) adds a second opinion, the product owner decides, and the reviewer writes down the decision. Status: `Awaiting owner` → `Decided` → `Applied` (applied by the developer).
- **Review findings:** the reviewer logs them, and the developer fixes or answers them. Status: `Open` · `Fixed` · `Won't fix` (with a reason) · `Owner to decide`.
- **Known issues:** bugs and tech debt, logged by either agent. Status: `Open` · `In progress` · `In review` (fixed on a branch, waiting for review) · `Done` · `Deferred`.

## Open questions

| Q# | Question | Options | Developer recommends | Reviewer view | Owner decision (date) | Status |
|---|---|---|---|---|---|---|

## Review findings

| R# | Feature / branch | Severity | File:line | Finding and failure scenario | Developer response | Status |
|---|---|---|---|---|---|---|
| R1 | #7 Shelves (`82a9ec9`) | Medium | `frontend/src/lib/geometry.ts:162` | `computeGaps(wall, 'upper')` sorts all upper-layer items along 1D `x` without checking vertical overlap. Input: `upper_cabinet` at `x=0, w=60, y=145, h=70` and `shelf` at `x=65, w=80, y=115, h=4` (26 cm apart vertically, `canCollide` is `false`). Wrong result: reports a false `! GAP: 5.0 cm (<10cm)` (`narrow_gap` warning). Also, stacking two `shelf` items at the same X (`x=10, w=80, y=140` and `y=180`) only checks side-wall gaps for the first shelf's height band. | Fixed on `fix/13-15-placement`. Upper-layer gaps are now measured per item, only against neighbours that overlap it in height and against the walls (`computeGaps`, `lib/geometry.ts`). The reviewer's case (cabinet at 145, shelf at 115) gives no warning; stacked shelves each get their own side gaps, reported once. Two wall cabinets 5 cm apart still warn. Tests in `lib/shelves.test.ts`. | Fixed |
| R2 | #7 Shelves (`82a9ec9`) | Medium | `frontend/src/components/Inspector.tsx:525`, `frontend/src/components/FrontsPanel.tsx:36` | Switching a cabinet to `'open'` sets `shelfCount` to `1` (base) or `2` (upper) when `shelfCount === undefined`, and switching back to `'doors'` leaves that `shelfCount` on the item instead of restoring the default `0`. Input: click `Open` then `Doors` on a default cabinet (especially in 3D `FrontsPanel`, which has no `Shelves inside` control). Wrong result: the cabinet with doors silently retains 1–2 internal shelves in Elevation and the export schedule. In addition, `FrontsPanel.tsx:45` shows no `Shelves inside` (0–5) selector when `frontType === 'open'` in 3D. | Fixed the missing control: the 3D panel (`FrontsPanel`) now has **Shelves inside (0–5)** for Doors and Open. Kept on purpose: switching Open → Doors keeps the shelves. The shelves belong to the cabinet body, so adding doors doesn't remove them. They stay visible (dashed in the elevation, listed in the schedule) and are editable in both panels. Owner can overrule. | Fixed |
| R3 | #7 Shelves (`82a9ec9`) | Low | `frontend/src/components/ItemShape.tsx:46`, `frontend/src/lib/scene3d.ts:410` | Shelf brackets are drawn below `y` (`Math.max(5, Math.min(ob.w * 0.12, 4 * S))` px in 2D elevation and `Math.min(12, d * 0.5)` = 12 cm below `y0` in 3D), but `itemBounds`, `clampY`, and `canCollide` only account for the 4 cm board `[y, y + height]`. Input: select or flag a `shelf` in Elevation, or set `shelf` to `y=0` (or directly on top of a window/cabinet at `y = other.y + other.height`). Wrong result: the selection/warning outline cuts through the brackets in 2D, and the brackets protrude below the floor or into the item below in 2D/3D without collision. | Fixed by changing the drawing: the open wall shelf is now a **floating shelf on concealed fixings**, so nothing is drawn outside its outline in the elevation or in 3D. Its outline, collisions and selection frame all match. Recorded as an Implementation Assumption in `PROJECT.md`. | Fixed |
| R4 | #7 Shelves (`82a9ec9`) | Low | `frontend/src/lib/geometry.ts:46`, `frontend/src/lib/geometry.ts:297` | `shelf` ("Open Wall Shelf") is not in `isWallMounted` (`geometry.ts:46`) or `computeSocketIssues` (`geometry.ts:297`). Input: add or move an `Open Wall Shelf` onto an Island, or place a `shelf` at `y=110, h=4` across a socket (`y=106..114`). Wrong result: in 3D the wall-bracketed shelf floats in mid-air at `y=150 cm` above the island with no wall behind it; on a wall, the shelf board/brackets intersect the socket plate without flagging `SOCKET HIDDEN`. | Fixed. New `isWallOnly` (`lib/geometry.ts`) = wall-mounted items + open wall shelves. It is used to refuse adding a shelf to an island and to hide islands in the Inspector's Wall / run list. It is not `isWallMounted`, because the 3D builder skips wall-mounted items and the shelf would disappear. `computeSocketIssues` now treats a shelf over a socket as **SOCKET HIDDEN**. Tests in `lib/shelves.test.ts`. | Fixed |
| R5 | #14 Room resize (`fix/13-15-placement`) | Medium | `frontend/src/lib/plan.ts:168`, `frontend/src/lib/plan.ts:213` | `fitToLength` shifts all `'upper'` layer items (`upper_cabinet`, `shelf`, `window`, `door`) using a single 1D `limit`, ignoring vertical separation (`canCollide`). Input: on a 400 cm wall, place an `upper_cabinet` at `x=200, w=60, y=145, h=70` and a `shelf` below it at `x=200, w=80, y=115, h=4` (stacked vertically, no collision), then shrink the room width to 260 cm. Wrong result: the shelf shifts to `x=180` (`limit=180`) and pushes the upper cabinet from `x=200` to `x=120` even though `x=200..260` is completely free at `y=145..215`. In addition, `roomChangeWarnings` computes `need` by summing widths per layer (`floor`, `upper`) separately: if a shrink causes a cross-layer collision (e.g. a 60 cm `fridge` pushed into a 120 cm `window` when shrinking a wall to 150 cm), the warning says `"Wall A becomes 150 cm, but its elements need 120 cm, so they will overlap"`. | Fixed. `fitToLength` (`lib/plan.ts`) now walks all floor and upper units together from the far end. Each unit stops only at the wall end or at the new position of a unit to its right that it can actually collide with (`canCollide`, so it takes heights into account). Reviewer's case: the shelf moves to 180 and the wall cabinet stays at 200. A tall unit and a window it collides with still push each other. The warning no longer quotes a summed "need" figure; it counts the elements that newly overlap, across layers: "Wall A becomes 150 cm: 2 of its elements no longer fit and will overlap." Tests in `lib/placement.test.ts`. | Fixed |
| R6 | #13 Placement (`fix/13-15-placement`) | Medium | `frontend/src/lib/geometry.ts:398`, `frontend/src/App.tsx:223` | When `findFreeX` returns `null` for a `counter` item (`sink`, `stove`, `water_bar`, `coffee_machine`), `widestGapX` searches all of `[0, wall.widthCm]` against only `layer === 'counter'` items, ignoring where countertops exist. Input: on a 400 cm wall with one 60 cm `base_cabinet` at `x=0` holding a `sink` (or on an empty wall with no base cabinets at all), click `+ Cooktop (Stove)`. Wrong result: `widestGapX` sees `x=60..400` (or `0..400`) as the widest free gap and places the cooktop in mid-air off the countertop (`NO COUNTERTOP`) while the notice says `"it was placed over other elements at X 60"` (or `X 0` on an empty wall). | Fixed. For counter items, `widestGapX` (`lib/geometry.ts`) searches only the countertop slabs, taking the widest stretch not used by other counter items, so the item stays on the countertop. The message tells the cases apart: "There is no countertop on Wall B for the Sink: add base cabinets first…" vs. "No free 60 cm of countertop on Wall A for the Stove…". Both messages checked in the running app; tests in `lib/placement.test.ts`. | Fixed |
| R7 | #15 Fillers (`fix/13-15-placement`) | Low | `frontend/src/lib/geometry.ts:83` | `counterBaseTop` checks `isCounterBearing(i.category)` (which includes `'filler'`) without `fillerCarriesCounter(wall, i)`. Input: add a 10 cm × 185 cm filler next to a fridge (via the R2 fix) and drag or place a counter item (`water_bar`, `coffee_machine`, or `sink`) so its centre `cx` is over the filler. Wrong result: `counterBaseTop` snaps `item.y` to `185 cm` (the top of the tall fridge filler instead of `DEFAULT_BASE_HEIGHT` 87 cm), floating the appliance at ceiling height in Elevation and 3D. | Fixed. `counterBaseTop` (`lib/geometry.ts`) now ignores fillers that don't carry the countertop (same rule as `computeCountertops`), so a water bar over the 185 cm fridge filler stays at 87 cm. Test in `lib/placement.test.ts`. | Fixed |

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
| 13 | Adding an element when there's no free slot drops it at X 0, on top of whatever is there, with no message | High | Done | Seen with cabinets added to a full wall, and with a window added over wall cabinets. It contradicts the palette hint "new elements go into the first free slot". `findFreeX` falls back to 0. |
| 14 | Shrinking the room squeezes cabinets on top of each other without warning | High | Done | Room width 400 → 100: two 60 cm cabinets were clamped into 100 cm and overlap by 20 cm. The island is left outside the room. Found during the fix: the room fields applied values while typing, so typing 1000 passed through 100 and squeezed everything permanently. |
| 15 | A filler added by a fix next to a fridge or tall cabinet is base-height (87 cm), and gets its own countertop sliver | High | Done | R2 fix on Wall B: a 10 cm filler between the wall and a 185 cm fridge, with a "COUNTERTOP 10" slab on it. The filler should match the height of the unit it serves, and a filler with no base unit beside it shouldn't carry a countertop. |
| 16 | The project-wide problems list is hard to find and mislabelled | Medium | Open | It shows only when nothing is selected, but every newly added element is auto-selected, so it's usually hidden. It sits under the heading "Wall A · Schedule" although it covers the whole project. The red and amber counts have no labels. |
| 17 | R14 "wall to wall" fires, with a fix button, on a run whose cabinets overlap | Medium | Open | After a room shrink, overlapping cabinets counted as "wall to wall". The scribe fix would narrow a cabinet in an already broken run. |
| 18 | Load dialog: clicking a project's name does nothing; only the small "Open" button loads it | Medium | Open | The whole row highlights on hover, so it looks clickable. |
| 19 | Auto-placement puts the sink and cooktop side by side | Medium | Open | Adding a sink, then a cooktop, puts them on neighbouring cabinets, which immediately triggers R7 (sink-to-cooktop) and R17 (triangle). Placement could keep the clearances the rules ask for. |
| 20 | The ✕ on a wall tab removes the wall, but looks like "close tab" | Medium | Open | It asks for confirmation and offers "Restore Wall A", so nothing is lost. But next to the rename pencil, ✕ reads as closing the view. |
| 21 | An island shows no front side in the plan | Low | Open | It's a plain dashed rectangle, so you can't tell which way its cabinets will face before adding them. |
| 22 | Applying one fix gives no feedback | Low | Open | The problem disappears from the list, but nothing is selected or highlighted, so it's unclear what changed. "Add all" shows a message; a single fix doesn't. |
| 23 | The 3D view's side panel only offers doors/drawers | Low | Open | No Inspector and no problems list in 3D. Clicking a fridge or tall unit does nothing. |
| 24 | "Save to DB" is developer wording | Low | Open | "Save" or "Save project" is clearer for designers and clients. |

#### Handoff: `fix/13-15-placement` (2026-11-06)

**#13 Placement when nothing fits:**
- `findFreeX` (`lib/geometry.ts`) returns `null` instead of 0 when there's no free slot.
- The app then places the element at the widest free gap (`widestGapX`), so it overlaps as little as possible. It selects the element and shows a message, for example "No free 60 cm space on Wall A for Base Cabinet: it was placed over other elements at X 340. Move or narrow it, or make room."
- The same applies to Duplicate.

**#14 Room resize:**
- The room Width, Depth and Ceiling fields apply on Enter or when leaving the field (new `commitOnBlur` option on `NumField`), not on every keystroke.
- When a wall gets shorter, `syncRoom` (`lib/plan.ts`) moves units back in order from the far end, only as far as needed. A sink or cooktop moves with its cabinet. Units overlap only when a layer truly doesn't fit.
- Islands that still fit are moved back inside the room.
- If the new size would cause overlaps, or push an island out, a confirmation lists what happens (`roomChangeWarnings`). Cancel keeps the old size, and Undo reverts an accepted change.

**#15 Fillers next to tall units:**
- A filler added by the R1 or R2 fix takes the height, depth and plinth of the unit it serves, so it's 185 × 65 cm next to a fridge.
- A filler only carries the countertop when it touches a base unit that has one and isn't taller than that unit. A filler alone, or between a wall and a fridge, gets no countertop.

**How to check in the app:**
- **#13:** add 7 base cabinets to a 400 cm wall. The 7th shows the message and lands at X 340.
- **#14:** type 1000 into the room width; nothing moves until Enter. Then enter 200: a confirmation names Wall A. Cancel keeps 1000.
- **#15:** on an empty wall, add a fridge, then two base cabinets, and click "Add 10 cm filler". The filler is 10 × 185, and the countertop covers only the base cabinets.

**Checked:**
- All checks pass: 119 frontend tests (10 new in `lib/placement.test.ts`, 4 in `lib/shelves.test.ts`), typecheck, lint (0 errors), format, pytest, Ruff and build.
- The 300-case filler sweep still passes with the taller fillers.
- All three fixes were checked **in the running app** (Playwright with Chrome, against an isolated copy with an empty database). There were no console errors.

**Also on this branch:**
- **Review findings R1–R4 for #7 (shelves):** all fixed; see the responses in Review findings.
- **Lint:** fixed 5 existing ESLint errors in `design.test.ts` / `fixes.test.ts` (comma-expression loops and a meaningless `&&`). They were already on `main`; lint now has 0 errors (the 7 warnings are known issue #9).

- **Review round 2 (R5–R7):** all fixed (see Review findings). 124 tests pass, plus typecheck, lint (0 errors), format, pytest, Ruff and build. The R6 messages were checked in the running app.

**Known limits:**
- When the room gets *bigger*, units keep their positions. They don't spread out.
- The confirmation is the browser's own dialog, like the existing "remove wall" confirmation.
- #17 (R14 firing on overlapping runs) still applies when you accept a shrink that leaves overlaps.

Checked and working: dragging (with live red overlap feedback), Inspector width/position edits, Delete, undo/redo, the R2 one-click filler (adds the filler, shifts the fridge, clears the problem), save and load, removing and restoring a wall, adding an island, PNG export (elevation or plan, matching the view), Print/PDF and JSON export. No console errors in any session.

## Change log

- 2026-10-27: File created. #8 moved to In progress after the rename to `CLAUDE.md`.
- 2026-10-27: #1, #7, #8 Done. #6 In progress (tooling in place, reformat pending). Added #9 from the new lint run. Also fixed a type bug in `migrate.ts` (`LegacyWall` required `depth` on legacy items) found while writing tests.
- 2026-10-27: Plan is to deploy on a VM as a web app. #2, #3, #4, #5 moved from Deferred to Open (#2, #3, #5 block deployment). Added #10 HTTPS, #11 backups, #12 CI.
- 2026-10-27: Decision: build features first, then the deployment work (#2–5, #10–12).
- 2026-10-27: #6 Done: existing code reformatted with Prettier and Ruff; all tests, typecheck, lint and build pass.
- 2026-10-27: UI review in a real browser (Playwright with the local Chrome, against an isolated copy of the app with an empty SQLite DB). Added #13–#24.
- 2026-11-06: Split into Open questions (developer asks, reviewer records the owner's decision), Review findings (reviewer → developer) and Known issues. Roles defined in `CLAUDE.md` / `GEMINI.md`; spec moved to `PROJECT.md`.
- 2026-11-06: Logged trial review findings R1–R4 for #7 Shelves (`82a9ec9`).
- 2026-11-06: #13, #14 and #15 fixed on `fix/13-15-placement` and set to `In review` (handoff below the UI review table). Added the `In review` status for known issues.
- 2026-11-06: Answered review findings R1–R4 (#7 shelves): all fixed on `fix/13-15-placement`. Also fixed 5 existing ESLint errors in test files.
- 2026-11-06: Verified R1–R4 fixes (#7 shelves) and reviewed `fix/13-15-placement` (#13–#15); logged findings R5–R7.
- 2026-11-06: Answered review findings R5–R7 (`fix/13-15-placement`): all fixed. Back to the reviewer.
- 2026-11-06: Verified R5–R7 fixes on `fix/13-15-placement`; 0 open findings remain — ready for owner check in the app.
- 2026-11-06: Owner confirmed the review cycle for `fix/13-15-placement`. #13, #14 and #15 Done; branch merged into `main`.
