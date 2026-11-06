# Planned Features

Every feature, past and future. Status values: `Planned` · `In progress` · `In review` · `Done` · `Dropped`.

**How it's kept:** the developer (Claude) adds every new feature request as the next row before building it, with a section under Details (What, Done when, Decided) and a dated change-log line. When the work is ready, the status moves to `In review` with a handoff note (branch, what changed, how to check it). The reviewer (Gemini) then reviews it and logs findings in `ISSUES.md`. The feature becomes `Done` once the findings are resolved and the owner accepts it. Open design questions go to `ISSUES.md` → Open questions, not here.

Suggested build order: 1 → 2 → 3 (small and independent), then 5 and 6. #5 goes first; corner rules use a run-end helper that #6 later extends to any room outline. The filler element (#4) doesn't depend on #6 and was built early; only its corner-aware part waits for #6.

| # | Feature | Size | Status |
|---|---|---|---|
| 1 | Cabinets without a countertop | Small | Done (to test in the app) |
| 2 | Fridge types: side-by-side, French door, top/bottom | Small–Medium | Done (to test in the app) |
| 3 | More realistic water bar and coffee machine | Small | Done (to test in the app) |
| 4 | Corner fillers | Medium | Done: filler element plus one-click fillers where rules need them |
| 5 | Design rules: problems framed in the plan and elevation (19 rules) | Large | In progress: phases A and B done, phase C next |
| 6 | Room shapes beyond a rectangle (any outline, 90° corners) | Large | Planned |
| 7 | Shelves: open wall shelf, shelves inside cabinets, open cabinets | Small–Medium | Done (to test in the app) |
| 8 | Hebrew and English interface | Large | Planned |
| 9 | Islands: two-sided, seating overhang, front marker | Medium–Large | Planned |

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

### 7. Shelves

**What:** three kinds of shelf.
- **Open wall shelf:** a new "Open Wall Shelf" element in the palette (default 80 × 4 cm, depth 25, 150 cm from the floor). It sits on the wall-cabinet layer, so it moves up and down freely and collides with wall cabinets and windows. In the Inspector its height is shown as "Thickness". The elevation draws the board with brackets, the plan shows a dashed outline, and the 3D view shows a board on brackets. It also counts for R8, so a shelf too low above the cooktop is flagged.
- **Shelves inside cabinets:** "Shelves inside" (0–5) for base and wall cabinets with doors, drawn dashed behind the doors and listed in the schedule ("2 doors, 1 shelf"). The default is 0, so existing drawings are unchanged.
- **Open cabinet:** a third front type, **Open**, next to Doors and Drawers, available in the Inspector and in the 3D panel. It draws no doors, and the shelves are visible in the elevation and in 3D (built from real boards). Choosing Open starts with 1 shelf for a base cabinet or 2 for a wall cabinet. Nothing opens into the room, so the aisle and door-sweep rules ignore it.

**Data:** new `shelf` element type; `frontType` gains `'open'`; new optional `shelfCount` field, on both frontend and backend. 5 tests.

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
