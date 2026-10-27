# Project Specification: 2D Schematic Kitchen Designer (Plan + Elevation)

## 1. Overview & Core Philosophy
Build a desktop-first, 2D architectural schematic kitchen planner with two synced views of the same data:
- **Plan View (top-down, primary editor):** a rectangular room with 4 fixed walls (A North, B East, C South, D West) plus freely placed islands. Items are placed and dragged along their wall.
- **Elevation View (front-facing, "horizontal view"):** the schematic front view of any one wall/island, also fully editable (drag, Y, drawers, zones).

- **3D View:** an orbit-only shaded model of the whole kitchen, built from the same data.

The center pane has a view switcher: `Plan` (default) | `Elevation · <active wall>` | `Split` (plan above, elevation below) | `3D`. 
- **Visual Style:** Strictly technical/schematic wireframe CAD style. White/light-gray grid background, sharp black/dark-slate outlines (`1.5px` to `2px`), dimension lines, and clear typography. No textures, wood grains, or 3D shading.
- **Scale & Units:** All internal data and user inputs are in **centimeters (cm)**.
- **Plan coordinates:** cm, origin at the room's inner north-west corner, X → east, Y → south. Walls are 10cm thick, drawn outside the room.
- **Wall-local → plan mapping:** each wall is viewed from inside the room; wall-local `x = 0` is its left end as seen, and item `depth` points into the room:
  North `(x, depth)` · East `(W − depth, x)` · South `(W − x, D − depth)` · West `(depth, D − x)`. Islands use the same mapping rotated by `rotationDeg` (0/90/180/270) about their footprint.
- **Elevation Coordinate System:** 
  - `X = 0` is the **left edge** of the current wall.
  - `Y = 0` is the **floor level** (bottom of the wall). Note: Since SVG/Canvas uses top-left as `(0,0)`, implement a clean coordinate conversion helper: `screenY = wallHeightCm * scale - (itemYCm + itemHeightCm) * scale`.

---

## 2. Tech Stack & Infrastructure
Use a clean, containerized monorepo structure orchestrated via `docker-compose.yml`:
1. **Database (`db`):** `postgres:16-alpine` running on port `5432` with persistent volume storage.
2. **Backend (`backend`):** Python **FastAPI** + **SQLAlchemy 2.0** + **Pydantic v2** (running on port `8000`). Auto-creates tables on startup.
3. **Frontend (`frontend`):** **React 18 (Vite)** + **TypeScript** + **Tailwind CSS** + **Lucide Icons** (running on port `5173`).
4. **Canvas Rendering:** Use an **interactive SVG canvas** inside React (preferred over HTML5 `<canvas>` for sharp schematic rendering, easy DOM click/drag event handling, crisp text labels, and clean PNG/SVG export). Support zoom/pan or auto-fit scaling (`pxPerCm`).

---

## 3. Database Schema & JSON Data Model
Create a PostgreSQL table `kitchen_projects`:
- `id`: UUID (Primary Key)
- `name`: VARCHAR(255) NOT NULL
- `data`: JSONB NOT NULL (stores the full walls and items state)
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Backend API Endpoints:
- `GET /api/projects` - List all saved kitchen projects (id, name, updated_at).
- `POST /api/projects` - Create a new project (default room 400×300×260cm with Walls A–D).
- `GET /api/projects/{id}` - Load full project JSON.
- `PUT /api/projects/{id}` - Save/update project name and `data` JSONB.
- `DELETE /api/projects/{id}` - Delete project.

### Strict TypeScript / JSONB Schema (`ProjectData`):
```typescript
export type ElementCategory = 
  | 'base_cabinet'
  | 'upper_cabinet'
  | 'tall_cabinet'
  | 'corner_blocker'
  | 'fridge'
  | 'washing_machine'
  | 'under_counter_oven'
  | 'sink'
  | 'stove'
  | 'water_bar'
  | 'coffee_machine'
  | 'window'
  | 'door'
  | 'socket'
  | 'power_socket';

export type TallZoneType = 'door' | 'drawers' | 'oven' | 'microwave' | 'coffee' | 'open';

export interface TallZoneConfig {
  id: string;
  type: TallZoneType;
  heightPct: number; // Sum of zones must equal 100%
  drawerCount?: number; // Used if type === 'drawers'
}

export interface KitchenItem {
  id: string;
  category: ElementCategory;
  label?: string;
  x: number; // cm from left wall edge
  y: number; // cm from floor (0 for base/tall/appliances, >0 for upper/window)
  width: number; // cm
  height: number; // cm
  depth: number; // cm from the wall into the room (base 60, upper 35, tall 60, fridge 65, sink 45, stove 52, window 0)
  
  // Cabinet specific properties
  hasToeKick: boolean;
  toeKickHeight: number; // Default 10cm or 12cm
  
  // For 'base_cabinet' and 'upper_cabinet'
  frontType: 'doors' | 'drawers';
  doorCount: 1 | 2;
  drawerCount: number; // 1 to 5
  drawerSplitPcts: number[]; // Array of percentages summing to 100 (e.g. [20, 40, 40])
  
  // For 'tall_cabinet' (Tower / Built-in)
  tallZones?: TallZoneConfig[]; // Bottom, Middle, Top stacked zones
  
  // For 'sink'
  sinkBowls?: 1 | 2;
  hasFaucet?: boolean;
  
  // For 'stove'
  burnerCount?: 4 | 5;

  // For 'door' (hinge side as seen from inside the room)
  doorHinge?: 'left' | 'right';
  doorSwing?: 'in' | 'out';

  // For 'socket': outlets on the plate
  socketCount?: 1 | 2 | 3 | 4;
}

export interface WallRun {
  id: string;
  name: string; // e.g., "Wall A", "Island"
  kind: 'wall' | 'island';
  side?: 'north' | 'east' | 'south' | 'west'; // walls only
  removed?: boolean; // walls only: open side of the room
  widthCm: number; // run length; for walls derived from the room (N/S = room width, E/W = room depth)
  heightCm: number; // ceiling, synced from room.heightCm
  countertopThicknessCm: number; // Default 3
  items: KitchenItem[];
  // Islands only
  planX?: number; // footprint top-left in plan (cm)
  planY?: number;
  depthCm?: number; // Default 90
  rotationDeg?: 0 | 90 | 180 | 270;
}

export interface Room {
  widthCm: number; // Default 400
  depthCm: number; // Default 300
  heightCm: number; // Default 260 (ceiling)
}

export interface ProjectData {
  room: Room;
  walls: WallRun[]; // 4 fixed walls (N, E, S, W) followed by islands
  activeWallId: string;
}
```

---

## 4. Functional Requirements & Physics Rules

### 4.1 Room, Walls & Islands
- Top navigation bar with tabs for each run (`Wall A · North` … `Wall D · West`, `Island`, …) plus an **"+ Add Island"** button. All runs can be renamed; only islands can be deleted.
- Settings bar: **Room** `Width`, `Depth`, `Ceiling` (cm) and, for the active run, `Countertop Thickness`; for islands also `Length`, `Depth`, `X`, `Y` and a 90° **Rotate** button.
- Changing the room re-derives wall lengths/heights and re-clamps items.
- Clicking a wall band or island in the plan makes it the active run (palette adds go there). Islands drag freely on a 5cm grid (`Shift` = 1cm).

### 4.1b Plan View Rendering
- Hatched 10cm walls; room width/depth dimension lines; wall labels outside each wall.
- Floor units as solid rectangles labelled with a short code and width (`B 60`, `T 60` with an X diagonal, `REF 90`, `WM 60` with a drum circle, `OV`, hatched `CB`).
- Countertop as a light fill (depth = deepest unit + 2cm), sink bowls and faucet dot, cooktop burner crosshairs.
- Upper cabinets as **dashed** outlines; windows as glazed gaps in the wall line.
- `< 10cm` gap warnings as red hatch along the wall, same-run overlaps dashed red, and cross-run **CLASH** (e.g. corner collisions between walls A and D, island vs. wall units) plus **OUTSIDE ROOM** badges.

### 4.2 Element Catalog & Default Dimensions
Left sidebar palette with buttons to spawn elements onto the active wall:
1. **Base Cabinet:** `W: 60, H: 87, Y: 0, ToeKick: 10` (Locks to floor `Y=0`).
2. **Upper Wall Cabinet:** `W: 60, H: 70, Y: 145, ToeKick: 0` (Free vertical `Y` drag).
3. **Tall Tower Cabinet (Built-in):** `W: 60, H: 215, Y: 0, ToeKick: 10`. Default 3 zones: Bottom Drawers (`40%`), Middle Built-in Oven (`28%`), Top Door (`32%`).
4. **Corner Blocker / Dead Space:** `W: 65, H: 87, Y: 0, ToeKick: 10`. Drawn with a diagonal hatch pattern (`///`) and labeled `"CORNER INTERSECTION"` to represent a perpendicular cabinet run from an adjacent wall.
5. **Fridge:** `W: 90, H: 185, Y: 0`. Drawn with double doors + handle lines + `"FRIDGE"` label.
6. **Washing Machine:** `W: 60, H: 85, Y: 0`. Drawn with a front circular drum and top control panel.
7. **Under-Counter Oven:** `W: 60, H: 87, Y: 0, ToeKick: 10`. Base housing with an oven window graphic.
8. **Sink:** `W: 60, H: 20`. Snaps horizontally onto the countertop level (`Y = BaseCabinetHeight`). Drawn with an undermount basin cutout below the counter line and a schematic faucet arc above the counter line.
9. **Stove (Cooktop):** `W: 60, H: 5`. Snaps onto the countertop surface. Drawn as a low-profile slab above the counter with schematic burner crosshairs.
10. **Window:** `W: 120, H: 100, Y: 105`. Free `X` and `Y` placement. Drawn with a double frame and glass cross-lines.

### 4.3 Automatic Continuous Countertop Generation
- Automatically compute and render a continuous **Countertop Slab** (height = `countertopThicknessCm`, default `3cm`) directly on top of any `base_cabinet`, `under_counter_oven`, or `corner_blocker` (and optionally bridging over a `washing_machine` if flanked by base cabinets).
- If base elements touch (`gap === 0`), merge their countertop into a single continuous horizontal rectangle with a single total width dimension label.

### 4.4 Dragging, Magnetic Snapping & Freeform Bypass
- Users can drag any item along the `X` axis (and along the `Y` axis for `upper_cabinet` and `window`).
- **Magnetic Snapping:** While dragging, if an item's left or right edge comes within **`3cm`** of:
  - The left wall boundary (`X = 0`),
  - The right wall boundary (`X = wall.widthCm`), or
  - Another item's left or right edge within the same vertical layer (Floor Layer vs. Upper Layer),
  automatically snap the coordinate so they sit completely flush (`gap = 0cm`).
- **Bypass Modifier:** Holding the **`Shift` key** while dragging disables magnetic snapping for 1cm resolution freeform placement.
- **Wall Clamping:** Prevent items from being dragged outside `[0, wall.widthCm - item.width]`.

### 4.5 Validation Rules: `< 10cm` Gap Warning & Overlap Detection
Evaluate items within the same vertical layer (e.g., Floor-standing items: `base_cabinet`, `tall_cabinet`, `corner_blocker`, `fridge`, `washing_machine`, `under_counter_oven`; Upper items: `upper_cabinet`, `window`):
1. **Awkward Gap Warning (`0.1cm <= gap < 10cm`):**
   - Check the horizontal distance between adjacent items in the same layer, and between items and the left/right room walls.
   - If a gap is strictly greater than `0cm` and strictly less than `10cm`, render a **bright red hatched warning zone** in that gap on the canvas with a bold red callout badge: `"! GAP: X.X cm (<10cm)"`.
2. **Collision / Overlap Warning:**
   - If two items on the same layer overlap horizontally (and vertically for upper items/windows), highlight both items' borders in dashed red and display an `"OVERLAP"` badge. (Note: `sink` and `stove` are allowed to overlap horizontally with the `base_cabinet` or `under_counter_oven` directly beneath them).

---

## 5. Right-Side Inspector Panel (Click-to-Edit Options)
Clicking any element on the canvas selects it (highlighting its outline in blue) and opens its **Inspector Panel** on the right sidebar:
1. **Position & Size (Exact Numeric Inputs):**
   - `X Position (cm)` (distance from left wall) and `Distance from Right Wall (cm)` (bi-directional calculation).
   - `Y Elevation (cm)` (editable for Upper Cabinets and Windows; locked to `0` or toggleable for floor items).
   - `Width (cm)` (with quick-preset buttons: `30, 40, 45, 60, 80, 90, 100, 120` plus custom number input).
   - `Height (cm)` (custom number input).
   - `Toe-Kick (Plinth) Height (cm)` (toggleable checkbox + height input, default `10cm`).
2. **Cabinet Configuration (`base_cabinet` & `upper_cabinet`):**
   - Toggle: **Doors** vs. **Drawers**.
   - If **Doors**: Select `1 Door` or `2 Doors` (draws vertical center split line and schematic handle ticks).
   - If **Drawers**: Select number of drawers (`1` to `5`).
   - **Drawer Height Distribution:**
     - Preset buttons: `"Equal Split"`, `"1 Thin + 2 Deep (20% / 40% / 40%)"`, `"2 Thin + 1 Deep (25% / 25% / 50%)"`.
     - Custom percentage/cm inputs for each drawer from top to bottom (automatically normalizes or validates that sum = `100%` of usable cabinet box height `height - toeKickHeight`).
     - Visually render the exact horizontal divider lines and drawer pulls on the schematic canvas, along with the exact height in `cm` printed inside each drawer face.
3. **Tall Tower Cabinet Configuration (`tall_cabinet`):**
   - Configure stacked vertical zones (Bottom Zone, Middle Zone, Top Zone).
   - For each zone, select type (`Drawers`, `Built-in Oven`, `Microwave`, `Cabinet Door`, `Open Shelf`) and its height percentage/cm.
4. **Actions:**
   - `Duplicate Element`, `Delete Element` (also bound to `Delete`/`Backspace` key).

---

## 6. Architectural Dimensioning & Export
- **Canvas Dimension Lines:**
  - Automatically draw architectural dimension lines above and below the wall schematic:
    - Total Wall Width & Height.
    - Individual element widths (`W x H`) printed cleanly inside or below each unit.
    - Distance measurements for any empty wall spans (`>= 10cm` in neutral gray, `< 10cm` in warning red).
- **Save & Export Bar:**
  - `Save to DB` button (persists to PostgreSQL + shows last saved timestamp) and `Load Project` modal.
  - `Export JSON` / `Import JSON` backup buttons.
  - `Export Schematic PNG / Print PDF` button that renders the clean schematic elevation (with a summary schedule table of all cabinets and dimensions below the drawing) for printing or sharing.

---

## 7. Implementation Execution Order
0. (Revision 2) Room model + Plan View: `lib/plan.ts` (frames, plan rects, conflicts, room sync), `lib/migrate.ts` (old single-strip projects → room model on Load/Import), `PlanDrawing`/`PlanCanvas`, view switcher, depth & wall selector in the Inspector, plan page first in Print/PDF.
1. Set up `docker-compose.yml` (`db`, `backend`, `frontend`), FastAPI models/routes, and verify PostgreSQL connection.
2. Build the core TypeScript state, default element generators, and coordinate/snapping/gap-detection math utilities.
3. Build the interactive SVG Elevation Canvas with schematic rendering for all 10 element categories, continuous countertop merging, and `<10cm` red gap callouts.
4. Build the Right-Side Inspector Panel (including unequal drawer split controls and Tall Tower zone builder) and Top Wall Management Tabs.
5. Wire up Save/Load to the FastAPI PostgreSQL backend and add JSON/PNG export.

---

## 8. Resolved Decisions (confirmed with the product owner)
1. **Cross-layer collision (tall units vs. upper layer):** Floor-standing units that reach up into an upper item's height band (e.g. `tall_cabinet` 0–215cm, `fridge` 0–185cm vs. an `upper_cabinet` at 145–215cm or a `window`) interact with the Upper Layer:
   - **Overlap:** flagged when they overlap both horizontally and vertically. Low floor units (e.g. `base_cabinet` 0–87cm) under upper cabinets are never an overlap.
   - **Gap warning:** the upper-layer gap check includes such tall floor units as neighbours (e.g. a 4cm gap between a tower and an upper cabinet is a `< 10cm` warning). The upper layer only reports gaps that touch at least one upper item; floor-to-floor gaps stay on the floor layer, so nothing is reported twice.
   - **Snapping & spawn placement:** upper items snap to the edges of tall floor units within their height band (and vice versa), and new upper items spawn in a slot free of them.
2. **Sink / Stove movement:** `sink` and `stove` move **independently** of the base cabinet beneath them. Dragging a base cabinet does not carry them along. Their `y` is still auto-derived from the countertop-bearing unit under their centre (default `87cm`).
3. **Undo / Redo:** supported for all project data edits.
   - Shortcuts: `Cmd/Ctrl+Z` (undo), `Shift+Cmd/Ctrl+Z` or `Ctrl+Y` (redo), plus header buttons. When focus is in a text/number input, the browser's native input undo applies instead.
   - A continuous drag, or continuous typing into one field, is grouped into a single undo step (same-key edits within 1s coalesce).
   - Switching the active wall tab is not an undo step. History holds 100 steps and is cleared on New / Load / Import.

4. **Primary view is the top-down Plan; the per-wall Elevation is the "horizontal view".** The room is a **rectangle** (4 fixed walls + free islands). Items are **editable in both views**, which stay in sync because they edit the same data. In the plan, upper cabinets are **dashed outlines** and windows are glazed gaps in the wall.

5. **Remove wall = open side.** Any of the 4 walls can be removed (with confirmation): it gets `removed: true`, its items are deleted, its tab disappears, the plan draws a dashed "OPEN · Wall X" edge instead of a wall, and it is excluded from exports. A **Restore Wall X** button brings it back (empty). The last remaining run cannot be removed.
6. **Water bar** = a water dispenser standing on the countertop (`water_bar`, default 30×45, depth 40). Counter layer: `y` follows the countertop, and it collides with other counter items.
7. **Coffee machine** = both a countertop machine (`coffee_machine`, default 35×40, depth 40, counter layer) and a built-in **"Coffee Machine" zone** (`coffee`) for the tall tower.
8. **Door** = hinged door in a wall (`door`, default 90×210, `y` always 0, walls only; refused on islands).
   - Inspector: hinge **left/right** (seen from inside the room) and opens **into / out of** the room.
   - Elevation: frame, leaf, swing lines, lever handle at 105cm and an "OPENS IN/OUT" label.
   - Plan: an opening in the wall with the leaf and a dashed 90° swing arc.
   - It is an opening in the upper layer, so base units in front of it and upper cabinets/windows over it are flagged as **OVERLAP**, and neighbouring units snap to its edges. An inward swing that hits floor units on other walls or an island is flagged **DOOR SWING**.
9. **Counter appliances must stand on a countertop.** A sink, cooktop, water bar or coffee machine not fully on a countertop slab gets a **NO COUNTERTOP** warning (elevation, plan, print). New ones go onto a free base unit if there is one, otherwise into the first free stretch of countertop.

10. **3D view** (`three`, loaded only when the 3D view is first opened):
    - **Orbit only:** drag to rotate, right-drag to pan, scroll to zoom, a **Reset view** button, and the camera never goes below the floor. No first-person walking.
    - **Clean shaded style:** solid surfaces with soft light and shadows, plus dark outlined edges. White fronts, grey countertop, light walls, and windows as translucent glass.
    - The model includes recessed plinths, handles, oven/microwave/coffee windows, sink bowls and faucet, cooktop burners, washer drum, and door leaves in their wall openings. Islands are included and open sides have no wall.
    - Walls whose outer face points at the camera are hidden automatically (dollhouse view).
    - **Only cabinet fronts are editable in 3D:** clicking a base or wall cabinet selects it (blue edges). The side panel then offers only **Doors ↔ Drawers** and **number of drawers (1–5, equal split)**. Clicking anything else deselects.
    - In 3D the catalog, the room/wall settings bar, the full Inspector, and the Delete/arrow keys are disabled. Undo/redo still works.

11. **Sockets.** The catalog's **Electrical** group has Single / Double / Triple / Quadruple socket (`socket` with `socketCount` 1–4; plate 8 / 15 / 22 / 29 × 8 cm) and **Power socket 16A** (`power_socket`, 9 × 9 cm, drawn in red).
    - **Placement:** walls only (refused on islands), any X and any height. The Inspector sets the **centre height** with presets 30 / 60 / 110 / 120 cm (default 110) and changes the outlet count (the plate width follows). Sockets drag freely in X and Y in the elevation and slide along the wall in the plan.
    - **Separate electrical layer:** sockets never collide with cabinets (behind a base unit or fridge is allowed). Overlapping plates are flagged, and plates snap flush to each other.
    - **Checks:** **SOCKET IN OPENING** (inside a window/door) and **SOCKET HIDDEN** (covered by an upper or tall cabinet), shown in the elevation, the plan and print.
    - **New socket placement:** 10 cm into the first countertop, at the first reachable free spot.
    - **Rendering:** the elevation shows the plate, outlets and "h <centre>" label; the plan a small plate on the wall face labelled S1–S4 / 16A; 3D plates on the wall.
    - **Print/PDF:** an **Electrical Schedule** page after the floor plan lists every socket (wall, label, type, X centre, height centre, ⚠ note) with totals per type and the number of regular outlets.

### Implementation Assumptions (in effect unless changed)
- `sink`/`stove` form their own "counter layer": they only check overlaps against each other, and snap to each other and to countertop-bearing unit edges.
- A `washing_machine` gets a countertop only when countertop-bearing units touch it on both sides. Adjacent base units with different heights produce separate countertop slabs.
- Floor items show `Y` locked at 0 with an unlock toggle in the Inspector. The toggle is UI-only and not persisted, so the JSON schema is unchanged.
- "Add Island" creates a 240×90 island centred in the room. The 4 room walls cannot be deleted.
- Moving an item to another wall is done with the Inspector's "Wall / run" select (no dragging across corners). `corner_blocker` stays manual in the elevation; the plan flags real corner clashes.
- Legacy projects (no `room`): first wall's width → room width, second wall's width → room depth (else 300), first 4 walls → N/E/S/W, extra walls → islands, missing `depth` → category default.
- Print/PDF: page 1 is the floor plan with a run summary; then one elevation page per run that has elements. PNG exports the current view (plan, or the active elevation when the Elevation view is showing).
- If no free slot fits a new element, it spawns at `x = 0` and is flagged as an overlap.
- Arrow keys nudge the selection 1cm (`Shift` = 10cm, ↑/↓ only for upper-layer items); `Esc` deselects.