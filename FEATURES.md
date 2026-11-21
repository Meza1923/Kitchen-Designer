# Planned Features

Every feature, past and future. Status values: `Planned` · `In progress` · `In review` · `Done` · `Dropped`.

**How it's kept:** the developer (Claude) adds every new feature request as the next row before building it, with a section under Details (What, Done when, Decided) and a dated change-log line. When the work is ready, the status moves to `In review` with a handoff note (branch, what changed, how to check it). The reviewer (Gemini) then reviews it and logs findings in `ISSUES.md`. The feature becomes `Done` once the findings are resolved and the owner accepts it. Open design questions go to `ISSUES.md` → Open questions, not here.

Suggested build order: 1 → 2 → 3 (small and independent)Gemini review: feat/9-islands, then 5 and 6. #5 goes first; corner rules use a run-end helper that #6 later extends to any room outline. The filler element (#4) doesn't depend on #6 and was built early; only its corner-aware part waits for #6.V

| # | Feature | Size | Status |
|---|---|---|---|
| 1 | Cabinets without a countertop | Small | Done (to test in the app) |
| 2 | Fridge types: side-by-side, French door, top/bottom | Small–Medium | Done (to test in the app) |
| 3 | More realistic water bar and coffee machine | Small | Done (to test in the app) |
| 4 | Corner fillers | Medium | Done: filler element plus one-click fillers where rules need them |
| 5 | Design rules: problems framed in the plan and elevation (19 rules) | Large | Done |
| 6 | Room shapes beyond a rectangle (any outline, 90° corners) | Large | Done |
| 7 | Shelves: open wall shelf, shelves inside cabinets, open cabinets | Small–Medium | Done (to test in the app) |
| 8 | Hebrew and English interface | Large | Done (Hebrew terms to be reviewed by the owner) |
| 9 | Islands: two-sided, seating overhang, front marker | Medium–Large | Done (reworked by #15) |
| 10 | Connect walls: corner dragging and partition walls (T-joints) | Medium–Large | Done |
| 11 | Dishwasher: integrated or visible | Small | Done |
| 12 | Realistic appliances (like the fridge) | Medium | Done |
| 13 | Catalog groups that open on click | Small | Done |
| 14 | Island designer: a full-screen editor with four views | Large | Replaced by #15 |
| 15 | Islands edited in the plan, countertop first, with aisle distances | Large | Done |

## Details

### 1. Cabinets without a countertop

**What:** A per-cabinet option "No countertop" in the Inspector. The cabinet stays where it is, but no countertop slab is drawn over it in the elevation, plan or 3D views. Typical uses are a freestanding unit, a cabinet at a different height, or the end of a run.

**Today:** Every base cabinet, under-counter oven and corner blocker automatically gets a countertop. Touching units merge into one slab (`computeCountertops` in `geometry.ts`).

**Implemented:** optional `noCountertop` field, a "Has countertop" checkbox in the Inspector for counter-bearing units, and 4 new tests.

**Done when:**
- The countertop slab splits around a cabinet that has the option on.
- A sink or cooktop placed on such a cabinet is flagged as unsupported.
- Works in elevation, plan, 3D and export.
- The option is saved with the project (new field in both `types.ts` and `schemas.py`).

### 2. Fridge types

**What:** Three fridge types, chosen in the Inspector:
- **Side-by-side:** two doors next to each other. This is what the fridge looks like today.
- **French door:** four doors, two on top and two below.
- **Top/bottom:** two doors, one above the other (fridge on top, freezer below).

Each type gets its own drawing in the elevation and 3D views. The plan view shows only the footprint, as it does today.

**Implemented:** optional `fridgeType` field; a type selector in the Inspector (the width follows the type's default unless it was changed by hand); one shared door layout (`fridgeDoors` in `geometry.ts`) used by the elevation and the 3D view; the type is listed in the export schedule; 5 new tests.

**Done when:** You can pick each type, it draws correctly in every view, it's saved with the project, and existing fridges load as side-by-side.

**Decided:** Today's fridge is the side-by-side type. Default width is 90 cm for side-by-side and French door, and 60 cm for top/bottom.

### 3. More realistic water bar and coffee machine

**What:** More detailed, recognisable drawings of the water bar and the built-in coffee machine, in the elevation, plan and 3D views.

**Decided:** Keep the schematic style from `PROJECT.md` and add real-world detail in line work: proportions, a lever tap, a drip tray, a display, a bean hopper.

### 4. Corner fillers

**What:** A filler is a narrow panel, usually 3–10 cm, in the gap between a cabinet and the wall, or between two cabinets meeting at a corner, so that doors and drawers can open without hitting each other or the wall. It's added as its own element with an adjustable width.

**Today:** There's a "Corner blocker" (65 cm blind corner panel), but nothing for narrow fillers. Fillers are a separate element from the corner blocker (confirmed).

**Done when:**
- A filler can be added to a run and set to any width.
- Fillers close gaps, so they no longer show as gap warnings.
- Countertops run over them.
- They're drawn in every view.

**Implemented:** a new `filler` element in the Cabinets palette (default 5 × 87 cm, depth 60, plinth). It sits on the floor layer, so it closes gaps and collides like a cabinet. The countertop runs over it, but it never hosts a new sink or cooktop. It has width presets of 2/3/5/7/10 cm, and is drawn as a plain flush panel in the elevation, plan and 3D views. 4 new tests.

**Automatic fillers (done):** problems from R1 (corner pull-out), R2 (hinge at a wall) and R14 (wall-to-wall run) have a one-click fix, and "Add all needed fillers" applies every fix at once.
- **Size:** each filler is big enough to clear the problem completely: 5 cm for R1, 10 cm for R2, and up to 5 cm in total for R14.
- **Making room:** neighbouring units shift along the run, and a sink or cooktop on a shifted unit moves with it. When the wall is full, the nearest regular cabinet is narrowed by exactly the missing centimetres. Cabinets without a sink or cooktop are narrowed first, and none goes below 30 cm. Appliances and towers housing an appliance are never resized. For R14 the widest cabinet is narrowed. If nothing can give up the space, a message explains why.
- **Editing:** added fillers are ordinary fillers you can resize or delete, and one undo reverts a fix.
- **Decided:** one click rather than fully automatic, so the app never moves cabinets on its own. Narrow gaps under 10 cm aren't auto-filled.

**Still open:** fillers for upper cabinets.

### 5. Design rules

**What:** A rules system that checks the design and frames every problem in red, with a short explanation of which rule it breaks.

**Today:** A few checks already exist: overlapping units, sinks or cooktops without a countertop, unreachable sockets, clashes in corners, door swings, islands outside the room, and gaps under 10 cm. This feature moves them into one rules system, so new rules are easy to add and every warning looks and behaves the same.

**Corners without waiting for #6:** rules never look at walls directly. They ask one helper, "what is at each end of this run?" The answer is an inside corner (plus which run continues around it), an outside corner, or an open end. Today the helper knows only the rectangle; #6 extends it to any outline, and the rules stay unchanged.

**Phases:**
- **A: Engine.** The rules system with severity levels, frames in the plan and elevation views, a problems list with explanations, and the existing checks moved over.
- **B: Rules that need no new elements.**
- **C: New elements and their rules.**
- **D: Countertop overhang / seating.** This needs its own small feature first.

**Rules** (provided 2026-10-27). In the "Needs" column, "run ends" means the run-end helper described above.

| # | Rule (short) | Flag when | Needs | Phase |
|---|---|---|---|---|
| R1 | Corner pull-out collision | Oven, drawers or dishwasher at an inside corner without a ≥ 50 mm filler | run ends; dishwasher | B (C for dishwasher) |
| R2 | Wall-adjacent hinge binding | Fridge or tall cabinet hinge flush against a perpendicular wall without a 50–100 mm gap | run ends | B |
| R3 | Dishwasher corner trap | Open dishwasher door (600–650 mm) blocks the adjacent perpendicular run | dishwasher; run ends | C |
| R4 | Opposing aisle deadlock | Opposing open doors or drawers collide, or the aisle between parallel counters is < 1,050 mm | plan geometry | B |
| R5 | Room door and window collision | Tall cabinet blocks a window, or a cabinet's swing hits the room door's sweep | partly exists | B |
| R6 | Cooktop lateral clearance | Cooktop < 200–300 mm from a tall cabinet, fridge or perpendicular wall | run ends | B |
| R7 | Sink-to-cooktop separation | Countertop between sink and cooktop < 400–600 mm | none | B |
| R8 | Overhead hood clearance | Upper cabinet or hood < 650 mm above an electric/induction cooktop, or < 750 mm above a gas one | cooktop type; hood | B (upper cabinets), C (hood, gas) |
| R9 | Thermal adjacency conflict | Oven tower directly against a fridge | none | B |
| R10 | Unsupported appliance end-run | Dishwasher or washer at an open run end without an end panel | run ends; end panel; dishwasher | C |
| R11 | Cabinet wall cutout span | Sink or cooktop cutout over the side panels between two base cabinets | none | B |
| R12 | Dishwasher plumbing distance | Dishwasher > 1,500 mm from the sink, or across a corner | dishwasher | C |
| R13 | Unsupported countertop span | Open gap under the countertop > 750 mm, or seating overhang > 300 mm without support | overhang / seating | D |
| R14 | Zero-tolerance wall run | Wall-to-wall cabinets with < 30–50 mm total filler or scribe allowance | run ends | B |
| R15 | Missing landing zones | Fridge (handle side), oven tower or cooktop without 400 mm of clear countertop next to it | none | B |
| R16 | Reverse refrigerator swing | Fridge door opens away from the nearest prep countertop | fridge hinge side | C |
| R17 | Broken work triangle | Sink, cooktop and fridge each < 1,200 mm or > 2,700 mm apart, or an island blocks the path | plan geometry | B |
| R18 | Inaccessible dead corner | Two base runs meet at a corner without a corner module | run ends | B |
| R19 | Sink-dishwasher-trash conflict | Trash and dishwasher on the same side of the sink, or trash not next to the sink | dishwasher; trash pull-out | C |

**Decided:**
- **Two severities:** red for physical conflicts (R1–R5, R8, R10, R11, R13, R14) and amber for good-practice guidelines (R6, R7, R9, R12, R15–R19).
- **Ranges are checked in two steps:** below the lower value gets the rule's severity. Between the lower and upper value counts as "tight", one step softer: red rules become amber, and amber rules appear in the problems list only, without a frame.
- **New elements are part of this feature,** built as phase C.

**Phase A (done):**
- `lib/rules.ts`: the rules system (`checkProject` returns violations with severity, badge, message, elements, and an elevation or plan area).
- The run-end helper (`runEnds` in `plan.ts`).
- The existing checks moved over unchanged: overlap, no countertop, socket, narrow gap and plan conflicts. The narrow gap is now amber.
- The elevation and plan draw red or amber frames, hatching and badges from the violations list.
- A problems list in the side panel covers the whole project; clicking an entry selects the element. The Inspector shows the problems for the selected element.
- The print and PNG export use the same list.
- 7 new tests.

**Phase B (done):** R1, R2, R4–R9, R11, R14, R15, R17 and R18 are in `lib/rules/design.ts`, with thresholds as named constants at the top of the file. 22 rule tests, each rule checked both where it should fire and where it shouldn't. Supporting changes:
- **Tall-cabinet doors** have a hinge side (reusing `doorHinge`), shown in the elevation, the 3D view and the Inspector.
- **Badges** stack per element in the elevation, so several problems on one element stay readable.

Notes and limits:
- **R4** is split: colliding open fronts are red, and an aisle under 105 cm is amber, since that's a guideline.
- **R7** compares a sink and cooktop on the same countertop run. Pairs across a corner aren't checked yet.
- **R8** uses the electric limit (65 cm) until phase C adds the cooktop type (gas needs 75 cm) and the range hood.
- **R15:** a side-by-side or French-door fridge has its handles in the middle, so either side counts as the handle side.
- **R17** uses the shortest sink–cooktop–fridge triangle when there are several of each.
- **Opening reach** (R4 and R5) is estimated: doors reach their own width, drawers 90% of their depth, oven and washer doors 50 cm.

**New elements for phase C:** dishwasher, pull-out trash cabinet, range hood, end panel, cooktop type (electric/induction or gas), and a hinge side for single-door fridges.

### 6. Room shapes beyond a rectangle

**What:** Rooms that aren't plain rectangles, such as L-shaped rooms, angled walls, or a wall with a column or niche.

**Today:** The whole app assumes 4 straight walls A–D (north, east, south, west) at right angles. This assumption runs through the data model, plan mapping, clash detection, the 3D view and the migration code. This is the biggest feature and changes the core data model.

**Decided:** Any room outline with 90° corners. This includes L- and U-shaped rooms and columns or niches. Angled walls are out of scope for now.

**Decided (Q1–Q3, 2026-11-06; PROJECT.md decision 12):**
- **Shapes:** presets (Rectangle / L / U), plus a wall list where the last horizontal and last vertical wall close the outline automatically. Corner dragging comes later.
- **Columns and pipe boxes:** a wall element.
- **Niches:** part of the outline.
- **Wall names:** a letter plus a numbered compass direction ("Wall E · North 2").

**Added by the owner, 2026-11-06 (phase 1b, same branch):**
- **Drag walls in the plan:** pull a wall in or out (5 cm steps, Shift = 1 cm); its two neighbours follow and the room stays closed. Cabinets on the neighbouring walls keep their physical position.
- **One settings bar:** room shape, every wall's length (rectangles too: A and B editable, C and D automatic, replacing Width / Depth) and the ceiling, in one row.

**Build plan, on branch `feat/6-room-shapes`:**
- **Phase 1:** the outline model; walls, plan, 3D and rules for any outline; migration; presets and the wall list; wall names.
- **Phase 2:** niches and the column / pipe box element.

Each phase gets its own handoff for review.

#### Handoff: phase 1, branch `feat/6-room-shapes` (2026-11-06)

**What changed:**
- **Model:** `Room.outline` (corner points, clockwise) and `WallRun.segment` (which outline segment a wall sits on), on both frontend and backend. Old projects get their rectangle as an explicit outline when loaded, and look the same.
- **Geometry:** new `lib/outline.ts`. Walls take their frame from their segment.
  - `runEnds` knows **inside** and **outside** corners. Outside corners are the tip of an L; the corner rules (R1, R2, R14, R18) only act at inside corners.
  - "Island outside the room" uses the real outline.
  - Wall lengths come from the outline.
- **Shape editing:** new `lib/roomShape.ts`.
  - **Room shape** chips in the settings bar: Rectangle, L-shape, U-shape.
  - Rectangles keep their Width and Depth fields. Other shapes get a **Walls** row with a length per wall, where the last horizontal and last vertical wall are computed ("auto") so the room always closes.
  - When switching shape, walls and their cabinets move to the **matching** new wall: same direction, same line. Walls that disappear are listed in a confirmation if they hold cabinets.
  - Default names are re-lettered in outline order; renamed walls keep their name.
- **Names (Q3):** a numbered direction on tabs, plan labels, the Inspector's wall list and the export: "Wall C · South 1".
- **Plan:** each wall is a mitred band, with clean joins at inside and outside corners. Non-rectangular rooms show each wall's length in its label, and the area outside the room is tinted.
- **3D:** the floor follows the outline. A wall extends over the corner block at an inside corner and stops short at an outside corner.

**How to check in the app:**
1. Add a base cabinet to Wall A, then click **L-shape**: six tabs appear (A North … F West) and the cabinet stays on Wall A.
2. In the **Walls** row, set A · North to 450 and press Enter: E · South 2 ("auto") follows to 300.
3. Open 3D: the floor is L-shaped.
4. Switch back to **Rectangle**: if the inner walls C and D hold cabinets, you're asked first.

**Checked:**
- All checks pass: 141 frontend tests (16 new in `lib/outline.test.ts`), typecheck, lint (0 errors), format, build, 11 backend tests (2 new: outline save/load, and fewer than 4 corners refused), Ruff.
- Checked **in the running app** with the Playwright MCP tools, against the isolated copy: L-shape switch, tabs and walls row, resizing Wall A to 450, the 3D floor. No console errors.
- All 123 earlier tests (rules, fixes, placement, geometry) pass unchanged, so rectangles behave exactly as before.

**Review round 1 (R8–R10):** all fixed: the aisle and work-triangle rules respect the room's walls, islands are placed and kept inside L and U rooms, and three small UI fixes. 146 frontend tests pass, plus all other checks; the island placement was checked in the running app.

**Phase 1b (owner request, same branch):**
- **Drag walls in the plan:** grab a wall (the cursor shows ↕ / ↔) and pull it in or out, in 5 cm steps (Shift = 1 cm).
  - Its two neighbours follow and the room stays closed. Impossible moves stop at the last valid position.
  - Cabinets on the neighbouring wall keep their physical position; cabinets pushed past a wall's start move forward in order instead of piling up (review finding R11). Islands keep their place.
  - Dragging the top or left wall moves the room's coordinates; the view compensates, so the wall stays under the cursor. The view doesn't re-fit during or after a drag. A whole drag is one undo step.
  - Built from `moveWall` (`lib/outline.ts`), `dragWall` (`lib/roomShape.ts`), `fitFromStart` (`lib/plan.ts`), a `wall` drag in `PlanCanvas`, and `panBy` in the viewport.
- **One settings bar:** the Room row holds the shape, every wall's length and the ceiling. Rectangles show their walls too (A and B editable, C and D automatic), replacing Width / Depth.
- **Checked in the running app** (Playwright, isolated copy): wall C outward (B 150 → 195, D 150 → 105); wall A down 50 px (moved 51 px with the cursor). No console errors. 151 frontend tests pass.

**Known limits:**
- **Phase 2 is not done:** niches, and the column / pipe box element.
- Dragging corners in the plan comes later (Q1).
- Presets start from the room's current width and depth with fixed proportions (the L's cut-out is ⅜ of the width and ½ of the depth). Adjust them in the Walls row.
- Rectangles now show a thin diagonal seam where two walls meet in the plan (mitred corners).

**Developer defaults (recorded as Implementation Assumptions when built):**
- **Storage:** the room outline is stored as its corner points, clockwise, with walls derived from it.
- **Existing projects:** they convert automatically on load. A rectangle becomes a 4-corner outline, and nothing changes visually.
- **Outside corners:** the corner of an L that points into the room. A run ends there, and the rules treat that end as open, because there's no wall beside it to hinge against or scribe to.
- **Corner rules and fillers** use the run-end helper built in #5, which now understands any outline. R1, R2, R14 and R18 work unchanged.

**Done when:**
- An L-shaped and a U-shaped room can be created and resized.
- Every wall has its own elevation.
- Plan, 3D, exports and rules all handle the new shapes.
- Old projects load unchanged.
- Tests cover the outline geometry and the migration.

### 7. Shelves

**What:** three kinds of shelf.
- **Open wall shelf:** a new "Open Wall Shelf" element in the palette (default 80 × 4 cm, depth 25, 150 cm from the floor). It sits on the wall-cabinet layer, so it moves up and down freely and collides with wall cabinets and windows. In the Inspector its height is shown as "Thickness". The elevation draws the board with brackets, the plan shows a dashed outline, and the 3D view shows a board on brackets. It also counts for R8, so a shelf too low above the cooktop is flagged.
- **Shelves inside cabinets:** "Shelves inside" (0–5) for base and wall cabinets with doors, drawn dashed behind the doors and listed in the schedule ("2 doors, 1 shelf"). The default is 0, so existing drawings are unchanged.
- **Open cabinet:** a third front type, **Open**, next to Doors and Drawers, available in the Inspector and in the 3D panel. It draws no doors, and the shelves are visible in the elevation and in 3D (built from real boards). Choosing Open starts with 1 shelf for a base cabinet or 2 for a wall cabinet. Nothing opens into the room, so the aisle and door-sweep rules ignore it.

**Data:** new `shelf` element type; `frontType` gains `'open'`; new optional `shelfCount` field, on both frontend and backend. 5 tests.

**After review (2026-11-06):**
- The open wall shelf is a floating shelf (concealed fixings), allowed on walls only.
- A shelf over a socket flags SOCKET HIDDEN.
- Upper-layer gap warnings compare only items at the same height.
- The 3D panel has a "Shelves inside" control.

**Not included:** shelves inside the door zones of a tall cabinet. The tall cabinet's "Open shelf" zone already exists.

### 8. Hebrew and English interface

**What:** the whole site can be switched between Hebrew and English.

**Decided:**
- **Translate everything:** the interface, element names, problem messages, labels inside the drawings, and the Print/PDF and PNG exports.
- **Switching:** an עב / EN toggle in the header, remembered in the browser. The first visit follows the browser's language.
- **Terminology:** Claude drafts all Hebrew texts in one file, and the product owner corrects the kitchen terms.
- **Right-to-left:** in Hebrew the interface is mirrored (palette and panels swap sides), but **drawings are never mirrored**. Walls stay left-to-right as seen from inside the room, so measurements match reality.

**Approach:** a small typed dictionary with no new library. TypeScript makes a missing Hebrew text a type error, so nothing ships half-translated. Problem messages move from fixed English sentences to translation keys with values.

### 9. Island improvements

**What:** islands already exist (the "+ Add Island" button: length, depth, position, rotation, and cabinets on them). To add:
- **Two-sided island:** cabinets on both sides, for example drawers facing the kitchen and open shelves facing the living room. Each side gets its own elevation.
- **Seating overhang:** a countertop overhang with stools on one side, plus its support rule (R13: an overhang over 30 cm needs support).
- **Front marker:** the plan shows which side the cabinets face (UI review finding #21).

**Decided (Q5, 2026-11-07; PROJECT.md decision 14):** back-to-back toggle; seating on either long side; arrow + side labels.

**Done when:** an island can be switched to two-sided with cabinets and an elevation on each side; a seating overhang with stools can be put on its front or back; R13 flags an unsupported overhang over 30 cm; the plan shows the front arrow and A/B labels; plan, 3D, rules, export and save/load handle all of it; old projects load unchanged.

### 10. Connect walls by their ends

**What (owner, 2026-11-07):** connect walls together, both from the ends of each wall and from the end of one wall to another wall.

**Decided (Q4, 2026-11-07; PROJECT.md decision 13):** corner dragging plus partition walls. No free wall drawing.

**Phase A: corner dragging.**
- In the plan, grab a corner of the room and drag it. The two walls meeting there move along their normals (two `moveWall` steps), so corners stay at 90° and the room stays closed.
- It works like wall dragging: 5 cm steps (Shift = 1 cm), the view stays still, cabinets on the walls keep their physical place, and a whole drag is one undo step.

**Phase A handoff (2026-11-07, branch `feat/10-connect-walls`):**
- **What changed:**
  - `lib/roomShape.ts`: `dragCorner(data, corner, intoPrev, intoNext)`. It moves the wall ending at the corner and the wall starting there along their normals. It is two `moveWall` steps through a shared `moveSegment` helper, which `dragWall` now uses too, so open (removed) walls can move as well.
  - `PlanDrawing`: a small blue-outlined handle in the 10 × 10 cm square outside every room corner, where the two wall bands meet. It doesn't cover cabinets standing in the corner.
  - `PlanCanvas`: a `corner` drag kind that shares the wall-drag code (start snapshot, snapping, pan compensation, frozen fit, one undo key). The plan hint now says "drag walls, corners and items".
- **How to check:**
  - In the plan, drag a corner handle (cursor `move`). Both walls follow and the wall lengths in the Room bar update.
  - Dragging the north-west corner keeps the room still on screen.
  - In an L or U, the inside corners move diagonally.
  - One Cmd+Z undoes the whole drag.
- **Checked:**
  - 4 new unit tests (`outline.test.ts`: rectangle outward, north-west inward with an island, inside corner of an L, refusal).
  - In the isolated app (Playwright MCP, ports 5199/8765):
    - Rectangle south-east and north-west corners; the handle stays under the pointer.
    - Undo restores the whole drag.
    - The L-shape inside corner.
- **Known limits:**
  - A move that would make a wall shorter than 1 cm is refused as a whole, so the corner stops at the last valid spot instead of sliding along the still-valid direction.
  - Handles are always shown, not only on hover.

**Phase B: partition walls.**
- A new run starting from a point on an existing wall and running into the room, at 90° to it, with a length and the usual 10 cm thickness.
- It has two faces, each with its own elevation and cabinets.
- **On the host wall:** its thickness blocks that stretch, like an element, so nothing can be placed through it.
- **Corners:** both faces start at an inside corner with the host wall, so the corner rules (R1, R2, R14, R18) and the filler fixes work there.
- **Its far end is open.**
- **Views:** plan, 3D, rules, export and save/load all handle it.

**Phase B handoff (2026-11-07, branch `feat/10-partition-walls`):**
- **What changed:**
  - **Data model:** a partition is two runs (`kind: 'partition'`, side A and side B), sharing `partitionId`, `hostId` and `hostX`. Its length is `widthCm`.
  - **Joint element:** where it meets the host wall, `syncRoom` keeps a derived, locked, full-height `partition_joint` element on the host. Overlap, gap, snap, free-slot placement, wall fitting and the filler fixes all treat that stretch as blocked without special cases. The joint is never selectable, listed or exported.
  - **Geometry** (`lib/plan.ts`: `partitionFrame`, `partitionRect`, `syncPartitions`; `lib/partition.ts`: add, set, delete):
    - Side A starts at the host wall and runs into the room. Side B runs back and ends at the host wall.
    - A partition goes away with its host (removed wall, or a shape change that drops the wall; both confirm first).
    - A partition keeps its physical place when the wall before its host is dragged.
  - **Corner rules** (`rules/core.ts`): a corner now carries its position along the run (`pos` / `neighbourPos`), so R1, R2, R6 and R18 work at the T-joint on both the partition side and the host side.
    - R14 checks every stretch between two inside corners, for example corner to joint.
    - The filler fixes (`pushClear`, `addScribeFiller`) only push units within the stretch between joints.
  - **Plan:**
    - The partition is drawn as a hatched wall. Each half selects the face on that side; dragging it slides the partition along the host (5 cm steps, Shift for 1 cm). The tip handle changes its length.
    - Flagged: **OUTSIDE ROOM**, and **CLASH** with units on other runs or with islands.
  - **Bar:** "+ Add Partition" (enabled when a wall tab is active; placed centred on the widest free stretch). For an active partition: **Position on <host>** and **Length** fields, plus a delete button that removes both sides. Tabs no longer wrap.
  - **Elevation:** the host shows the partition as a hatched full-height section labelled PARTITION.
  - **3D:** the body is a full-height wall; side B adds only its sockets. Partitions never hide in the dollhouse view.
  - **Export:** the run summary lists "Partition on <wall> at X". There is a page per face that has elements.
  - Sockets and shelves can go on partitions (refused only on islands).
- **How to check:**
  - On Wall A, click "+ Add Partition".
  - Drag it along the wall and pull its tip.
  - Add cabinets on side A, side B and Wall A next to the joint.
  - Look at Wall A's elevation, the rules panel (CORNER PULL-OUT, HINGE AT WALL, NO SCRIBE ALLOWANCE at the joint) and 3D.
- **Checked:**
  - 9 new frontend tests (`partition.test.ts`: geometry, blocking, clamping, wall drag, removal, outside room, R1 on both sides plus its fix, R14 on a host stretch).
  - 1 backend round-trip test.
  - All 164 frontend tests pass.
  - In the isolated app (Playwright MCP, ports 5199/8765): add, slide, resize, a cabinet on side A, the Wall A elevation with the joint and auto-placement skipping it, and 3D. No page errors.
- **Known limits:**
  - Thickness is fixed at 10 cm and height at the ceiling.
  - Only straight partitions at 90° from a room wall, not from another partition.
  - Windows/doors on a partition don't cut a hole in its 3D body.
  - Cabinet bands on the host aren't drawn around the joint in the plan (the joint itself isn't drawn there; the partition body is).

**Done when:**
- A corner can be dragged in the plan, and the room stays closed with 90° corners.
- A partition can be added on a wall, moved along it, resized, and given cabinets on both faces.
- The corner rules work at its T-joint.
- Old projects load unchanged.
- Tests cover both phases.

**Notes:**
- The partition's two faces are the same "two-sided run" idea as the two-sided island in #9; build it once and reuse it there.
- Its footprint on the host wall works like the column / pipe box element in #6 phase 2.

**#15 handoff (2026-11-21, `feat/9-islands`):**
- **What changed:**
  - **One screen:** clicking an island's tab (or "+ Add Island") switches to Split, with the plan above and the elevation of the island side being worked on below. The right panel becomes the **island panel**, with numbered steps and a hint each:
    1. Countertop: length, depth, turn 90°.
    2. Cabinets: pick Front / Back / Left end / Right end, then add from the catalog.
    3. Seating: Bar stool / Counter stool, and how much countertop is past the cabinets on that side.
    4. Ends: None / Plain end panel / Waterfall.
  - **Starting point:** an empty island offers four layouts (Cabinets only; Cabinets + seating; Cabinets on both sides; Seating + waterfall ends).
  - **Model** (`lib/plan.ts`): the island is its countertop (side A's length × depth). Each side's cabinets stand under it with their fronts 2 cm inside that edge (`islandSideFrame`). The **overhang is computed** (`islandOverhangs`): the countertop with no cabinets under it, along each edge. The typed `overhangCm` field is gone.
  - **Drawing:** the plan draws the island as one countertop, with the overhanging parts shaded and labelled. The elevation of an island side has no wall or ceiling and draws the countertop right across. 3D builds one countertop slab per island, the end profiles and the chairs.
  - **Aisles** (`islandClearances`): dashed lines in the plan from each edge of the island to the nearest cabinet front, other island, partition or wall, labelled in cm, amber under 105 and red under 90. They're also listed in the island panel.
  - **R13:** an overhang over 30 cm on the front or back (unless both ends are waterfalls) or at an end is an error. On the front or back, the fix makes the island less deep. New **NO KNEE ROOM** warning: chairs on a side with less than 25 cm of countertop past the cabinets.
  - **Chairs** are in the main catalog ("Chairs" group). They're refused off islands, with a message.
  - **Removed:** the full-screen island designer (#14) and its arrows and side map.
- **How to check:** "+ Add Island", then pick "Cabinets + seating". Click Back in the island panel to see the chairs' elevation, read the aisle lines in the plan, try "Seating + waterfall ends", then 3D.
- **Checked:**
  - 195 frontend tests (island tests rewritten for the countertop model) and 12 backend tests. Typecheck, lint (no new warnings), format and build pass.
  - In the isolated app (Playwright MCP, 5199/8765): Add Island, the seating layout, the Back side's elevation, the aisle distances (back 45 / ends 80 / front 103 with wall cabinets on the north wall) and 3D. No page errors.
- **Known limits:**
  - Cabinets of different depths on one side line up at the back, so a shallower unit's front sits further in.
  - Aisles are measured from the countertop edge, not from the chairs.
  - The plan's aisle lines show for every island all the time (no on/off yet).

### 11. Dishwasher: integrated or visible

**What (owner, 2026-11-07):** the dishwasher has two options, integrated or not.
**Decided:** new dishwashers are **Integrated** (hidden behind a cabinet front, as now); the Inspector switches to **Visible** (stainless front with a control panel).
**Done when:** the choice is in the Inspector, drawn in the elevation, plan and 3D, saved, and listed in the schedule.

### 12. Realistic appliances

**What (owner, 2026-11-07):** all the appliances should look more realistic, like the fridge.
**Plan:** the same treatment the fridge got: under-counter oven, built-in oven / microwave / coffee zones, dishwasher (visible), washing machine, cooktop (electric, induction, gas), range hood, sink, water bar and coffee machine get appliance details in the elevation (glass, control panels, handles, rings, grates) and realistic materials in 3D (stainless, glass, black glass), following decision "Realistic materials in 3D only" for the cabinet fronts.
**Done when:** each appliance is recognisable at a glance in the elevation and 3D.

### 13. Catalog groups that open on click

**What (owner, 2026-11-07):** the catalog's groups (cabinets, appliances and more) start closed; clicking a group opens it so you can add from its list.
**Done when:** groups open and close on click, start closed, and the open ones are remembered per browser.

### 14. Island designer

**What (owner, 2026-11-07):** choosing an island opens a window just for designing it, seen from the front, with arrows to switch between its four views, where chairs, cabinets, open shelves and the side profiles (where the chairs are) can be added and edited.

**Decided (Q6, owner in chat, 2026-11-07; PROJECT.md decision 15):**
- **Full-screen panel in the app:** choosing an island's tab (or double-clicking it in the plan) opens the Island designer over the app, with its own catalog and Inspector; Close returns. Undo and save work as usual.
- **Four views** with arrows: Front (side A), Right end, Back (side B), Left end. Each is an editable elevation.
- **Ends** can hold open shelves or a shallow cabinet, and have a **profile**: none, **Plain end panel** or **Waterfall**.
- **Chairs are elements:** bar (seat 75) or counter (seat 65), dragged along the side; new ones space themselves 60 cm apart. Adding a chair to a side gives it a 30 cm overhang if it has none.

**Replaces** #9's "Two-sided" tickbox and Seating / Overhang / Supported settings: every side is designed in the designer instead.

### 15. Islands edited in the plan, countertop first

**What (owner, 2026-11-21):** the island designer was unclear ("I didn't understand what I should do at all"). Edit the island in the main plan, on one screen, built around its countertop, and show the distance between the island and the kitchen units.

**Decided (Q7, owner in chat, 2026-11-21; PROJECT.md decision 16):**
- **In the main plan, one screen:** selecting an island shows the plan with the island, the elevation of the side being worked on below it, and an **island panel** that leads through the steps: countertop → cabinets (choose the side: Front / Back / Left end / Right end) → seating (chairs) → ends (None / Plain end panel / Waterfall), with a short hint at each step. The full-screen designer goes away.
- **Countertop first:** the island is its countertop (length × depth). Cabinets stand under it against one of its edges; the **overhang** is whatever countertop has nothing under it, worked out, not typed. R13 checks it.
- **Layouts:** a new island offers ready layouts (cabinets only; cabinets + seating; both sides; seating + waterfall ends).
- **Distances:** the plan shows the distance from each side of the island to whatever faces it (cabinet fronts, or the wall), amber under 105 cm and red under 90 cm.

**Done when:** a first-time user can add an island from a layout and change it without explanation; the overhang follows from the countertop and the cabinets; the aisle distances show in the plan; plan, elevation, 3D, rules, export and save/load handle it.

## Handoff: #11–#14 on `feat/9-islands` (2026-11-07)

**#11 Dishwasher:** Inspector → Dishwasher → Front: **Integrated (cabinet front)** (default) or **Visible (stainless)**. The visible one has a stainless door, a black-glass control strip and a bar handle in 3D, and a control strip with a display and a bar handle in the elevation. It's listed in the schedule. Field `dishwasherFront`.

**#12 Realistic appliances** (3D finishes; appliance details in the elevation, like the fridge):
- **Ovens** (under-counter, and the oven zone of a tall cabinet): black-glass control strip with a display and knobs, steel door with a glass window, chrome bar handle on stand-offs.
- **Microwave zone:** glass door with a control column. **Coffee zone:** steel with a display and a cup recess.
- **Washing machine:** gloss white body, control strip with a dial and display, chrome door ring around dark glass.
- **Cooktop:** black glass with heating zones (electric, induction), or steel with cast-iron grates and burner caps (gas).
- **Range hood:** slim T-shaped steel canopy with a light strip and filters, and a chimney to the ceiling.
- **Sink:** stainless bowls with drains, chrome tap. **Pull-out trash:** cabinet front with a handle.

**#13 Catalog:** groups start closed. Clicking a group opens it (with an item count), and the open groups are remembered per browser.

**#14 Island designer** (decision 15):
- **Opening it:** clicking an island's tab (or the "Design island" button, or double-clicking the island in the plan) opens a full-screen designer. ◀ ▶ switch between **Front, Right end, Back, Left end**, and a small top view shows which side you're looking at.
- **Each side** is an editable elevation with the Inspector, and a catalog without wall-only elements, plus **Chairs** (Bar stool, seat 75 / Counter stool, seat 65).
- **Ends:** **Profile** None / Plain end panel / Waterfall (drawn in the plan, 3D and the end view).
- **Every side:** an **Overhang** field. Adding a chair gives the side a 30 cm overhang, and chairs space themselves 60 cm apart.
- **Model:** the back and ends are island runs derived from side A (`face` 'b' / 'left' / 'right'), created on first use, with no tabs of their own. Their depth is that of their cabinets. Overhangs are per side, and profiles are on side A.
- **R13:** an overhang over 30 cm past the cabinets on the front or back is flagged unless both ends are waterfalls. On an end, it is always flagged. The fix shortens the overhang.
- **Replaced:** #9's Two-sided / Seating / Supported settings are gone (they never reached `main`).

**Checked:**
- 195 frontend tests (island tests rewritten for four sides; Hebrew complete) and 12 backend tests. Typecheck, lint (no new warnings), format and build pass.
- In the isolated app: the collapsed catalog; every appliance in the elevation and in 3D; the designer (cabinets on the front, a waterfall on the right end, three bar stools on the back with a 30 cm overhang, a waterfall on the left end, then the plan and 3D from both sides).

**Known limits:**
- A side's elevation doesn't show the overhanging countertop above the chairs (only the plan and 3D do).
- Chairs show only on islands.
- The island's front overhang still counts island depth without cabinets (as in R15).

## Combined handoff: `feat/9-islands` (2026-11-07)

The owner asked for all open features on one branch (2026-11-07): **#9 islands, #6 phase 2, #5 phases C and D, #8 Hebrew/English**. One review for all four.

**#9 Islands** (decision 14, Q5):
- **Two-sided:** "Two-sided" in the island settings adds side B, back to back behind side A. It has its own tab ("Island · B"), elevation and cabinets.
  - Side B is an island run (`face: 'b'`, `hostId` = side A) whose position, length and rotation are derived from side A by `syncIslandBacks` on every edit. Its depth is its own (default 60, "Depth (side B)").
  - Dragging side B moves the island. Unticking removes side B (asks if it has cabinets).
- **Seating overhang:** Seating None / Front / Back, Overhang (default 30 cm), Supported.
  - The slab is measured from the cabinet fronts on that side: front = past side A's fronts; back = past its backs, or past side B's fronts.
  - Stools every 60 cm in the plan and 3D (`islandSeating`).
  - **R13** (red): an unsupported overhang over 30 cm, with a fix "Make the overhang 30 cm".
- **Front marker** (UI review #21): an arrow outside each island's front edge, and A / B labels on a two-sided island. The size label moved to the island's side.
- **Whole-island footprint:** side B and the seating count for OUTSIDE ROOM, clashes, door swings, R17 "island in the way", keeping the island inside the room, and the resize warning (`islandFootprint`).

**#6 phase 2:**
- **Niches:** "+ Niche" on a wall tab cuts a 100 × 30 cm recess in the middle of the wall (`nicheOutline`, `addNiche`). The wall becomes five walls, adjusted like any other (drag in the plan, or lengths in the Room bar).
  - Cabinets and partitions keep their physical place: before the niche, in it (onto the niche's back wall), or after it (onto the new wall).
  - Default names are re-lettered; renamed walls keep their names.
- **Column / pipe box** (`column`, catalog group "Room"): Column 30 × 30 and Pipe box 20 × 20, full height by default.
  - Width, depth, Y and height are all free. It is in the upper layer, so it collides with whatever it reaches: a pipe box at the ceiling doesn't hit the base units below.
  - Walls and partitions only. Drawn hatched in the elevation, plan and 3D.

**#5 phase C:**
- **New elements:** Dishwasher (60 × 87), Pull-out Trash (45 × 87), Range Hood (60 × 50 @ 155, with a chimney to the ceiling) and End Panel (2 × 87). The dishwasher, trash and end panel carry the countertop.
- **New options:** cooktop type (Electric / Induction / Gas), and hinges for a top/bottom (single-door) fridge.
- **Rules:**
  - R1: the dishwasher and trash count as pull-outs.
  - R8: hoods count, and gas needs 75 cm.
  - New: R3 dishwasher corner trap, R10 no end panel, R12 dishwasher far from sink / across a corner, R16 fridge opens away (fix: flip the hinge), R19 trash/dishwasher/sink.
- **Phase D:** R13, see #9.

**#8 Hebrew / English** (decisions 2026-11-04):
- **Toggle:** a "עברית / English" button in the header, remembered per browser (localStorage).
- **Hebrew layout:** the page turns right-to-left; the plan, elevation and print drawings stay left-to-right.
- **How it works:** every text goes through `t('English', vars)` (`lib/i18n.ts`). The Hebrew is in `lib/i18n.he.ts` (about 400 entries, **drafted by Claude for the owner to review**).
- **Default names** ("Wall A", "Island", "Partition 1") show translated; names you typed stay as typed.
- **Covered:** the interface, element names, all rule messages, badges and fixes, drawing labels, the print/PDF sheets, the Electrical Schedule, PNG headings and error messages.
- **Test:** `i18n.test.ts` scans the source for every shown text and fails if one has no Hebrew, or if a placeholder doesn't match.

**How to check:**
- **Islands:** Add Island, tick Two-sided, add cabinets on both sides, set Seating to Back and the overhang to 40 (OVERHANG), then open 3D.
- **Niches and columns:** on Wall A click "+ Niche" and drag the niche's walls; add a Column and a Pipe box.
- **Phase C:** add a dishwasher on an island end (NO END PANEL), set a cooktop to gas under a hood, put a dishwasher and trash on the same side of a sink.
- **Hebrew:** click "עברית" and go through every view and Print / PDF.

**Checked:**
- 192 frontend tests (new: `island.test.ts` 8, `niche.test.ts` 4, `rules/phaseC.test.ts` 7, `i18n.test.ts` 3) and 12 backend tests. Typecheck, lint, format and build pass.
- In the isolated app (Playwright MCP, 5199/8765): islands (two-sided, seating, stools, arrows, OVERHANG, 3D), niche and column (plan, elevation), the new elements (elevation, 3D, R19), and Hebrew (right-to-left layout, drawings not mirrored, remembered after reload). No page errors.

**Known limits:**
- A rectangle with a niche shows the "U-shape" chip: a niche is a U-notch turned outward, and both have 8 corners.
- There's no "remove niche" yet: use Undo, or a shape preset.
- The seating overhang isn't drawn in the elevation (it points at the viewer).
- R13 checks only the seating overhang, not open spans under a countertop.
- Hebrew: the interface spacing classes aren't mirrored everywhere (a few margins stay physical), and the Hebrew terms need the owner's review.

## Change log

- 2026-10-27: File created.
- 2026-10-27: Added features 1–6 with explanations and suggested order.
- 2026-10-27: Answers recorded for #2, #3, #4, #6. #1 implemented: tests, typecheck and lint pass; still needs a check in the running app.
- 2026-10-27: #2 implemented: tests, typecheck and lint pass, and the elevation was checked by rendering it. #1 follow-up: "no countertop" now shows in the export schedule.
- 2026-10-27: #2 follow-up: fridge drawn as an appliance rather than a cabinet. Elevation: rounded doors with a seal line, bar handles on stand-offs, hinge caps, a ventilation grille. 3D: thick doors with visible gaps, stand-off bar handles, a grille.
- 2026-10-27: Decision: realism comes from materials in the 3D view only; the elevation stays a technical drawing. Fridge in 3D: stainless steel with studio reflections, rounded doors, round bar handles on stand-offs, recessed grille, selection outline. The same approach is planned for #3.
- 2026-10-27: #3 implemented. 3D: real dispensing alcove, drip tray, nozzle / twin spouts, display or touch strip, bean hopper, glass / cup. Elevation drawing matches. Both views were checked by rendering.
- 2026-10-27: #4 filler element implemented. The corner-aware part is deferred to after #6.
- 2026-10-27: #5 rules received (R1–R19) and sorted into phases A–D. #5 is now built before #6, using a run-end helper for corners.
- 2026-10-27: #5 decisions: red and amber severities, two-step range thresholds, new elements in phase C. Phase A (engine) started.
- 2026-10-27: #5 phase A done: rules engine, run-end helper, existing checks moved over, red and amber rendering, problems list. Checked by rendering the elevation and plan.
- 2026-10-27: #5 phase B done: 13 rules (R1, R2, R4–R9, R11, R14, R15, R17, R18) with tests, a hinge side for tall-cabinet doors, and stacked badges. Rules moved into `lib/rules/` (core, base, design). Checked by rendering a deliberately flawed kitchen.
- 2026-10-27: #4 one-click fillers for R1, R2 and R14, plus "Add all needed fillers". Units shift to make room, or the widest cabinet is narrowed for R14. Fixes live in `lib/rules/fixes.ts`, with 5 tests.
- 2026-10-27: Fillers failed on full walls (120 of 196 test cases in a sweep). Fixed by narrowing the nearest regular cabinet by the exact shortfall (decided: narrow exactly). A regression test now runs every fix in every corner, on empty and full walls (over 300 cases): all apply, clear their problem and add no new red problems.
- 2026-11-04: #7 shelves implemented (open wall shelf, internal shelves, open cabinets); checked by rendering the elevation. #8 (Hebrew/English) and #9 (island) added; scope to agree.
- 2026-11-04: Decisions for #8: translate everything, toggle remembered per browser, Claude drafts and the owner reviews the Hebrew terms, RTL interface without mirrored drawings. #9 scope: two-sided island, seating overhang (R13), front marker.
- 2026-11-06: Added the `In review` status and the intake/handoff process (developer Claude, reviewer Gemini).
- 2026-11-06: #7 review findings R1–R4 fixed on `fix/13-15-placement`: floating shelf, walls only, socket check, gaps per height band, shelves control in 3D.
- 2026-11-06: #6 scoped; Q1–Q3 asked in `ISSUES.md`; developer defaults listed.
- 2026-11-06: #6 decisions applied, split into phase 1 (outline, presets, wall list, names) and phase 2 (niches, column/box element). Branch `feat/6-room-shapes`.
- 2026-11-06: #6 phase 1 implemented and set to In review (handoff in its details).
- 2026-11-06: #6 phase 1: review findings R8–R10 fixed.
- 2026-11-07: #10 added (connect walls by their ends); Q4 asked.
- 2026-11-07: Q4 applied to #10 (corner dragging + partition walls); plan and Done-when written.
- 2026-11-06: Owner added wall dragging in the plan and one settings bar (phase 1b), on the same branch.
- 2026-11-06: #6 phase 1b implemented and set to In review with phase 1.
- 2026-11-06: #6 phase 1b: review finding R11 fixed.
- 2026-11-07: Restored the phase 1b notes above, which an earlier copy of this file had overwritten.
- 2026-11-07: Owner confirmed #6 phases 1 and 1b in the app: Done, merged into `main`. Phase 2 (niches, column / pipe box element) stays Planned.
- 2026-11-07: #10 phase A (corner dragging) started on `feat/10-connect-walls`.
- 2026-11-07: #10 phase A (corner dragging) built and checked; In review on `feat/10-connect-walls`.
- 2026-11-07: #10 phase A merged into `main` (owner approved). Phase B (partition walls) is next.
- 2026-11-07: #10 phase B (partition walls) built and checked; In review on `feat/10-partition-walls`.
- 2026-11-07: #10 phase B: review findings R12–R14 fixed (filler fix stays within a stretch; aisle, work triangle and door swing see partitions; room changes respect and warn about partitions). 170 frontend tests pass.
- 2026-11-07: #10 phase B merged into `main` (owner approved); #10 Done.
- 2026-11-07: #9 started on `feat/9-islands` (owner decisions Q5).
- 2026-11-07: Owner asked for all open features on `feat/9-islands`. Built #9 islands, #6 phase 2 (niches, column / pipe box), #5 phases C + D (new elements, R3/R8/R10/R12/R13/R16/R19) and #8 Hebrew/English; In review together.
- 2026-11-07: `feat/9-islands`: review findings R15–R17 fixed (seating measured from the cabinets, R13 on the real cantilever, island deletion, columns in fixes/rules, niche overlap warning, i18n gaps). 197 frontend tests pass.
- 2026-11-07: Added #11–#14 (owner); decisions recorded (Q6). Built on `feat/9-islands` with the rest.
- 2026-11-07: #11–#14 built on `feat/9-islands`; In review.
- 2026-11-08: #14 review findings R18–R20 fixed (selection across island sides, chairs' plan footprint and clashes, island front countertop and chair overhang). 198 frontend tests pass.
- 2026-11-21: #15 (owner): islands edited in the plan, countertop first, with aisle distances; replaces #14's designer. Started on `feat/9-islands`.
- 2026-11-21: #15 built on `feat/9-islands` (island panel, countertop-first model, aisle distances); the #14 designer removed. In review.
- 2026-11-21: #15 review findings R21–R23 fixed. 198 frontend tests pass.
- 2026-11-21: `feat/9-islands` merged into `main` (owner approved): #5 phases C + D, #6 phase 2, #8, #9, #11–#13 and #15 Done; #14 was replaced by #15.
