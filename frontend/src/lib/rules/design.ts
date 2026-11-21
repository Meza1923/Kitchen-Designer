/**
 * Design rules R1–R19 (FEATURES.md #5). Phase B: the rules that need no new element types.
 * Distances are cm; the rule texts give mm.
 */
import type { KitchenItem, ProjectData, WallRun } from '../../types';
import { computeCountertops, fmt, isCounterBearing, layerOf, round1 } from '../geometry';
import {
  doorSwingRect,
  islandFootprint,
  islandOf,
  islandOverhangs,
  isIslandFront,
  itemPlanRect,
  localRect,
  partitionRects,
  rectIntersection,
  rectsOverlap,
  runEnds,
  segmentHitsRect,
  wallFrame,
  type Frame,
  type Pt,
  type Rect,
} from '../plan';
import {
  at,
  cornerDepth,
  corners,
  cornerDist,
  cornerUnits,
  neighbourDist,
  floorUnits,
  graded,
  hasOvenZone,
  hingeEdges,
  isPullOut,
  itemName,
  liveRuns,
  openReach,
  perRun,
  ref,
  type Corner,
  type End,
  type Rule,
  type Severity,
  type Violation,
} from './core';
import { addScribeFiller, insertFiller } from './fixes';
import { lineInOutline, rectInOutline, roomOutline } from '../outline';
import { runName, t } from '../i18n';
import { SIDE_NAMES } from '../island';

const CORNER_FILLER = 5; // R1
const HINGE_GAP = [5, 10] as const; // R2
const AISLE_MIN = 105; // R4
const WINDOW_CASING = 5; // R5
const COOKTOP_SIDE = [20, 30] as const; // R6
const SINK_COOKTOP = [40, 60] as const; // R7
const HOOD_MIN_ELECTRIC = 65; // R8
const HOOD_MIN_GAS = 75; // R8
const DW_DOOR = 60; // R3: how far an open dishwasher door reaches
const DW_SINK_MAX = 150; // R12
const OVERHANG_MAX = 30; // R13
const KNEE_MIN = 25; // R13: countertop over the knees of someone sitting
const SCRIBE = [3, 5] as const; // R14
const LANDING = 40; // R15
const TRIANGLE = [120, 270] as const; // R17

const right = (i: KitchenItem) => i.x + i.width;

/** A fix that puts a filler of `width` against the corner obstacle (wall or perpendicular fronts) at corner `c`. */
const cornerFiller = (c: Corner, obstacle: number, width: number, serves: KitchenItem) => ({
  label: t('Add {width} cm filler', { width }),
  apply: (data: ProjectData) =>
    c.end === 'start'
      ? insertFiller(data, c.run.id, c.pos + obstacle, width, 'end', serves)
      : insertFiller(data, c.run.id, c.pos - obstacle, width, 'start', serves),
});
const isTall = (i: KitchenItem) => i.category === 'tall_cabinet' || i.category === 'fridge';
const ofCategory = (run: WallRun, ...cats: KitchenItem['category'][]) =>
  run.items.filter((i) => cats.includes(i.category));
/** Gap between two items along a run (negative when they overlap). */
const edgeGap = (a: KitchenItem, b: KitchenItem) => Math.max(a.x, b.x) - Math.min(right(a), right(b));
const v = (
  rule: string,
  severity: Severity,
  badge: string,
  message: string,
  rest: Partial<Violation> = {},
): Violation => ({
  rule,
  severity,
  badge,
  message,
  items: [],
  ...rest,
});

const R1: Rule = {
  id: 'R1',
  title: 'Corner pull-out collision',
  check: ({ data }) =>
    corners(data).flatMap((c) => {
      const depth = cornerDepth(c);
      if (depth === 0) return [];
      const other = cornerUnits(c)[0];
      return floorUnits(c.run)
        .filter(isPullOut)
        .flatMap((i) => {
          const clearance = cornerDist(c, i) - depth;
          if (clearance < -0.5 || clearance >= CORNER_FILLER) return [];
          return [
            v(
              'R1',
              'error',
              'CORNER PULL-OUT',
              t(
                '{item} opens into the corner {clearance} cm from {name} on {neighbour}: add a filler of at least {CORNER_FILLER} cm so the handles clear.',
                {
                  item: at(c.run, i),
                  clearance: fmt(Math.max(0, clearance)),
                  name: itemName(other),
                  neighbour: runName(c.neighbour.name),
                  CORNER_FILLER,
                },
              ),
              {
                items: [ref(c.run, i), ref(c.neighbour, other)],
                fix: cornerFiller(c, depth, CORNER_FILLER, i),
              },
            ),
          ];
        });
    }),
};

const R2: Rule = {
  id: 'R2',
  title: 'Wall-adjacent hinge binding',
  check: ({ data }) =>
    corners(data).flatMap((c) => {
      const obstacle = cornerDepth(c); // the perpendicular wall, or the fronts of units standing in the corner
      return floorUnits(c.run)
        .filter((i) => hingeEdges(i).includes(c.end))
        .flatMap((i) => {
          const gap = cornerDist(c, i) - obstacle;
          const severity = gap >= -0.5 ? graded(gap, HINGE_GAP[0], HINGE_GAP[1], 'error') : null;
          if (!severity) return [];
          return [
            v(
              'R2',
              severity,
              'HINGE AT WALL',
              t(
                obstacle
                  ? '{item} is hinged {gap} cm from the units on {neighbour}: leave {HINGE_GAP}–{HINGE_GAP2} cm so the door opens past 90°.'
                  : '{item} is hinged {gap} cm from the wall on {neighbour}: leave {HINGE_GAP}–{HINGE_GAP2} cm so the door opens past 90°.',
                {
                  item: at(c.run, i),
                  gap: fmt(Math.max(0, gap)),
                  neighbour: runName(c.neighbour.name),
                  HINGE_GAP: HINGE_GAP[0],
                  HINGE_GAP2: HINGE_GAP[1],
                },
              ),
              {
                items: [ref(c.run, i)],
                fix: cornerFiller(c, obstacle, HINGE_GAP[1], i),
              },
            ),
          ];
        });
    }),
};

interface Placed {
  run: WallRun;
  f: Frame;
  item: KitchenItem;
  rect: Rect;
}

/** Position of the item's front face along the frame's normal axis. */
const frontAlong = (p: Placed, n: Pt) => {
  const r = p.rect;
  return n.x > 0 ? r.x + r.w : n.x < 0 ? r.x : n.y > 0 ? r.y + r.h : r.y;
};

const R4: Rule = {
  id: 'R4',
  title: 'Opposing aisle deadlock',
  check: ({ data }) => {
    const placed: Placed[] = liveRuns(data).flatMap((run) => {
      const f = wallFrame(data.room, run);
      return floorUnits(run).map((item) => ({ run, f, item, rect: itemPlanRect(f, item) }));
    });
    const outline = roomOutline(data.room);
    const partitions = partitionRects(data);
    const out: Violation[] = [];
    const narrowest = new Map<string, { gap: number; p: Placed; q: Placed; area: Rect }>();
    for (const p of placed) {
      for (const q of placed) {
        const n = p.f.n;
        if (p.run.id >= q.run.id || n.x !== -q.f.n.x || n.y !== -q.f.n.y) continue;
        // Overlap across the aisle, and the gap between the two fronts along it.
        const [a0, a1, b0, b1] =
          n.x !== 0
            ? [p.rect.y, p.rect.y + p.rect.h, q.rect.y, q.rect.y + q.rect.h]
            : [p.rect.x, p.rect.x + p.rect.w, q.rect.x, q.rect.x + q.rect.w];
        const o0 = Math.max(a0, b0);
        const o1 = Math.min(a1, b1);
        if (o1 - o0 < 1) continue;
        const sign = n.x + n.y;
        const pf = frontAlong(p, n);
        const qf = frontAlong(q, q.f.n);
        const gap = (qf - pf) * sign;
        if (gap <= 0) continue;
        const lo = Math.min(pf, qf);
        const area = n.x !== 0 ? { x: lo, y: o0, w: gap, h: o1 - o0 } : { x: o0, y: lo, w: o1 - o0, h: gap };
        // Runs facing each other across a wall (the notch of a U, the tip of an L, a partition) share no aisle.
        if (!rectInOutline(outline, area) || partitions.some(({ rect }) => rectsOverlap(area, rect))) continue;
        const reach = openReach(p.item) + openReach(q.item);
        if (reach > gap) {
          out.push(
            v(
              'R4',
              'error',
              'FRONTS COLLIDE',
              t('Open fronts of {item} and {item2} collide: they need {reach} cm, the aisle is {gap} cm.', {
                item: at(p.run, p.item),
                item2: at(q.run, q.item),
                reach: fmt(reach),
                gap: fmt(gap),
              }),
              {
                items: [ref(p.run, p.item), ref(q.run, q.item)],
                planArea: area,
              },
            ),
          );
        }
        const key = `${p.run.id}|${q.run.id}`;
        if (gap < AISLE_MIN && gap < (narrowest.get(key)?.gap ?? Infinity)) narrowest.set(key, { gap, p, q, area });
      }
    }
    for (const { gap, p, q, area } of narrowest.values()) {
      out.push(
        v(
          'R4',
          'warning',
          'NARROW AISLE',
          t('The aisle between {run} and {run2} is {gap} cm; at least {AISLE_MIN} cm is needed to work and pass.', {
            run: runName(p.run.name),
            run2: runName(q.run.name),
            gap: fmt(gap),
            AISLE_MIN,
          }),
          {
            items: [ref(p.run, p.item), ref(q.run, q.item)],
            planArea: area,
          },
        ),
      );
    }
    return out;
  },
};

const R5: Rule = {
  id: 'R5',
  title: 'Room door and window collision',
  check: ({ data }) => {
    const out: Violation[] = [];
    // Tall units right next to a window: they cover its casing.
    for (const run of liveRuns(data)) {
      for (const win of ofCategory(run, 'window')) {
        for (const tall of run.items.filter(isTall)) {
          const gap = edgeGap(tall, win);
          const vertical = tall.y < win.y + win.height && win.y < tall.y + tall.height;
          if (gap >= 0 && gap < WINDOW_CASING && vertical) {
            out.push(
              v(
                'R5',
                'error',
                'BLOCKS WINDOW',
                t('{item} stands {gap} cm from the window: it covers the window casing (needs {WINDOW_CASING} cm).', {
                  item: at(run, tall),
                  gap: fmt(gap),
                  WINDOW_CASING,
                }),
                {
                  items: [ref(run, tall), ref(run, win)],
                },
              ),
            );
          }
        }
      }
    }
    // Cabinet fronts opening into the sweep of an inward room door.
    for (const run of liveRuns(data).filter((w) => w.kind === 'wall')) {
      const f = wallFrame(data.room, run);
      for (const door of ofCategory(run, 'door').filter((d) => d.doorSwing !== 'out')) {
        const swing = doorSwingRect(f, door);
        for (const other of liveRuns(data)) {
          const of = wallFrame(data.room, other);
          for (const i of floorUnits(other)) {
            const reach = openReach(i);
            if (!reach) continue;
            const sweep = localRect(of, i.x, right(i), i.depth, i.depth + reach);
            if (!rectsOverlap(swing, sweep)) continue;
            out.push(
              v(
                'R5',
                'error',
                'DOOR SWEEP',
                t('The open front of {item} swings into the sweep of the room door on {run}.', {
                  item: at(other, i),
                  run: runName(run.name),
                }),
                {
                  items: [ref(other, i), ref(run, door)],
                  planArea: rectIntersection(swing, sweep),
                },
              ),
            );
          }
        }
      }
    }
    return out;
  },
};

const R6: Rule = {
  id: 'R6',
  title: 'Cooktop lateral clearance',
  check: ({ data }) => {
    const all = corners(data);
    return liveRuns(data).flatMap((run) =>
      ofCategory(run, 'stove').flatMap((stove) => {
        const sides: { gap: number; what: string; who?: KitchenItem }[] = [];
        // Tall units, and columns standing at cooktop height (review finding R16).
        const beside = (i: KitchenItem) =>
          isTall(i) || (i.category === 'column' && i.y < stove.y && i.y + i.height > stove.y);
        for (const tall of run.items.filter(beside))
          sides.push({ gap: edgeGap(stove, tall), what: itemName(tall), who: tall });
        for (const c of all.filter((k) => k.run.id === run.id)) {
          const units = cornerUnits(c);
          const d = cornerDist(c, stove);
          if (!Number.isFinite(d)) continue;
          // A bare wall, or tall units standing in the corner; base units there leave the space above free.
          if (!units.length)
            sides.push({ gap: d, what: t('the wall ({neighbour})', { neighbour: runName(c.neighbour.name) }) });
          else if (units.some(isTall))
            sides.push({
              gap: d - cornerDepth(c),
              what: t('the tall units on {neighbour}', { neighbour: runName(c.neighbour.name) }),
            });
        }
        return sides.flatMap(({ gap, what, who }) => {
          const severity = gap >= -0.5 ? graded(gap, COOKTOP_SIDE[0], COOKTOP_SIDE[1], 'warning') : null;
          if (!severity) return [];
          return [
            v(
              'R6',
              severity,
              'COOKTOP CLEARANCE',
              t('{item} is {gap} cm from {what}; keep {COOKTOP_SIDE}–{COOKTOP_SIDE2} cm beside a cooktop.', {
                item: at(run, stove),
                gap: fmt(Math.max(0, gap)),
                what,
                COOKTOP_SIDE: COOKTOP_SIDE[0],
                COOKTOP_SIDE2: COOKTOP_SIDE[1],
              }),
              {
                items: [ref(run, stove), ...(who ? [ref(run, who)] : [])],
              },
            ),
          ];
        });
      }),
    );
  },
};

const R7: Rule = {
  id: 'R7',
  title: 'Sink-to-cooktop separation',
  check: perRun((run) => {
    const slabs = computeCountertops(run);
    const slabOf = (i: KitchenItem) => slabs.findIndex((s) => i.x >= s.x - 0.5 && right(i) <= s.x + s.width + 0.5);
    return ofCategory(run, 'sink').flatMap((sink) =>
      ofCategory(run, 'stove').flatMap((stove) => {
        const gap = edgeGap(sink, stove);
        const same = slabOf(sink) >= 0 && slabOf(sink) === slabOf(stove);
        const severity = same && gap >= 0 ? graded(gap, SINK_COOKTOP[0], SINK_COOKTOP[1], 'warning') : null;
        if (!severity) return [];
        return [
          v(
            'R7',
            severity,
            'SINK ↔ COOKTOP',
            t(
              'Only {gap} cm of countertop between the sink and the cooktop on {run}; aim for {SINK_COOKTOP}–{SINK_COOKTOP2} cm.',
              { gap: fmt(gap), run: runName(run.name), SINK_COOKTOP: SINK_COOKTOP[0], SINK_COOKTOP2: SINK_COOKTOP[1] },
            ),
            {
              items: [ref(run, sink), ref(run, stove)],
              wallArea: {
                runId: run.id,
                x0: Math.min(right(sink), right(stove)),
                x1: Math.max(sink.x, stove.x),
                y0: sink.y,
                y1: sink.y + 10,
              },
            },
          ),
        ];
      }),
    );
  }),
};

const R8: Rule = {
  id: 'R8',
  title: 'Overhead hood clearance',
  check: perRun((run) =>
    ofCategory(run, 'stove').flatMap((stove) => {
      const surface = stove.y + run.countertopThicknessCm;
      const gas = stove.cooktopType === 'gas';
      const min = gas ? HOOD_MIN_GAS : HOOD_MIN_ELECTRIC;
      return ofCategory(run, 'upper_cabinet', 'shelf', 'hood')
        .filter((u) => edgeGap(u, stove) < -1)
        .flatMap((u) => {
          const clearance = u.y - surface;
          if (clearance >= min || clearance < 0) return [];
          return [
            v(
              'R8',
              'error',
              'TOO LOW ABOVE COOKTOP',
              t(
                gas
                  ? '{item} is {clearance} cm above the gas cooktop; at least {min} cm is needed.'
                  : '{item} is {clearance} cm above the cooktop; at least {min} cm is needed ({gasMin} cm for gas).',
                { item: at(run, u), clearance: fmt(clearance), min, gasMin: HOOD_MIN_GAS },
              ),
              {
                items: [ref(run, u), ref(run, stove)],
                wallArea: {
                  runId: run.id,
                  x0: Math.max(u.x, stove.x),
                  x1: Math.min(right(u), right(stove)),
                  y0: surface,
                  y1: u.y,
                },
              },
            ),
          ];
        });
    }),
  ),
};

/** R3: an open dishwasher door right by an inside corner blocks the fronts of the run around the corner. */
const R3: Rule = {
  id: 'R3',
  title: 'Dishwasher corner trap',
  check: ({ data }) =>
    corners(data).flatMap((c) =>
      ofCategory(c.run, 'dishwasher').flatMap((dw) => {
        const clearance = cornerDist(c, dw) - cornerDepth(c);
        if (!Number.isFinite(clearance) || clearance < -0.5 || clearance >= DW_DOOR) return [];
        // Units around the corner whose fronts face into the space the open door takes (depth d … d + door).
        const blocked = floorUnits(c.neighbour).filter((y) => {
          const d = neighbourDist(c, y);
          return d < dw.depth + DW_DOOR && d + y.width > dw.depth && openReach(y) > clearance;
        });
        if (!blocked.length) return [];
        return [
          v(
            'R3',
            'error',
            'DISHWASHER CORNER',
            t(
              'The open door of {item} (about {DW_DOOR} cm) blocks {name} on {neighbour}: move the dishwasher at least {DW_DOOR} cm from the corner.',
              { item: at(c.run, dw), DW_DOOR, name: itemName(blocked[0]), neighbour: runName(c.neighbour.name) },
            ),
            { items: [ref(c.run, dw), ...blocked.map((y) => ref(c.neighbour, y))] },
          ),
        ];
      }),
    ),
};

/** R10: a dishwasher or washer at an open end of a run needs an end panel to close it. */
const R10: Rule = {
  id: 'R10',
  title: 'Unsupported appliance end-run',
  check: ({ data }) =>
    liveRuns(data).flatMap((run) => {
      const ends = runEnds(data, run);
      const units = floorUnits(run);
      return ofCategory(run, 'dishwasher', 'washing_machine').flatMap((a) => {
        // Open ends with nothing between the appliance and them.
        const open = (['start', 'end'] as End[]).filter(
          (end) =>
            ends[end].kind === 'open' &&
            !units.some((u) => u.id !== a.id && (end === 'start' ? right(u) <= a.x + 0.5 : u.x >= right(a) - 0.5)),
        );
        if (!open.length) return [];
        const sides = open.map((e) => t(e === 'start' ? 'left' : 'right')).join(t(' and '));
        return [
          v(
            'R10',
            'error',
            'NO END PANEL',
            t(
              '{item} stands at the open {sides} end of {run}: add an end panel to close the run and carry the countertop.',
              { item: at(run, a), sides, run: runName(run.name) },
            ),
            { items: [ref(run, a)] },
          ),
        ];
      });
    }),
};

/** R12: the dishwasher drains into the sink, so it belongs next to it. */
const R12: Rule = {
  id: 'R12',
  title: 'Dishwasher plumbing distance',
  check: ({ data }) => {
    const sinks = liveRuns(data).flatMap((run) => ofCategory(run, 'sink').map((s) => ({ run, s })));
    if (!sinks.length) return [];
    return liveRuns(data).flatMap((run) =>
      ofCategory(run, 'dishwasher').flatMap((dw) => {
        const same = sinks.filter((k) => k.run.id === run.id);
        if (!same.length)
          return [
            v(
              'R12',
              'warning',
              'DW FAR FROM SINK',
              t(
                '{item} is on a different run from the sink (across a corner): keep it within {DW_SINK_MAX} cm of the sink, on the same run.',
                { item: at(run, dw), DW_SINK_MAX },
              ),
              { items: [ref(run, dw), ref(sinks[0].run, sinks[0].s)] },
            ),
          ];
        const near = same.map((k) => ({ ...k, gap: Math.max(0, edgeGap(dw, k.s)) })).sort((p, q) => p.gap - q.gap)[0];
        if (near.gap <= DW_SINK_MAX) return [];
        return [
          v(
            'R12',
            'warning',
            'DW FAR FROM SINK',
            t('{item} is {gap} cm from the sink; keep it within {DW_SINK_MAX} cm for the drain.', {
              item: at(run, dw),
              gap: fmt(near.gap),
              DW_SINK_MAX,
            }),
            { items: [ref(run, dw), ref(run, near.s)] },
          ),
        ];
      }),
    );
  },
};

/** R16: a single-door fridge should open towards the counter where the food goes. */
const R16: Rule = {
  id: 'R16',
  title: 'Reverse refrigerator swing',
  check: perRun((run) =>
    ofCategory(run, 'fridge')
      .filter((f) => f.fridgeType === 'top_bottom')
      .flatMap((f) => {
        const slabs = computeCountertops(run);
        const gapLeft = Math.min(
          Infinity,
          ...slabs.filter((c) => c.x + c.width <= f.x + 0.5).map((c) => f.x - (c.x + c.width)),
        );
        const gapRight = Math.min(Infinity, ...slabs.filter((c) => c.x >= right(f) - 0.5).map((c) => c.x - right(f)));
        const hinge = f.doorHinge ?? 'left';
        // The door opens on the side away from the hinge; the nearest countertop should be on that side.
        const [hingeGap, openGap] = hinge === 'left' ? [gapLeft, gapRight] : [gapRight, gapLeft];
        if (!Number.isFinite(hingeGap) || hingeGap >= openGap) return [];
        return [
          v(
            'R16',
            'warning',
            'FRIDGE OPENS AWAY',
            t(
              '{item} opens away from the nearest countertop (on its {hinge} side): hinge it on the {left} so you can put things down while the door is open.',
              { item: at(run, f), hinge: t(hinge), left: t(hinge === 'left' ? 'right' : 'left') },
            ),
            {
              items: [ref(run, f)],
              fix: {
                label: t('Hinge it on the {left}', { left: t(hinge === 'left' ? 'right' : 'left') }),
                apply: (d: ProjectData) => ({
                  ...d,
                  walls: d.walls.map((w) =>
                    w.id === run.id
                      ? {
                          ...w,
                          items: w.items.map((i) =>
                            i.id === f.id ? { ...i, doorHinge: hinge === 'left' ? 'right' : 'left' } : i,
                          ),
                        }
                      : w,
                  ),
                }),
              },
            },
          ),
        ];
      }),
  ),
};

/** R19: trash next to the sink, and dishwasher and trash on opposite sides of it. */
const R19: Rule = {
  id: 'R19',
  title: 'Sink-dishwasher-trash conflict',
  check: perRun((run) =>
    ofCategory(run, 'sink').flatMap((sink) => {
      const trash = ofCategory(run, 'trash_cabinet');
      if (!trash.length) return [];
      const centre = sink.x + sink.width / 2;
      const side = (i: KitchenItem) => (i.x + i.width / 2 < centre ? 'left' : 'right');
      // The unit under the sink: trash should touch it (or stand under the sink itself).
      const under = floorUnits(run).find((u) => u.x <= centre && right(u) >= centre && u.category !== 'trash_cabinet');
      const nextTo = (bin: KitchenItem) =>
        edgeGap(bin, sink) <= 0.5 || (under !== undefined && Math.abs(edgeGap(bin, under)) <= 0.5);
      const out: Violation[] = [];
      const bin = trash.slice().sort((a, b) => Math.abs(a.x - sink.x) - Math.abs(b.x - sink.x))[0];
      if (!nextTo(bin))
        out.push(
          v(
            'R19',
            'warning',
            'TRASH NOT AT SINK',
            t("{item} isn't next to the sink: put the trash pull-out right beside it.", { item: at(run, bin) }),
            {
              items: [ref(run, bin), ref(run, sink)],
            },
          ),
        );
      for (const dw of ofCategory(run, 'dishwasher').filter((d) => side(d) === side(bin)))
        out.push(
          v(
            'R19',
            'warning',
            'DW AND TRASH SAME SIDE',
            t(
              '{item} and {name} are on the same side of the sink: put them on opposite sides so both can be used while rinsing.',
              { item: at(run, dw), name: itemName(bin) },
            ),
            { items: [ref(run, dw), ref(run, bin), ref(run, sink)] },
          ),
        );
      return out;
    }),
  ),
};

const R9: Rule = {
  id: 'R9',
  title: 'Thermal adjacency conflict',
  check: perRun((run) =>
    run.items.filter(hasOvenZone).flatMap((oven) =>
      ofCategory(run, 'fridge')
        .filter((fr) => Math.abs(edgeGap(oven, fr)) < 0.5)
        .map((fr) =>
          v(
            'R9',
            'warning',
            'OVEN NEXT TO FRIDGE',
            t(
              'The oven tower {item} stands directly against {name}: put an insulating panel or a narrow cabinet between them.',
              { item: at(run, oven), name: itemName(fr) },
            ),
            {
              items: [ref(run, oven), ref(run, fr)],
            },
          ),
        ),
    ),
  ),
};

const R11: Rule = {
  id: 'R11',
  title: 'Cabinet wall cutout span',
  check: perRun((run) => {
    // Joints: where one counter-bearing unit ends and the next one starts.
    const bearing = run.items.filter((u) => isCounterBearing(u.category));
    const joints = [...new Set(bearing.map(right))].filter((x) => bearing.some((u) => Math.abs(u.x - x) < 0.5));
    return ofCategory(run, 'sink', 'stove').flatMap((cut) => {
      const inside = joints.filter((x) => x > cut.x + 0.5 && x < right(cut) - 0.5);
      if (!inside.length) return [];
      return [
        v(
          'R11',
          'error',
          'CUTOUT OVER JOINT',
          t(
            'The cutout for {item} sits over the side panels between two base units (joint at X {join}): centre it on one unit.',
            { item: at(run, cut), join: inside.map(fmt).join(', ') },
          ),
          {
            items: [ref(run, cut)],
          },
        ),
      ];
    });
  }),
};

const R13: Rule = {
  id: 'R13',
  title: 'Unsupported countertop span',
  check: ({ data }) =>
    data.walls.filter(isIslandFront).flatMap((isl) => {
      const overhangs = islandOverhangs(data, isl);
      const out: Violation[] = [];
      for (const o of overhangs) {
        if (o.cantilever <= OVERHANG_MAX + 0.05 || o.supported) continue;
        const long = o.face === 'a' || o.face === 'b';
        const fitted = round1((isl.depthCm ?? 90) - (o.cantilever - OVERHANG_MAX));
        out.push(
          v(
            'R13',
            'error',
            'OVERHANG',
            t(
              long
                ? 'The countertop of {isl} sticks out {o} cm past the cabinets: over {OVERHANG_MAX} cm it needs support. Give both ends a waterfall, or make the island less deep.'
                : 'The countertop at the end of {isl} sticks out {o} cm past the cabinets: over {OVERHANG_MAX} cm it needs support. Add a waterfall at that end, or a cabinet.',
              { isl: runName(isl.name), o: fmt(o.cantilever), OVERHANG_MAX },
            ),
            {
              planArea: o.rect,
              ...(long && {
                fix: {
                  label: t('Make the island {cm} cm deep', { cm: fmt(fitted) }),
                  apply: (d: ProjectData) => ({
                    ...d,
                    walls: d.walls.map((w) => (w.id === isl.id ? { ...w, depthCm: fitted } : w)),
                  }),
                },
              }),
            },
          ),
        );
      }
      // Chairs need room for knees under the countertop.
      for (const run of [isl, ...data.walls.filter((w) => w.hostId === isl.id && w.kind === 'island')]) {
        const chairs = run.items.filter((i) => i.category === 'stool');
        if (!chairs.length) continue;
        const face = run.face && run.face !== 'a' ? run.face : 'a';
        const knees = overhangs.find((o) => o.face === face)?.cantilever ?? 0;
        if (knees >= KNEE_MIN) continue;
        out.push(
          v(
            'R13',
            'warning',
            'NO KNEE ROOM',
            t(
              'The chairs at the {side} of {isl} have {cm} cm of countertop over their knees: leave at least {min} cm (make the island deeper, or move the cabinets on that side).',
              { side: t(SIDE_NAMES[face]).toLowerCase(), isl: runName(isl.name), cm: fmt(knees), min: KNEE_MIN },
            ),
            { items: chairs.map((c) => ref(run, c)) },
          ),
        );
      }
      return out;
    }),
};

const R14: Rule = {
  id: 'R14',
  title: 'Zero-tolerance wall run',
  check: ({ data }) => {
    // Every stretch of a run between two inside corners: a whole wall, or one side of a partition's T-joint.
    const all = corners(data);
    return liveRuns(data)
      .flatMap((run) => {
        const mine = all.filter((c) => c.run.id === run.id);
        // A floor-standing column bounds a stretch too, like a wall (review finding R16).
        const columns = run.items.filter((i) => i.category === 'column' && i.y < 1 && i.depth > 0);
        const ends = [...mine.filter((c) => c.end === 'end').map((c) => c.pos), ...columns.map((col) => col.x)];
        const starts = [...mine.filter((c) => c.end === 'start').map((c) => c.pos), ...columns.map(right)];
        return starts.flatMap((p0) => {
          const p1 = Math.min(...ends.filter((e) => e > p0 + 0.5));
          if (!Number.isFinite(p1)) return [];
          const whole = p0 < 0.5 && p1 > run.widthCm - 0.5;
          return [{ run, p0, p1, whole }];
        });
      })
      .flatMap(({ run, p0, p1, whole }) => {
        const units = floorUnits(run)
          .filter((u) => u.x >= p0 - 0.5 && right(u) <= p1 + 0.5)
          .sort((a, b) => a.x - b.x);
        if (!units.length || units[0].x > p0 + 0.5) return [];
        // Overlapping units aren't "wall to wall": the overlap is the real problem (flagged on its own), and a
        // scribe filler would only narrow a cabinet in an already broken run (issue #17).
        if (units.some((u, k) => k > 0 && u.x < right(units[k - 1]) - 0.5)) return [];
        let reach = p0;
        for (const u of units) {
          if (u.x > reach + 0.5) return [];
          reach = Math.max(reach, right(u));
        }
        if (reach < p1 - 0.5) return [];
        const fillers = units.filter((u) => u.category === 'filler').reduce((s, u) => s + u.width, 0);
        const severity = graded(fillers, SCRIBE[0], SCRIBE[1], 'error');
        if (!severity) return [];
        return [
          v(
            'R14',
            severity,
            'NO SCRIBE ALLOWANCE',
            t(
              'The units on {run}{cm} run wall to wall with {fillers} cm of filler; leave {SCRIBE}–{SCRIBE2} cm in total to fit against crooked walls.',
              {
                run: runName(run.name),
                cm: whole ? '' : ` (${fmt(p0)}–${fmt(p1)} cm)`,
                fillers: fmt(fillers),
                SCRIBE: SCRIBE[0],
                SCRIBE2: SCRIBE[1],
              },
            ),
            {
              items: units.map((u) => ref(run, u)),
              fix: {
                label: t('Add {fillers} cm scribe filler', { fillers: fmt(SCRIBE[1] - fillers) }),
                apply: (data) => addScribeFiller(data, run.id, SCRIBE[1] - fillers, [p0, p1]),
              },
            },
          ),
        ];
      });
  },
};

/** Clear countertop (cm) from `edge` in direction `dir` (+1 = towards the run end), up to a counter item or slab end. */
function clearCounter(run: WallRun, edge: number, dir: 1 | -1, self: KitchenItem): number {
  const probe = edge + dir * 0.5;
  const slab = computeCountertops(run).find((s) => probe >= s.x - 1 && probe <= s.x + s.width + 1);
  if (!slab) return 0;
  const counter = run.items.filter((i) => i.id !== self.id && layerOf(i.category) === 'counter');
  if (dir > 0) {
    const limit = Math.min(slab.x + slab.width, ...counter.filter((o) => o.x >= edge - 0.5).map((o) => o.x));
    return limit - Math.max(edge, slab.x);
  }
  const limit = Math.max(slab.x, ...counter.filter((o) => right(o) <= edge + 0.5).map(right));
  return Math.min(edge, slab.x + slab.width) - limit;
}

const R15: Rule = {
  id: 'R15',
  title: 'Missing landing zones',
  check: perRun((run) =>
    run.items
      .filter((i) => i.category === 'fridge' || i.category === 'stove' || hasOvenZone(i))
      .flatMap((i) => {
        // A fridge needs it on its handle side; anything else on either side.
        const hinges = i.category === 'fridge' ? hingeEdges(i) : [];
        const sides = (['start', 'end'] as End[]).filter((s) => hinges.length !== 1 || hinges[0] !== s);
        const best = Math.max(
          ...sides.map((s) => (s === 'start' ? clearCounter(run, i.x, -1, i) : clearCounter(run, right(i), 1, i))),
        );
        if (best >= LANDING) return [];
        return [
          v(
            'R15',
            'warning',
            'NO LANDING ZONE',
            t(
              '{item} has {best} cm of clear countertop beside it{side}; leave at least {LANDING} cm to put things down.',
              {
                item: at(run, i),
                best: fmt(Math.max(0, best)),
                side: i.category === 'fridge' && sides.length === 1 ? t(' on its handle side') : '',
                LANDING,
              },
            ),
            {
              items: [ref(run, i)],
            },
          ),
        ];
      }),
  ),
};

const R17: Rule = {
  id: 'R17',
  title: 'Broken work triangle',
  check: ({ data }) => {
    const centres = (cat: KitchenItem['category']) =>
      liveRuns(data).flatMap((run) => {
        const f = wallFrame(data.room, run);
        return ofCategory(run, cat).map((item) => {
          const r = itemPlanRect(f, item);
          return { run, item, p: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
        });
      });
    const [sinks, stoves, fridges] = [centres('sink'), centres('stove'), centres('fridge')];
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    let best: { legs: number[]; pts: typeof sinks } | null = null;
    for (const s of sinks)
      for (const c of stoves)
        for (const f of fridges) {
          const legs = [dist(s.p, c.p), dist(c.p, f.p), dist(f.p, s.p)];
          if (!best || legs.reduce((a, b) => a + b) < best.legs.reduce((a, b) => a + b))
            best = { legs, pts: [s, c, f] };
        }
    if (!best) return [];
    const [s, c, f] = best.pts;
    const items = best.pts.map((x) => ref(x.run, x.item));
    const out: Violation[] = [];
    // A wall of the room cutting across a leg (an L or U room): the cook has to walk around it.
    const outline = roomOutline(data.room);
    const legs = [
      [s, c, 'the sink and the cooktop'],
      [c, f, 'the cooktop and the fridge'],
      [f, s, 'the fridge and the sink'],
    ] as const;
    const partitions = partitionRects(data);
    for (const [a, b, what] of legs) {
      // A partition wall across the leg counts too (review finding R13).
      const part = partitions.find(({ rect }) => segmentHitsRect(a.p, b.p, rect));
      if (lineInOutline(outline, a.p, b.p) && !part) continue;
      const wall = part
        ? runName(part.run.name.match(/^Partition \d+/)?.[0] ?? part.run.name)
        : t('A wall of the room');
      out.push(
        v(
          'R17',
          'warning',
          'WALL IN THE WAY',
          t('{wall} stands between {what}: the work triangle has to go around it.', { wall, what: t(what) }),
          {
            items: [ref(a.run, a.item), ref(b.run, b.item)],
            ...(part && { planArea: part.rect }),
          },
        ),
      );
    }
    const names = ['sink ↔ cooktop', 'cooktop ↔ fridge', 'fridge ↔ sink'];
    const bad = best.legs.map((d, k) => ({ d, k })).filter(({ d }) => d < TRIANGLE[0] || d > TRIANGLE[1]);
    if (bad.length) {
      out.push(
        v(
          'R17',
          'warning',
          'WORK TRIANGLE',
          t('Work triangle legs outside {TRIANGLE}–{TRIANGLE2} cm: {join}.', {
            TRIANGLE: TRIANGLE[0],
            TRIANGLE2: TRIANGLE[1],
            join: bad.map(({ d, k }) => `${t(names[k])} ${fmt(d)} ${t('cm')}`).join(', '),
          }),
          { items },
        ),
      );
    }
    // Islands standing in the way (other than one holding an endpoint).
    const hosts = new Set(best.pts.map((x) => islandOf(data, x.run)?.id ?? x.run.id));
    const blocked = data.walls
      .filter((w) => isIslandFront(w) && !hosts.has(w.id))
      .filter((isl) => {
        const r = islandFootprint(data, isl);
        return [
          [s.p, c.p],
          [c.p, f.p],
          [f.p, s.p],
        ].some(([a, b]) =>
          Array.from({ length: 41 }, (_, step) => ({
            x: a.x + ((b.x - a.x) * step) / 40,
            y: a.y + ((b.y - a.y) * step) / 40,
          })).some((q) => q.x > r.x + 1 && q.x < r.x + r.w - 1 && q.y > r.y + 1 && q.y < r.y + r.h - 1),
        );
      });
    for (const isl of blocked) {
      out.push(
        v(
          'R17',
          'warning',
          'ISLAND IN THE WAY',
          t('{isl} blocks the direct path between the sink, cooktop and fridge.', { isl: runName(isl.name) }),
          { items, planArea: islandFootprint(data, isl) },
        ),
      );
    }
    return out;
  },
};

const R18: Rule = {
  id: 'R18',
  title: 'Inaccessible dead corner',
  check: ({ data }) =>
    corners(data).flatMap((c) =>
      floorUnits(c.run)
        .filter((x) => cornerDist(c, x) < 1 && x.category !== 'corner_blocker' && x.category !== 'filler')
        .flatMap((x) => {
          // The neighbour's first unit starts right at this unit's front: its front is (partly) blind.
          const blocker = floorUnits(c.neighbour).find((y) => {
            const d = neighbourDist(c, y);
            return d >= x.depth - 1 && d < x.depth + 10;
          });
          if (!blocker) return [];
          return [
            v(
              'R18',
              'warning',
              'DEAD CORNER',
              t(
                'The front of {item} is blocked by {name} on {neighbour}: use a corner blocker (blind corner) or a corner unit to reach the space.',
                { item: at(c.run, x), name: itemName(blocker), neighbour: runName(c.neighbour.name) },
              ),
              {
                items: [ref(c.run, x), ref(c.neighbour, blocker)],
              },
            ),
          ];
        }),
    ),
};

export const DESIGN_RULES: Rule[] = [
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
  R7,
  R8,
  R9,
  R10,
  R11,
  R12,
  R13,
  R14,
  R15,
  R16,
  R17,
  R18,
  R19,
];
