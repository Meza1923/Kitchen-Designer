/**
 * Design rules R1–R19 (FEATURES.md #5). Phase B: the rules that need no new element types.
 * Distances are cm; the rule texts give mm.
 */
import type { KitchenItem, ProjectData, WallRun } from '../../types';
import { computeCountertops, fmt, isCounterBearing, layerOf } from '../geometry';
import {
  doorSwingRect,
  islandRect,
  itemPlanRect,
  localRect,
  rectIntersection,
  rectsOverlap,
  wallFrame,
  type Frame,
  type Pt,
  type Rect,
} from '../plan';
import {
  at,
  cornerDepth,
  corners,
  cornerUnits,
  distToEnd,
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

const CORNER_FILLER = 5; // R1
const HINGE_GAP = [5, 10] as const; // R2
const AISLE_MIN = 105; // R4
const WINDOW_CASING = 5; // R5
const COOKTOP_SIDE = [20, 30] as const; // R6
const SINK_COOKTOP = [40, 60] as const; // R7
const HOOD_MIN_ELECTRIC = 65; // R8
const SCRIBE = [3, 5] as const; // R14
const LANDING = 40; // R15
const TRIANGLE = [120, 270] as const; // R17

const right = (i: KitchenItem) => i.x + i.width;

/** A fix that puts a filler of `width` against the corner obstacle (wall or perpendicular fronts) at corner `c`. */
const cornerFiller = (c: Corner, obstacle: number, width: number) => ({
  label: `Add ${width} cm filler`,
  apply: (data: ProjectData) =>
    c.end === 'start'
      ? insertFiller(data, c.run.id, obstacle, width, 'end')
      : insertFiller(data, c.run.id, c.run.widthCm - obstacle, width, 'start'),
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
          const clearance = distToEnd(c.run, i, c.end) - depth;
          if (clearance < -0.5 || clearance >= CORNER_FILLER) return [];
          return [
            v(
              'R1',
              'error',
              'CORNER PULL-OUT',
              `${at(c.run, i)} opens into the corner ${fmt(Math.max(0, clearance))} cm from ${itemName(other)} on ${c.neighbour.name}: add a filler of at least ${CORNER_FILLER} cm so the handles clear.`,
              {
                items: [ref(c.run, i), ref(c.neighbour, other)],
                fix: cornerFiller(c, depth, CORNER_FILLER),
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
          const gap = distToEnd(c.run, i, c.end) - obstacle;
          const severity = gap >= -0.5 ? graded(gap, HINGE_GAP[0], HINGE_GAP[1], 'error') : null;
          if (!severity) return [];
          return [
            v(
              'R2',
              severity,
              'HINGE AT WALL',
              `${at(c.run, i)} is hinged ${fmt(Math.max(0, gap))} cm from the ${obstacle ? 'units' : 'wall'} on ${c.neighbour.name}: leave ${HINGE_GAP[0]}–${HINGE_GAP[1]} cm so the door opens past 90°.`,
              {
                items: [ref(c.run, i)],
                fix: cornerFiller(c, obstacle, HINGE_GAP[1]),
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
        const reach = openReach(p.item) + openReach(q.item);
        if (reach > gap) {
          out.push(
            v(
              'R4',
              'error',
              'FRONTS COLLIDE',
              `Open fronts of ${at(p.run, p.item)} and ${at(q.run, q.item)} collide: they need ${fmt(reach)} cm, the aisle is ${fmt(gap)} cm.`,
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
          `The aisle between ${p.run.name} and ${q.run.name} is ${fmt(gap)} cm; at least ${AISLE_MIN} cm is needed to work and pass.`,
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
        for (const t of run.items.filter(isTall)) {
          const gap = edgeGap(t, win);
          const vertical = t.y < win.y + win.height && win.y < t.y + t.height;
          if (gap >= 0 && gap < WINDOW_CASING && vertical) {
            out.push(
              v(
                'R5',
                'error',
                'BLOCKS WINDOW',
                `${at(run, t)} stands ${fmt(gap)} cm from the window: it covers the window casing (needs ${WINDOW_CASING} cm).`,
                {
                  items: [ref(run, t), ref(run, win)],
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
                `The open front of ${at(other, i)} swings into the sweep of the room door on ${run.name}.`,
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
    const cornerAt = new Map(corners(data).map((c) => [`${c.run.id}:${c.end}`, c]));
    return liveRuns(data).flatMap((run) =>
      ofCategory(run, 'stove').flatMap((stove) => {
        const sides: { gap: number; what: string; who?: KitchenItem }[] = [];
        for (const t of run.items.filter(isTall)) sides.push({ gap: edgeGap(stove, t), what: itemName(t), who: t });
        for (const end of ['start', 'end'] as End[]) {
          const c = cornerAt.get(`${run.id}:${end}`);
          if (!c) continue;
          const units = cornerUnits(c);
          // A bare wall, or tall units standing in the corner; base units there leave the space above free.
          if (!units.length) sides.push({ gap: distToEnd(run, stove, end), what: `the wall (${c.neighbour.name})` });
          else if (units.some(isTall))
            sides.push({
              gap: distToEnd(run, stove, end) - cornerDepth(c),
              what: `the tall units on ${c.neighbour.name}`,
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
              `${at(run, stove)} is ${fmt(Math.max(0, gap))} cm from ${what}; keep ${COOKTOP_SIDE[0]}–${COOKTOP_SIDE[1]} cm beside a cooktop.`,
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
            `Only ${fmt(gap)} cm of countertop between the sink and the cooktop on ${run.name}; aim for ${SINK_COOKTOP[0]}–${SINK_COOKTOP[1]} cm.`,
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
      return ofCategory(run, 'upper_cabinet', 'shelf')
        .filter((u) => edgeGap(u, stove) < -1)
        .flatMap((u) => {
          const clearance = u.y - surface;
          if (clearance >= HOOD_MIN_ELECTRIC || clearance < 0) return [];
          return [
            v(
              'R8',
              'error',
              'TOO LOW ABOVE COOKTOP',
              `${at(run, u)} is ${fmt(clearance)} cm above the cooktop; at least ${HOOD_MIN_ELECTRIC} cm is needed (75 cm for gas).`,
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
            `The oven tower ${at(run, oven)} stands directly against ${itemName(fr)}: put an insulating panel or a narrow cabinet between them.`,
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
          `The cutout for ${at(run, cut)} sits over the side panels between two base units (joint at X ${inside.map(fmt).join(', ')}): centre it on one unit.`,
          {
            items: [ref(run, cut)],
          },
        ),
      ];
    });
  }),
};

const R14: Rule = {
  id: 'R14',
  title: 'Zero-tolerance wall run',
  check: ({ data }) => {
    const cornered = new Set(corners(data).map((c) => `${c.run.id}:${c.end}`));
    return liveRuns(data)
      .filter((run) => cornered.has(`${run.id}:start`) && cornered.has(`${run.id}:end`))
      .flatMap((run) => {
        const units = floorUnits(run).sort((a, b) => a.x - b.x);
        if (!units.length || units[0].x > 0.5) return [];
        let reach = 0;
        for (const u of units) {
          if (u.x > reach + 0.5) return [];
          reach = Math.max(reach, right(u));
        }
        if (reach < run.widthCm - 0.5) return [];
        const fillers = units.filter((u) => u.category === 'filler').reduce((s, u) => s + u.width, 0);
        const severity = graded(fillers, SCRIBE[0], SCRIBE[1], 'error');
        if (!severity) return [];
        return [
          v(
            'R14',
            severity,
            'NO SCRIBE ALLOWANCE',
            `The units on ${run.name} run wall to wall with ${fmt(fillers)} cm of filler; leave ${SCRIBE[0]}–${SCRIBE[1]} cm in total to fit against crooked walls.`,
            {
              items: units.map((u) => ref(run, u)),
              fix: {
                label: `Add ${fmt(SCRIBE[1] - fillers)} cm scribe filler`,
                apply: (data) => addScribeFiller(data, run.id, SCRIBE[1] - fillers),
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
            `${at(run, i)} has ${fmt(Math.max(0, best))} cm of clear countertop beside it${i.category === 'fridge' && sides.length === 1 ? ' on its handle side' : ''}; leave at least ${LANDING} cm to put things down.`,
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
    const names = ['sink ↔ cooktop', 'cooktop ↔ fridge', 'fridge ↔ sink'];
    const bad = best.legs.map((d, k) => ({ d, k })).filter(({ d }) => d < TRIANGLE[0] || d > TRIANGLE[1]);
    if (bad.length) {
      out.push(
        v(
          'R17',
          'warning',
          'WORK TRIANGLE',
          `Work triangle legs outside ${TRIANGLE[0]}–${TRIANGLE[1]} cm: ${bad.map(({ d, k }) => `${names[k]} ${fmt(d)} cm`).join(', ')}.`,
          { items },
        ),
      );
    }
    // Islands standing in the way (other than one holding an endpoint).
    const hosts = new Set(best.pts.map((x) => x.run.id));
    const blocked = data.walls
      .filter((w) => w.kind === 'island' && !hosts.has(w.id))
      .filter((isl) => {
        const r = islandRect(isl);
        return [
          [s.p, c.p],
          [c.p, f.p],
          [f.p, s.p],
        ].some(([a, b]) =>
          Array.from({ length: 41 }, (_, t) => ({
            x: a.x + ((b.x - a.x) * t) / 40,
            y: a.y + ((b.y - a.y) * t) / 40,
          })).some((q) => q.x > r.x + 1 && q.x < r.x + r.w - 1 && q.y > r.y + 1 && q.y < r.y + r.h - 1),
        );
      });
    for (const isl of blocked) {
      out.push(
        v(
          'R17',
          'warning',
          'ISLAND IN THE WAY',
          `${isl.name} blocks the direct path between the sink, cooktop and fridge.`,
          { items, planArea: islandRect(isl) },
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
        .filter((x) => distToEnd(c.run, x, c.end) < 1 && x.category !== 'corner_blocker' && x.category !== 'filler')
        .flatMap((x) => {
          // The neighbour's first unit starts right at this unit's front: its front is (partly) blind.
          const blocker = floorUnits(c.neighbour).find((y) => {
            const d = distToEnd(c.neighbour, y, c.neighbourEnd);
            return d >= x.depth - 1 && d < x.depth + 10;
          });
          if (!blocker) return [];
          return [
            v(
              'R18',
              'warning',
              'DEAD CORNER',
              `The front of ${at(c.run, x)} is blocked by ${itemName(blocker)} on ${c.neighbour.name}: use a corner blocker (blind corner) or a corner unit to reach the space.`,
              {
                items: [ref(c.run, x), ref(c.neighbour, blocker)],
              },
            ),
          ];
        }),
    ),
};

export const DESIGN_RULES: Rule[] = [R1, R2, R4, R5, R6, R7, R8, R9, R11, R14, R15, R17, R18];
