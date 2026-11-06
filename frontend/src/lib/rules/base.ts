/** Checks that existed before the rules system, kept with their original behaviour. */
import { computeGaps, computeOverlaps, computeSocketIssues, computeUnsupported, fmt } from '../geometry';
import { computePlanConflicts } from '../plan';
import { at, itemName, perRun, ref, type Rule, type Violation } from './core';

export const BASE_RULES: Rule[] = [
  {
    id: 'overlap',
    title: 'Overlapping elements',
    check: perRun((run) =>
      computeOverlaps(run).map((o) => {
        const a = run.items.find((i) => i.id === o.a)!;
        const b = run.items.find((i) => i.id === o.b)!;
        return {
          rule: 'overlap',
          severity: 'error',
          badge: 'OVERLAP',
          message: `${itemName(a)} (X ${fmt(a.x)}) and ${itemName(b)} (X ${fmt(b.x)}) on ${run.name} overlap by ${fmt(o.x1 - o.x0)} cm.`,
          items: [ref(run, a), ref(run, b)],
          wallArea: { runId: run.id, ...o },
        };
      }),
    ),
  },
  {
    id: 'no_countertop',
    title: 'Counter item without countertop',
    check: perRun((run) =>
      computeUnsupported(run).map((i) => ({
        rule: 'no_countertop',
        severity: 'error',
        badge: 'NO COUNTERTOP',
        message: `${at(run, i)} is not fully on a countertop.`,
        items: [ref(run, i)],
      })),
    ),
  },
  {
    id: 'socket',
    title: 'Unreachable socket',
    check: perRun((run) =>
      computeSocketIssues(run).map(({ item, reason }) => ({
        rule: 'socket',
        severity: 'error',
        badge: reason === 'opening' ? 'SOCKET IN OPENING' : 'SOCKET HIDDEN',
        message:
          reason === 'opening'
            ? `${at(run, item)} is inside a window or door opening.`
            : `${at(run, item)} is covered by a cabinet.`,
        items: [ref(run, item)],
      })),
    ),
  },
  {
    id: 'narrow_gap',
    title: 'Gap too narrow to use',
    check: perRun((run) =>
      (['floor', 'upper'] as const).flatMap((layer) =>
        computeGaps(run, layer)
          .filter((g) => g.warning)
          .map((g) => ({
            rule: 'narrow_gap',
            severity: 'warning',
            badge: `GAP ${fmt(g.width)} cm`,
            message: `${fmt(g.width)} cm gap on ${run.name} at X ${fmt(g.x0)}: too narrow to use; close it or add a filler.`,
            items: [],
            wallArea: { runId: run.id, x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 },
          })),
      ),
    ),
  },
  {
    id: 'plan_conflicts',
    title: 'Plan conflicts',
    check: ({ data }) => {
      const where = (id: string) => {
        for (const run of data.walls) {
          const item = run.items.find((i) => i.id === id);
          if (item) return { run, item };
        }
        return null;
      };
      return computePlanConflicts(data).map((c): Violation => {
        const a = where(c.a);
        const b = c.b ? where(c.b) : null;
        const items = [a, b].filter((x) => x !== null).map((x) => ref(x.run, x.item));
        if (c.kind === 'outside') {
          const island = data.walls.find((w) => w.id === c.a);
          return {
            rule: 'outside_room',
            severity: 'error',
            badge: 'OUTSIDE ROOM',
            message: `${island?.name ?? 'Island'} extends outside the room.`,
            items,
            planArea: c.rect,
          };
        }
        const bName = b ? at(b.run, b.item) : (data.walls.find((w) => w.id === c.b)?.name ?? 'an island');
        return c.kind === 'clash'
          ? {
              rule: 'plan_clash',
              severity: 'error',
              badge: 'CLASH',
              message: `${a ? at(a.run, a.item) : 'An element'} clashes with ${bName} in the plan.`,
              items,
              planArea: c.rect,
            }
          : {
              rule: 'door_swing',
              severity: 'error',
              badge: 'DOOR SWING',
              message: `The swing of ${a ? at(a.run, a.item) : 'a door'} is blocked by ${bName}.`,
              items,
              planArea: c.rect,
            };
      });
    },
  },
];
