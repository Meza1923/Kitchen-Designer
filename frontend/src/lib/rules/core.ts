/** Rule system types and the helpers rules share (naming, corners, opening reach, hinge edges, thresholds). */
import type { KitchenItem, ProjectData, WallRun } from '../../types';
import { CATEGORY_LABELS } from '../defaults';
import { fmt, fridgeDoors, layerOf } from '../geometry';
import { runEnds, WALL_THICKNESS_CM, type Rect } from '../plan';

/** error = physical conflict (red frame) · warning = good-practice guideline (amber frame) · info = list only. */
export type Severity = 'error' | 'warning' | 'info';

export interface Violation {
  rule: string;
  severity: Severity;
  /** Short label for the badge on the drawing. */
  badge: string;
  /** One sentence for the problems list: what is wrong and where. */
  message: string;
  items: { runId: string; itemId: string }[];
  /** Area to hatch in a run's elevation (wall-local cm, y up from the floor). */
  wallArea?: { runId: string; x0: number; x1: number; y0: number; y1: number };
  /** Area to hatch in the plan (plan cm). */
  planArea?: Rect;
  /** One-click repair, if the rule has one. */
  fix?: Fix;
}

export interface Fix {
  label: string;
  /** The repaired project, or a sentence explaining why the fix can't be applied. */
  apply: (data: ProjectData) => ProjectData | string;
}

export interface RuleContext {
  data: ProjectData;
}

export interface Rule {
  id: string;
  title: string;
  check: (ctx: RuleContext) => Violation[];
}

export const itemName = (i: KitchenItem) => i.label || CATEGORY_LABELS[i.category];
export const at = (run: WallRun, i: KitchenItem) => `${itemName(i)} on ${run.name} (X ${fmt(i.x)})`;
export const ref = (run: WallRun, i: KitchenItem) => ({ runId: run.id, itemId: i.id });

/** Applies `check` to every run; for rules that only look at one run at a time. */
export const perRun =
  (check: (run: WallRun) => Violation[]) =>
  ({ data }: RuleContext) =>
    liveRuns(data).flatMap(check);

/** Runs that exist (walls not removed, and islands). */
export const liveRuns = (data: ProjectData) => data.walls.filter((w) => !(w.kind === 'wall' && w.removed));

/**
 * Two-step threshold for rules given as a range: below `min` → `severity`; between `min` and `ok` → one step
 * softer (error → warning, warning → info); otherwise fine (null).
 */
export function graded(value: number, min: number, ok: number, severity: Severity): Severity | null {
  if (value < min) return severity;
  if (value < ok) return severity === 'error' ? 'warning' : 'info';
  return null;
}

export const floorUnits = (run: WallRun) => run.items.filter((i) => layerOf(i.category) === 'floor' && i.depth > 0);

export type End = 'start' | 'end';

/**
 * One run's side of an inside corner; every corner appears twice, once from each run. `pos` is where the corner is
 * along the run (0 or its length at a room corner; in the middle of a wall where a partition stands on it, #10), and
 * `end` says which side of it the run's units are on: 'start' = they stand after it, 'end' = before it.
 */
export interface Corner {
  run: WallRun;
  end: End;
  pos: number;
  neighbour: WallRun;
  neighbourEnd: End;
  neighbourPos: number;
}

/** Distance (cm) from an item to a corner position along its run; Infinity when it stands on the other side. */
function distTo(i: KitchenItem, end: End, pos: number): number {
  const centre = i.x + i.width / 2;
  if (end === 'start') return centre < pos ? Infinity : i.x - pos;
  return centre > pos ? Infinity : pos - (i.x + i.width);
}
/** Distance from one of the corner run's items to the corner. */
export const cornerDist = (c: Corner, i: KitchenItem) => distTo(i, c.end, c.pos);
/** Distance from one of the neighbour's items to the corner. */
export const neighbourDist = (c: Corner, i: KitchenItem) => distTo(i, c.neighbourEnd, c.neighbourPos);

/** Where the neighbour's corner is along the neighbour: a run end, or a partition's T-joint on its host wall. */
function neighbourPosOf(run: WallRun, neighbour: WallRun, end: End): number {
  if (run.kind === 'partition' && neighbour.id === run.hostId) {
    const x = run.hostX ?? 0;
    return run.face === 'b' ? x + WALL_THICKNESS_CM : x;
  }
  return end === 'start' ? 0 : neighbour.widthCm;
}

export function corners(data: ProjectData): Corner[] {
  const out = liveRuns(data).flatMap((run) => {
    const ends = runEnds(data, run);
    return (['start', 'end'] as const).flatMap((end): Corner[] => {
      const e = ends[end];
      if (e.kind !== 'inside_corner') return [];
      const neighbour = data.walls.find((w) => w.id === e.neighbourId);
      if (!neighbour) return [];
      const pos = end === 'start' ? 0 : run.widthCm;
      return [
        {
          run,
          end,
          pos,
          neighbour,
          neighbourEnd: e.neighbourEnd,
          neighbourPos: neighbourPosOf(run, neighbour, e.neighbourEnd),
        },
      ];
    });
  });
  // A T-joint is only seen from the partition's side by runEnds; add the host wall's side of it.
  const mirrors = out
    .filter((c) => c.run.kind === 'partition')
    .map((c) => ({
      run: c.neighbour,
      end: c.neighbourEnd,
      pos: c.neighbourPos,
      neighbour: c.run,
      neighbourEnd: c.end,
      neighbourPos: c.pos,
    }));
  return [...out, ...mirrors];
}

/** The neighbour's floor units standing in the corner (touching its corner end). */
export const cornerUnits = (c: Corner) => floorUnits(c.neighbour).filter((i) => neighbourDist(c, i) < 1);

/** How far the neighbour's corner units reach out of the corner along this run; 0 when the corner is free. */
export const cornerDepth = (c: Corner) => Math.max(0, ...cornerUnits(c).map((i) => i.depth));

/** Fronts that pull straight out (drawers, oven doors). */
export const isPullOut = (i: KitchenItem) =>
  i.category === 'under_counter_oven' ||
  (i.category === 'base_cabinet' && i.frontType === 'drawers') ||
  (i.category === 'tall_cabinet' && (i.tallZones ?? []).some((z) => z.type === 'drawers' || z.type === 'oven'));

export const hasOvenZone = (i: KitchenItem) =>
  i.category === 'tall_cabinet' && (i.tallZones ?? []).some((z) => z.type === 'oven');

/** Edges of the item (start = its left edge, end = its right edge) where a door is hinged. */
export function hingeEdges(i: KitchenItem): End[] {
  if (i.category === 'fridge') {
    const doors = fridgeDoors(i.fridgeType);
    return [
      ...(doors.some((d) => d.hinge === 'left' && d.fx0 === 0) ? (['start'] as const) : []),
      ...(doors.some((d) => d.hinge === 'right' && d.fx1 === 1) ? (['end'] as const) : []),
    ];
  }
  if (i.category === 'tall_cabinet' && (i.tallZones ?? []).some((z) => z.type === 'door')) {
    return [(i.doorHinge ?? 'left') === 'left' ? 'start' : 'end'];
  }
  return [];
}

/** How far (cm) an element's fronts reach into the room in front of it when fully open; 0 when nothing opens. */
export function openReach(i: KitchenItem): number {
  const drawer = i.depth * 0.9;
  switch (i.category) {
    case 'base_cabinet':
      return i.frontType === 'drawers' ? drawer : i.frontType === 'open' ? 0 : i.width / i.doorCount;
    case 'tall_cabinet':
      return Math.max(
        0,
        ...(i.tallZones ?? []).map((z) =>
          z.type === 'door' ? i.width : z.type === 'drawers' ? drawer : z.type === 'oven' ? 50 : 0,
        ),
      );
    case 'fridge':
      return Math.max(...fridgeDoors(i.fridgeType).map((d) => (d.fx1 - d.fx0) * i.width));
    case 'under_counter_oven':
    case 'washing_machine':
      return 50;
    default:
      return 0;
  }
}
