/** Checks that existed before the rules system, kept with their original behaviour. */
import { computeGaps, computeOverlaps, computeSocketIssues, computeUnsupported, fmt } from '../geometry';
import { computePlanConflicts } from '../plan';
import { at, itemName, perRun, ref, type Rule, type Violation } from './core';
import { runName, t } from '../i18n';

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
          message: t('{name} (X {aX}) and {name2} (X {bX}) on {run} overlap by {x0} cm.', {
            name: itemName(a),
            aX: fmt(a.x),
            name2: itemName(b),
            bX: fmt(b.x),
            run: runName(run.name),
            x0: fmt(o.x1 - o.x0),
          }),
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
        message: t('{item} is not fully on a countertop.', { item: at(run, i) }),
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
            ? t('{item} is inside a window or door opening.', { item: at(run, item) })
            : t('{item} is covered by a cabinet.', { item: at(run, item) }),
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
            badge: t('GAP {gWidth} cm', { gWidth: fmt(g.width) }),
            message: t('{gWidth} cm gap on {run} at X {x0}: too narrow to use; close it or add a filler.', {
              gWidth: fmt(g.width),
              run: runName(run.name),
              x0: fmt(g.x0),
            }),
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
            message: t('{island} extends outside the room.', { island: runName(island?.name ?? 'Island') }),
            items,
            planArea: c.rect,
          };
        }
        const bName = b ? at(b.run, b.item) : runName(data.walls.find((w) => w.id === c.b)?.name ?? t('an island'));
        return c.kind === 'clash'
          ? {
              rule: 'plan_clash',
              severity: 'error',
              badge: 'CLASH',
              message: t('{element} clashes with {bName} in the plan.', {
                element: a ? at(a.run, a.item) : runName(data.walls.find((w) => w.id === c.a)?.name ?? t('An element')),
                bName,
              }),
              items,
              planArea: c.rect,
            }
          : {
              rule: 'door_swing',
              severity: 'error',
              badge: 'DOOR SWING',
              message: t('The swing of {door} is blocked by {bName}.', {
                door: a ? at(a.run, a.item) : t('a door'),
                bName,
              }),
              items,
              planArea: c.rect,
            };
      });
    },
  },
];
