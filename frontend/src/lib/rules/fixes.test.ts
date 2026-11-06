import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData, WallSide } from '../../types';
import { createItem, createRoomWalls, DEFAULT_ROOM } from '../defaults';
import { normalizeWall } from '../geometry';
import { applyAllFixes, checkProject, type Violation } from '.';

const room = { ...DEFAULT_ROOM };
const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });
const project = (layout: Partial<Record<WallSide, Partial<KitchenItem>[]>>): ProjectData => {
  const walls = createRoomWalls(room).map((w) => normalizeWall({ ...w, items: (layout[w.side!] ?? []).map(item) }));
  return { room, walls, activeWallId: walls[0].id };
};
const fixOf = (data: ProjectData, rule: string) => {
  const v = checkProject(data).find((x) => x.rule === rule);
  expect(v?.fix).toBeDefined();
  return v!.fix!.apply(data);
};
const north = (data: ProjectData) => data.walls.find((w) => w.side === 'north')!;
const byId = (data: ProjectData, id: string) => north(data).items.find((i) => i.id === id)!;
const fillers = (data: ProjectData) =>
  north(data)
    .items.filter((i) => i.category === 'filler')
    .map((f) => [f.x, f.width]);

describe('filler fixes', () => {
  it('R1: puts a 5 cm filler in the corner and shifts the drawers (and their cooktop) along', () => {
    const data = project({
      west: [{ x: 240 }],
      north: [
        { id: 'dr', x: 60, frontType: 'drawers' },
        { id: 'hob', category: 'stove', x: 60 },
        { id: 'b2', x: 120 },
      ],
    });
    const fixed = fixOf(data, 'R1') as ProjectData;
    expect(fillers(fixed)).toEqual([[60, 5]]);
    expect([byId(fixed, 'dr').x, byId(fixed, 'hob').x, byId(fixed, 'b2').x]).toEqual([65, 65, 125]);
    expect(checkProject(fixed).filter((v) => v.rule === 'R1')).toEqual([]);
  });

  it('R2: clears a fridge hinge from the wall, at the far end of the run too', () => {
    const start = fixOf(project({ north: [{ id: 'f', category: 'fridge', x: 0 }] }), 'R2') as ProjectData;
    expect([fillers(start), byId(start, 'f').x]).toEqual([[[0, 10]], 10]);
    const end = fixOf(project({ north: [{ id: 'f', category: 'fridge', x: 310 }] }), 'R2') as ProjectData;
    expect([fillers(end), byId(end, 'f').x]).toEqual([[[390, 10]], 300]);
    expect(checkProject(end).filter((v) => v.rule === 'R2')).toEqual([]);
  });

  it('R14: narrows the widest cabinet to make room for a scribe filler', () => {
    const units: Partial<KitchenItem>[] = [{ id: 'wide', x: 0, width: 100 }];
    for (let x = 100; x < 400; x += 60) units.push({ x });
    const fixed = fixOf(project({ north: units }), 'R14') as ProjectData;
    expect(byId(fixed, 'wide').width).toBe(95);
    expect(fillers(fixed)).toEqual([[395, 5]]);
    expect(checkProject(fixed).filter((v) => ['R14', 'overlap'].includes(v.rule))).toEqual([]);
  });

  it('narrows the nearest cabinet when the wall is full', () => {
    const full: Partial<KitchenItem>[] = [{ id: 'f', category: 'fridge', x: 0 }];
    for (let x = 90; x < 400; x += 62) full.push({ id: `b${x}`, x, width: 62 });
    const fixed = fixOf(project({ north: full }), 'R2') as ProjectData;
    expect([fillers(fixed), byId(fixed, 'f').x, byId(fixed, 'b90').width]).toEqual([[[0, 10]], 10, 52]);
    expect(checkProject(fixed).filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('explains when nothing can be narrowed (appliances are never resized)', () => {
    const appliances: Partial<KitchenItem>[] = [{ category: 'fridge', x: 0 }];
    for (let x = 90; x + 60 <= 400; x += 60) appliances.push({ category: 'washing_machine', x });
    appliances.push({ category: 'washing_machine', x: 340, width: 60 });
    expect(fixOf(project({ north: appliances }), 'R2')).toMatch(/no cabinet there can be narrowed/);
  });

  it('applies every available fix in one go', () => {
    const data = project({
      west: [{ x: 240 }],
      north: [
        { x: 60, frontType: 'drawers' },
        { category: 'fridge', x: 310 },
      ],
    });
    const { data: fixed, applied, failed } = applyAllFixes(data);
    expect([applied, failed]).toEqual([2, []]);
    expect(checkProject(fixed).filter((v) => v.fix)).toEqual([]);
  });

  // Regression sweep: every corner of the room, both ends of each wall, each unit type, with and without units on the
  // perpendicular wall, on an otherwise empty or completely full wall. Every fix must apply, clear its problem and
  // add no new red problems.
  it('works in every corner, on empty and full walls', () => {
    const SIDES: WallSide[] = ['north', 'east', 'south', 'west'];
    const len = (s: WallSide) => (s === 'north' || s === 'south' ? 400 : 300);
    const turn = (s: WallSide, by: number) => SIDES[(SIDES.indexOf(s) + by) % 4];
    const key = (v: Violation) =>
      `${v.rule}|${v.badge}|${v.items
        .map((i) => i.itemId)
        .sort()
        .join(',')}`;
    const units: Partial<KitchenItem>[] = [
      { category: 'fridge' },
      { category: 'tall_cabinet', doorHinge: 'left' },
      { category: 'tall_cabinet', doorHinge: 'right' },
      { frontType: 'drawers' },
      { category: 'under_counter_oven' },
    ];
    const bad: string[] = [];
    let tried = 0;
    for (const side of SIDES)
      for (const end of ['start', 'end'] as const)
        for (const unit of units)
          for (const corner of [false, true])
            for (const offset of [0, 3, 7])
              for (const full of [false, true]) {
                const L = len(side);
                const w = unit.category === 'fridge' ? 90 : 60;
                const depth = corner ? 60 : 0;
                const nb = turn(side, end === 'start' ? 3 : 1);
                const x = end === 'start' ? depth + offset : L - depth - offset - w;
                const rest: Partial<KitchenItem>[] = [];
                if (full && end === 'start') {
                  let cx = x + w;
                  while (cx + 60 <= L - 0.01) (rest.push({ x: cx }), (cx += 60));
                  if (L - cx >= 30) rest.push({ x: cx, width: L - cx });
                } else if (full) {
                  let cx = x;
                  while (cx - 60 >= -0.01) (rest.push({ x: cx - 60 }), (cx -= 60));
                  if (cx >= 30) rest.push({ x: 0, width: cx });
                } else rest.push({ x: end === 'start' ? x + w : x - 60 });
                const data = project({
                  [side]: [{ ...unit, id: 'u', x, width: w }, ...rest],
                  ...(corner ? { [nb]: [{ x: end === 'start' ? len(nb) - 60 : 0 }] } : {}),
                });
                const before = checkProject(data);
                const oldErrors = new Set(before.filter((b) => b.severity === 'error').map(key));
                for (const v of before.filter((b) => b.fix)) {
                  tried++;
                  const where = `${side}/${end} ${unit.category ?? 'drawers'} corner=${corner} offset=${offset} full=${full} ${v.rule}`;
                  const r = v.fix!.apply(data);
                  if (typeof r === 'string') {
                    bad.push(`${where}: ${r}`);
                    continue;
                  }
                  const after = checkProject(r);
                  if (after.some((a) => key(a) === key(v))) bad.push(`${where}: problem still there`);
                  const added = after.filter((a) => a.severity === 'error' && !oldErrors.has(key(a)));
                  if (added.length) bad.push(`${where}: new ${added.map((a) => a.rule).join(', ')}`);
                }
              }
    expect(tried).toBeGreaterThan(300);
    expect(bad).toEqual([]);
  });
});
