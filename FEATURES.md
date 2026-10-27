# Planned Features

Features to build before the deployment work in `ISSUES.md`. Status values: `Planned` · `In progress` · `Done` · `Dropped`.

Suggested build order: 1 → 2 → 3 (small and independent), then 6 before 4 and 5, because corner fillers and rules both depend on how walls and corners are modelled.

| # | Feature | Size | Status |
|---|---|---|---|
| 1 | Cabinets without a countertop | Small | Done (to test in the app) |
| 2 | Fridge types: side-by-side, French door, top/bottom | Small–Medium | Planned |
| 3 | More realistic water bar and coffee machine | Small | Planned |
| 4 | Corner fillers | Medium | Planned |
| 5 | Design rules: impossible layouts marked in red | Medium (rules provided later) | Planned |
| 6 | Room shapes beyond a rectangle (any outline, 90° corners) | Large | Planned |

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

Each type gets its own drawing in the elevation, plan (door swing) and 3D views.

**Done when:** You can pick each type, it draws correctly in every view, it's saved with the project, and existing fridges load as side-by-side.

**Decided:** Today's fridge is the side-by-side type. Default width is 90 cm for side-by-side and French door, and 60 cm for top/bottom.

### 3. More realistic water bar and coffee machine

**What:** More detailed, recognisable drawings of the water bar and the built-in coffee machine, in the elevation, plan and 3D views.

**Decided:** Keep the schematic style from `CLAUDE.md` and add real-world detail in line work: proportions, a lever tap, a drip tray, a display, a bean hopper.

### 4. Corner fillers

**What:** A filler is a narrow panel, usually 3–10 cm, in the gap between a cabinet and the wall, or between two cabinets meeting at a corner, so that doors and drawers can open without hitting each other or the wall. It's added as its own element with an adjustable width.

**Today:** There's a "Corner blocker" (65 cm blind corner panel), but nothing for narrow fillers. Fillers are a separate element from the corner blocker (confirmed).

**Done when:**
- A filler can be added to a run and set to any width.
- Fillers close gaps, so they no longer show as gap warnings.
- Countertops run over them.
- They're drawn in every view.

**Depends on:** #6, because what counts as a corner changes once rooms aren't rectangles.

### 5. Design rules

**What:** A rules system that checks the design and draws a red frame around anything that couldn't be built in reality, with a short explanation of which rule it breaks. You'll provide the actual rules when we get to this feature.

**Today:** A few checks already exist: overlapping units, sinks or cooktops without a countertop, unreachable sockets, clashes in corners, door swings, islands outside the room, and gaps under 10 cm. Problems are shown in red. This feature turns those checks into one rules system, so new rules are easy to add and every warning looks and behaves the same.

**Done when:** The existing checks run through the rules system, your rules are added, every violation shows a red frame plus the reason, and each rule has tests.

**Depends on:** #6, because many rules involve walls and corners.

### 6. Room shapes beyond a rectangle

**What:** Rooms that aren't plain rectangles, such as L-shaped rooms, angled walls, or a wall with a column or niche.

**Today:** The whole app assumes 4 straight walls A–D (north, east, south, west) at right angles. This assumption runs through the data model, plan mapping, clash detection, the 3D view and the migration code. This is the biggest feature and changes the core data model.

**Decided:** Any room outline with 90° corners. This includes L- and U-shaped rooms and columns or niches. Angled walls are out of scope for now.

## Change log

- 2026-10-27: File created.
- 2026-10-27: Added features 1–6 with explanations and suggested order.
- 2026-10-27: Answers recorded for #2, #3, #4, #6. #1 implemented: tests, typecheck and lint pass; still needs a check in the running app.
