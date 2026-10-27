import { describe, expect, it } from 'vitest';
import type { ElementCategory, KitchenItem, WallRun } from '../types';
import { createItem, DEFAULT_BASE_HEIGHT } from './defaults';
import {
  canCollide,
  computeCountertops,
  computeGaps,
  computeOverlaps,
  computeSocketIssues,
  computeUnsupported,
  findFreeX,
  layerOf,
  normalizeWall,
  snapX,
  toScreenY,
} from './geometry';

const item = (category: ElementCategory, props: Partial<KitchenItem> = {}): KitchenItem => ({
  ...createItem(category),
  ...props,
});

const wall = (items: KitchenItem[], widthCm = 400): WallRun => ({
  id: 'w',
  name: 'Wall A',
  kind: 'wall',
  side: 'north',
  widthCm,
  heightCm: 260,
  countertopThicknessCm: 3,
  items,
});

describe('layerOf', () => {
  it.each<[ElementCategory, string]>([
    ['base_cabinet', 'floor'],
    ['fridge', 'floor'],
    ['upper_cabinet', 'upper'],
    ['window', 'upper'],
    ['door', 'upper'],
    ['sink', 'counter'],
    ['stove', 'counter'],
    ['socket', 'electrical'],
  ])('%s is on the %s layer', (category, layer) => {
    expect(layerOf(category)).toBe(layer);
  });
});

describe('toScreenY', () => {
  it('maps the floor to the bottom of the SVG and the ceiling to the top', () => {
    expect(toScreenY(260, 0, 87, 1)).toBe(173);
    expect(toScreenY(260, 0, 260, 2)).toBe(0);
  });
});

describe('canCollide', () => {
  it('floor units always collide with each other', () => {
    expect(canCollide(item('base_cabinet'), item('fridge'))).toBe(true);
  });

  it('upper units collide only when their heights overlap', () => {
    expect(canCollide(item('upper_cabinet', { y: 145 }), item('upper_cabinet', { y: 150 }))).toBe(true);
    expect(canCollide(item('upper_cabinet', { y: 0, height: 50 }), item('upper_cabinet', { y: 145 }))).toBe(false);
  });

  it('a tall floor unit collides with an upper cabinet it reaches into', () => {
    expect(canCollide(item('tall_cabinet'), item('upper_cabinet'))).toBe(true);
    expect(canCollide(item('base_cabinet'), item('upper_cabinet'))).toBe(false);
  });

  it('sockets never collide with cabinets', () => {
    expect(canCollide(item('socket', { y: 20 }), item('base_cabinet'))).toBe(false);
  });
});

describe('snapX', () => {
  const a = item('base_cabinet', { id: 'a', x: 0, width: 60 });
  const b = item('base_cabinet', { id: 'b', x: 200, width: 60 });

  it('snaps to a neighbour edge within the snap distance', () => {
    expect(snapX(wall([a, b]), b, 62, true)).toBe(60);
  });

  it('does not snap beyond the snap distance', () => {
    expect(snapX(wall([a, b]), b, 70, true)).toBe(70);
  });

  it('rounds without snapping when snapping is off', () => {
    expect(snapX(wall([a, b]), b, 61.6, false)).toBe(62);
  });

  it('clamps inside the wall', () => {
    expect(snapX(wall([a, b]), b, -50, true)).toBe(0);
    expect(snapX(wall([a, b]), b, 390, true)).toBe(340);
  });
});

describe('normalizeWall', () => {
  it('keeps items inside the wall and puts counter items on the base unit top', () => {
    const base = item('base_cabinet', { id: 'base', x: 0, height: 90 });
    const sink = item('sink', { id: 'sink', x: 0, y: 0 });
    const tooFar = item('base_cabinet', { id: 'far', x: 380 });
    const result = normalizeWall(wall([base, sink, tooFar]));
    expect(result.items.find((i) => i.id === 'sink')!.y).toBe(90);
    expect(result.items.find((i) => i.id === 'far')!.x).toBe(340);
  });

  it('pins doors to the floor', () => {
    const result = normalizeWall(wall([item('door', { y: 30 })]));
    expect(result.items[0].y).toBe(0);
  });

  it('returns unchanged items as the same objects', () => {
    const base = item('base_cabinet');
    expect(normalizeWall(wall([base])).items[0]).toBe(base);
  });
});

describe('computeGaps', () => {
  it('reports gaps between floor units and to the side walls', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('base_cabinet', { x: 65 })], 200);
    const gaps = computeGaps(w, 'floor');
    expect(gaps.map((g) => [g.x0, g.x1, g.warning])).toEqual([
      [60, 65, true],
      [125, 200, false],
    ]);
  });

  it('treats flush units as touching', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('base_cabinet', { x: 60.05 })], 120.05);
    expect(computeGaps(w, 'floor')).toEqual([]);
  });

  it('returns nothing for an empty layer', () => {
    expect(computeGaps(wall([item('base_cabinet')]), 'upper')).toEqual([]);
  });
});

describe('computeOverlaps', () => {
  it('reports overlapping floor units', () => {
    const w = wall([item('base_cabinet', { id: 'a', x: 0 }), item('base_cabinet', { id: 'b', x: 50 })]);
    expect(computeOverlaps(w)).toEqual([{ a: 'a', b: 'b', x0: 50, x1: 60, y0: 0, y1: 87 }]);
  });

  it('ignores items on layers that cannot collide', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('upper_cabinet', { x: 0 })]);
    expect(computeOverlaps(w)).toEqual([]);
  });
});

describe('computeCountertops', () => {
  it('merges touching base units into one slab', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('base_cabinet', { x: 60 })]);
    expect(computeCountertops(w)).toEqual([{ x: 0, width: 120, y: 87, thickness: 3 }]);
  });

  it('bridges a washing machine between base units but not at the end of a run', () => {
    const flanked = wall([
      item('base_cabinet', { x: 0 }),
      item('washing_machine', { x: 60 }),
      item('base_cabinet', { x: 120 }),
    ]);
    expect(computeCountertops(flanked)).toEqual([{ x: 0, width: 180, y: 87, thickness: 3 }]);

    const atEnd = wall([item('base_cabinet', { x: 0 }), item('washing_machine', { x: 60 })]);
    expect(computeCountertops(atEnd)).toEqual([{ x: 0, width: 60, y: 87, thickness: 3 }]);
  });

  it('splits the slab where the base height changes', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('base_cabinet', { x: 60, height: 90 })]);
    expect(computeCountertops(w).map((s) => [s.x, s.width, s.y])).toEqual([
      [0, 60, 87],
      [60, 60, 90],
    ]);
  });

  it('separate runs get separate slabs', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('base_cabinet', { x: 100 })]);
    expect(computeCountertops(w)).toHaveLength(2);
  });
});

describe('computeUnsupported', () => {
  it('flags counter items not fully on a countertop', () => {
    const sink = item('sink', { id: 'sink', x: 30 });
    const stove = item('stove', { id: 'stove', x: 0 });
    const w = wall([item('base_cabinet', { x: 0 }), sink, stove]);
    expect(computeUnsupported(w).map((i) => i.id)).toEqual(['sink']);
  });
});

describe('computeSocketIssues', () => {
  it('flags sockets inside openings and behind upper cabinets', () => {
    const inWindow = item('socket', { id: 's1', x: 10, y: 150 });
    const hidden = item('socket', { id: 's2', x: 210, y: 150 });
    const fine = item('socket', { id: 's3', x: 300, y: 110 });
    const w = wall([
      item('window', { x: 0, y: 105 }),
      item('upper_cabinet', { x: 200, y: 145 }),
      inWindow,
      hidden,
      fine,
    ]);
    expect(computeSocketIssues(w).map((i) => [i.item.id, i.reason])).toEqual([
      ['s1', 'opening'],
      ['s2', 'hidden'],
    ]);
  });
});

describe('findFreeX', () => {
  it('places a floor unit in the first gap wide enough', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('base_cabinet', { x: 100 })]);
    expect(findFreeX(w, item('base_cabinet', { width: 40 }))).toBe(60);
    expect(findFreeX(w, item('base_cabinet', { width: 60 }))).toBe(160);
  });

  it('centres a counter item on the first free base unit', () => {
    const w = wall([item('base_cabinet', { x: 0 }), item('sink', { x: 0 }), item('base_cabinet', { x: 60 })]);
    expect(findFreeX(w, item('stove'))).toBe(60);
  });

  it('places a socket above the countertop', () => {
    const w = wall([item('base_cabinet', { x: 100 })]);
    expect(findFreeX(w, item('socket'))).toBe(110);
  });
});

it('DEFAULT_BASE_HEIGHT matches the default base cabinet', () => {
  expect(createItem('base_cabinet').height).toBe(DEFAULT_BASE_HEIGHT);
});
