import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData, WallRun, WallSide } from '../../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from '../defaults';
import { normalizeWall } from '../geometry';
import { checkProject, type Violation } from '.';

// Room 400 × 300: north / south walls are 400 long, east / west 300.
const room = { ...DEFAULT_ROOM };
type Layout = Partial<Record<WallSide, Partial<KitchenItem>[]>>;
const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });
const project = (layout: Layout, extra: (walls: WallRun[]) => void = () => {}): ProjectData => {
  const walls = createRoomWalls(room).map((w) => normalizeWall({ ...w, items: (layout[w.side!] ?? []).map(item) }));
  extra(walls);
  return { room, walls, activeWallId: walls[0].id };
};
const found = (data: ProjectData, rule: string): Violation[] => checkProject(data).filter((v) => v.rule === rule);
const severities = (data: ProjectData, rule: string) => found(data, rule).map((v) => v.severity);

// A west-wall base unit standing in the north-west corner (west wall-local x runs south → north, so its corner
// end is x = 300).
const westCornerUnit = { category: 'base_cabinet' as const, id: 'wc', x: 240 };

describe('R1 corner pull-out collision', () => {
  it('flags drawers right against the perpendicular run', () => {
    const data = project({ west: [westCornerUnit], north: [{ id: 'dr', x: 60, frontType: 'drawers' }] });
    expect(found(data, 'R1').map((v) => v.items.map((i) => i.itemId))).toEqual([['dr', 'wc']]);
  });

  it('is satisfied by a 5 cm filler, and ignores doors', () => {
    const filler = project({
      west: [westCornerUnit],
      north: [
        { category: 'filler', x: 60, width: 5 },
        { id: 'dr', x: 65, frontType: 'drawers' },
      ],
    });
    expect(found(filler, 'R1')).toEqual([]);
    expect(found(project({ west: [westCornerUnit], north: [{ x: 60 }] }), 'R1')).toEqual([]);
  });
});

describe('R2 wall-adjacent hinge binding', () => {
  it('flags a fridge hinged flush against the wall, softer when tight', () => {
    expect(severities(project({ north: [{ category: 'fridge', x: 0 }] }), 'R2')).toEqual(['error']);
    expect(severities(project({ north: [{ category: 'fridge', x: 7 }] }), 'R2')).toEqual(['warning']);
    expect(severities(project({ north: [{ category: 'fridge', x: 12 }] }), 'R2')).toEqual([]);
  });

  it('follows the tall cabinet hinge side', () => {
    expect(severities(project({ north: [{ category: 'tall_cabinet', x: 0, doorHinge: 'left' }] }), 'R2')).toEqual([
      'error',
    ]);
    expect(severities(project({ north: [{ category: 'tall_cabinet', x: 0, doorHinge: 'right' }] }), 'R2')).toEqual([]);
  });
});

describe('R4 opposing aisle deadlock', () => {
  it('flags a narrow aisle between opposite walls', () => {
    const data = project({ north: [{ x: 100 }], south: [{ x: 240 }] }, (walls) => (room.depthCm = 300) && walls);
    // 300 − 60 − 60 = 180 cm: fine.
    expect(found(data, 'R4')).toEqual([]);
  });

  it('flags fronts that collide and an aisle under 105 cm', () => {
    const data = project({}, (walls) => {
      const island = {
        ...createIsland(room, walls),
        id: 'isl',
        planX: 100,
        planY: 150,
        widthCm: 120,
        depthCm: 60,
        rotationDeg: 180 as const,
      };
      island.items = [item({ id: 'i1', x: 0, frontType: 'drawers' })];
      walls.push(island);
      walls[0].items = [item({ id: 'n1', x: 150, frontType: 'drawers' })];
    });
    // North fronts at y 60, island (facing north) fronts at y 150: 90 cm aisle, drawers need 2 × 54.
    expect(found(data, 'R4').map((v) => [v.badge, v.severity])).toEqual([
      ['FRONTS COLLIDE', 'error'],
      ['NARROW AISLE', 'warning'],
    ]);
  });
});

describe('R5 room door and window collision', () => {
  it('flags a tall unit against the window casing', () => {
    const data = project({
      north: [
        { category: 'window', id: 'win', x: 100 },
        { category: 'tall_cabinet', id: 't', x: 222 },
      ],
    });
    expect(found(data, 'R5').map((v) => v.badge)).toEqual(['BLOCKS WINDOW']);
  });

  it('flags a cabinet whose door opens into the room door sweep', () => {
    const data = project({ north: [{ category: 'door', id: 'd', x: 0, width: 90 }], west: [{ id: 'b', x: 160 }] });
    expect(found(data, 'R5').map((v) => v.badge)).toContain('DOOR SWEEP');
  });
});

describe('R6 cooktop lateral clearance', () => {
  it('flags a cooktop next to a tall cabinet, softer in the 20–30 cm band', () => {
    const near = project({ north: [{ x: 100 }, { category: 'stove', x: 100 }, { category: 'tall_cabinet', x: 165 }] });
    expect(severities(near, 'R6')).toEqual(['warning']);
    const tight = project({
      north: [
        { x: 100, width: 85 },
        { category: 'stove', x: 100 },
        { category: 'tall_cabinet', x: 185 },
      ],
    });
    expect(severities(tight, 'R6')).toEqual(['info']);
  });

  it('flags a cooktop against a bare perpendicular wall', () => {
    expect(severities(project({ north: [{ x: 0 }, { category: 'stove', x: 0 }] }), 'R6')).toEqual(['warning']);
  });
});

describe('R7 sink-to-cooktop separation', () => {
  const run = (gap: number) =>
    project({
      north: [
        { x: 100, width: 120 + gap },
        { category: 'sink', x: 100 },
        { category: 'stove', x: 160 + gap },
      ],
    });
  it('grades the countertop between sink and cooktop', () => {
    expect(severities(run(20), 'R7')).toEqual(['warning']);
    expect(severities(run(50), 'R7')).toEqual(['info']);
    expect(severities(run(70), 'R7')).toEqual([]);
  });
});

describe('R8 overhead hood clearance', () => {
  it('flags an upper cabinet too low above the cooktop', () => {
    const low = project({
      north: [{ x: 100 }, { category: 'stove', x: 100 }, { category: 'upper_cabinet', x: 100, y: 140 }],
    });
    expect(severities(low, 'R8')).toEqual(['error']);
    const ok = project({
      north: [{ x: 100 }, { category: 'stove', x: 100 }, { category: 'upper_cabinet', x: 100, y: 160 }],
    });
    expect(severities(ok, 'R8')).toEqual([]);
  });
});

describe('R9 thermal adjacency', () => {
  it('flags an oven tower directly against a fridge, not with a filler between', () => {
    const tower = { category: 'tall_cabinet' as const, x: 100 };
    expect(severities(project({ north: [tower, { category: 'fridge', x: 160 }] }), 'R9')).toEqual(['warning']);
    expect(
      severities(project({ north: [tower, { category: 'filler', x: 160 }, { category: 'fridge', x: 165 }] }), 'R9'),
    ).toEqual([]);
  });
});

describe('R11 cutout over a cabinet joint', () => {
  it('flags a sink straddling two base units', () => {
    expect(severities(project({ north: [{ x: 100 }, { x: 160 }, { category: 'sink', x: 130 }] }), 'R11')).toEqual([
      'error',
    ]);
    expect(severities(project({ north: [{ x: 100 }, { x: 160 }, { category: 'sink', x: 100 }] }), 'R11')).toEqual([]);
  });
});

describe('R14 zero-tolerance wall run', () => {
  const full = (filler: number) => {
    const units: Partial<KitchenItem>[] = [];
    let x = 0;
    if (filler) (units.push({ category: 'filler', x, width: filler }), (x += filler));
    while (x + 60 <= 400 - 0.01) (units.push({ x }), (x += 60));
    units.push({ x, width: 400 - x });
    return project({ north: units });
  };
  it('grades the scribe allowance of a wall-to-wall run', () => {
    expect(severities(full(0), 'R14')).toEqual(['error']);
    expect(severities(full(4), 'R14')).toEqual(['warning']);
    expect(severities(full(5), 'R14')).toEqual([]);
  });
});

describe('R15 landing zones', () => {
  it('needs 40 cm of countertop beside a cooktop', () => {
    expect(severities(project({ north: [{ x: 100 }, { category: 'stove', x: 100 }] }), 'R15')).toEqual(['warning']);
    expect(
      severities(
        project({
          north: [
            { x: 100, width: 100 },
            { category: 'stove', x: 100 },
          ],
        }),
        'R15',
      ),
    ).toEqual([]);
  });

  it('checks the handle side of a single-door fridge', () => {
    // Top/bottom fridge hinged left: the handle side is the right.
    const left = project({
      north: [
        { x: 100, width: 60 },
        { category: 'fridge', fridgeType: 'top_bottom', width: 60, x: 160 },
      ],
    });
    expect(severities(left, 'R15')).toEqual(['warning']);
    const rightSide = project({
      north: [{ category: 'fridge', fridgeType: 'top_bottom', width: 60, x: 100 }, { x: 160 }],
    });
    expect(severities(rightSide, 'R15')).toEqual([]);
  });
});

describe('R17 work triangle', () => {
  it('flags legs that are too short', () => {
    const data = project({
      north: [
        { x: 100 },
        { category: 'sink', x: 100 },
        { x: 160 },
        { category: 'stove', x: 160 },
        { category: 'fridge', x: 220 },
      ],
    });
    expect(found(data, 'R17').map((v) => v.badge)).toEqual(['WORK TRIANGLE']);
  });

  it('accepts a good triangle', () => {
    // Centres along the north wall at 100, 230 and 355: legs 130, 125 and 255 cm.
    const data = project({
      north: [
        { x: 70 },
        { category: 'sink', x: 70 },
        { x: 200 },
        { category: 'stove', x: 200 },
        { category: 'fridge', x: 310 },
      ],
    });
    expect(found(data, 'R17')).toEqual([]);
  });
});

describe('R18 dead corner', () => {
  it('flags a base unit whose front is blocked by the perpendicular run', () => {
    const data = project({ north: [{ id: 'n0', x: 0 }], west: [{ id: 'w', x: 180 }] });
    expect(found(data, 'R18').map((v) => v.items.map((i) => i.itemId))).toEqual([['n0', 'w']]);
  });

  it('accepts a corner blocker there', () => {
    const data = project({ north: [{ category: 'corner_blocker', x: 0 }], west: [{ x: 180 }] });
    expect(found(data, 'R18')).toEqual([]);
  });
});

describe('R11 at the end of a run', () => {
  it('does not treat the end of the cabinet run as a joint', () => {
    expect(severities(project({ north: [{ x: 100 }, { category: 'sink', x: 130 }] }), 'R11')).toEqual([]);
  });
});
