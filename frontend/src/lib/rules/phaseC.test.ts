import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData, WallRun, WallSide } from '../../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from '../defaults';
import { syncRoom } from '../plan';
import { checkProject } from '.';

// Room 400 × 300; the west wall's corner end (north-west) is its x = 300.
const room = { ...DEFAULT_ROOM };
type Layout = Partial<Record<WallSide | 'island', Partial<KitchenItem>[]>>;
const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });
const project = (layout: Layout): ProjectData => {
  const walls: WallRun[] = createRoomWalls(room).map((w) => ({ ...w, items: (layout[w.side!] ?? []).map(item) }));
  if (layout.island)
    walls.push({ ...createIsland(room, walls), planX: 100, planY: 150, widthCm: 240, items: layout.island.map(item) });
  return syncRoom({ room, walls, activeWallId: walls[0].id });
};
const badges = (d: ProjectData, rule: string) =>
  checkProject(d)
    .filter((v) => v.rule === rule)
    .map((v) => v.badge);

describe('phase C elements in existing rules', () => {
  it('R1: a dishwasher at an inside corner counts as a pull-out', () => {
    const d = project({ west: [{ x: 240 }], north: [{ category: 'dishwasher', x: 60 }] });
    expect(badges(d, 'R1')).toEqual(['CORNER PULL-OUT']);
  });

  it('R8: a hood counts, and a gas cooktop needs 75 cm', () => {
    const north = [{ x: 100 }, { category: 'stove' as const, x: 100 }, { category: 'hood' as const, x: 100, y: 155 }];
    expect(badges(project({ north }), 'R8')).toEqual([]); // 65 cm above an electric cooktop
    const gas = north.map((i) => (i.category === 'stove' ? { ...i, cooktopType: 'gas' as const } : i));
    expect(badges(project({ north: gas }), 'R8')).toEqual(['TOO LOW ABOVE COOKTOP']);
  });
});

describe('phase C rules', () => {
  it('R3: an open dishwasher door by the corner blocks the units around it', () => {
    const blocked = project({ west: [{ x: 240 }, { x: 180 }], north: [{ category: 'dishwasher', x: 60 }] });
    expect(badges(blocked, 'R3')).toEqual(['DISHWASHER CORNER']);
    const clear = project({ west: [{ x: 240 }, { x: 180 }], north: [{ category: 'dishwasher', x: 130 }] });
    expect(badges(clear, 'R3')).toEqual([]);
  });

  it('R10: a dishwasher at an open run end needs an end panel', () => {
    expect(badges(project({ island: [{ category: 'dishwasher', x: 0 }] }), 'R10')).toEqual(['NO END PANEL']);
    const closed = project({
      island: [
        { category: 'end_panel', x: 0 },
        { category: 'dishwasher', x: 2 },
        { category: 'end_panel', x: 62 },
      ],
    });
    expect(badges(closed, 'R10')).toEqual([]);
    // Against a wall (an inside corner) it is fine.
    expect(badges(project({ north: [{ category: 'dishwasher', x: 0 }] }), 'R10')).toEqual([]);
  });

  it('R12: the dishwasher within 150 cm of the sink, on the same run', () => {
    const sink = [{ x: 0 }, { category: 'sink' as const, x: 0 }];
    expect(badges(project({ north: [...sink, { category: 'dishwasher', x: 60 }] }), 'R12')).toEqual([]);
    expect(badges(project({ north: [...sink, { category: 'dishwasher', x: 250 }] }), 'R12')).toEqual([
      'DW FAR FROM SINK',
    ]);
    expect(badges(project({ north: sink, east: [{ category: 'dishwasher', x: 100 }] }), 'R12')).toEqual([
      'DW FAR FROM SINK',
    ]);
  });

  it('R16: a single-door fridge opens towards the nearest countertop; the fix flips the hinge', () => {
    const fridge = { category: 'fridge' as const, fridgeType: 'top_bottom' as const, x: 100, width: 60 };
    expect(badges(project({ north: [fridge, { x: 160 }] }), 'R16')).toEqual([]); // hinge left, opens to the right
    const wrong = project({ north: [fridge, { x: 40 }] });
    const r16 = checkProject(wrong).filter((v) => v.rule === 'R16');
    expect(r16.map((v) => v.badge)).toEqual(['FRIDGE OPENS AWAY']);
    const fixed = r16[0].fix!.apply(wrong);
    if (typeof fixed === 'string') throw new Error(fixed);
    expect(badges(fixed, 'R16')).toEqual([]);
    // Side-by-side fridges open both ways: never flagged.
    expect(badges(project({ north: [{ ...fridge, fridgeType: 'side_by_side' }, { x: 40 }] }), 'R16')).toEqual([]);
  });

  it('R19: trash next to the sink, dishwasher on the other side', () => {
    const sink = [{ x: 100 }, { category: 'sink' as const, x: 100 }];
    const good = project({
      north: [...sink, { category: 'trash_cabinet', x: 160 }, { category: 'dishwasher', x: 40 }],
    });
    expect(badges(good, 'R19')).toEqual([]);
    const same = project({
      north: [...sink, { category: 'trash_cabinet', x: 160 }, { category: 'dishwasher', x: 205 }],
    });
    expect(badges(same, 'R19')).toEqual(['DW AND TRASH SAME SIDE']);
    const far = project({ north: [...sink, { category: 'trash_cabinet', x: 300 }] });
    expect(badges(far, 'R19')).toEqual(['TRASH NOT AT SINK']);
  });
});
