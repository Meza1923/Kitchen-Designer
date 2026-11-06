import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData, WallRun, WallSide } from '../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { runEnds } from './plan';
import { checkProject, runViolations, severityByItem } from './rules';

const room = { ...DEFAULT_ROOM };
const project = (place: (walls: WallRun[]) => void = () => {}): ProjectData => {
  const walls = createRoomWalls(room);
  place(walls);
  return { room, walls, activeWallId: walls[0].id };
};
const wallOn = (walls: WallRun[], side: WallSide) => walls.find((w) => w.side === side)!;
const item = (category: KitchenItem['category'], props: Partial<KitchenItem> = {}): KitchenItem => ({
  ...createItem(category),
  ...props,
});

describe('runEnds', () => {
  it('connects each wall end to the next wall clockwise', () => {
    const data = project();
    const [n, e, , w] = data.walls;
    expect(runEnds(data, n)).toEqual({
      start: { kind: 'inside_corner', runId: n.id, neighbourId: w.id, neighbourEnd: 'end' },
      end: { kind: 'inside_corner', runId: n.id, neighbourId: e.id, neighbourEnd: 'start' },
    });
  });

  it('leaves an end open when the neighbouring wall is removed', () => {
    const data = project((walls) => (wallOn(walls, 'east').removed = true));
    expect(runEnds(data, wallOn(data.walls, 'north')).end).toEqual({ kind: 'open', runId: data.walls[0].id });
  });

  it('treats both ends of an island as open', () => {
    const data = project();
    const island = createIsland(room, data.walls);
    expect(runEnds(data, island)).toEqual({
      start: { kind: 'open', runId: island.id },
      end: { kind: 'open', runId: island.id },
    });
  });
});

describe('checkProject', () => {
  it('finds nothing in an empty room', () => {
    expect(checkProject(project())).toEqual([]);
  });

  it('reports the existing checks as violations, most severe first', () => {
    const data = project((walls) => {
      const north = wallOn(walls, 'north');
      north.items.push(
        item('base_cabinet', { id: 'a', x: 0 }),
        item('base_cabinet', { id: 'b', x: 50 }),
        item('base_cabinet', { id: 'c', x: 115 }),
      );
    });
    const v = checkProject(data);
    expect(v.map((x) => [x.rule, x.severity])).toEqual([
      ['overlap', 'error'],
      ['narrow_gap', 'warning'],
    ]);
    expect(v[0].items.map((i) => i.itemId)).toEqual(['a', 'b']);
    expect(v[0].message).toContain('overlap by 10 cm');
  });

  it('reports plan clashes with both elements and an area', () => {
    const data = project((walls) => {
      wallOn(walls, 'north').items.push(item('base_cabinet', { id: 'n', x: 0 }));
      wallOn(walls, 'west').items.push(item('base_cabinet', { id: 'w', x: 250 }));
    });
    const clash = checkProject(data).find((v) => v.rule === 'plan_clash')!;
    expect(clash.items.map((i) => i.itemId).sort()).toEqual(['n', 'w']);
    expect(clash.planArea).toBeDefined();
  });

  it('groups by run and keeps the worst severity per element', () => {
    const data = project((walls) => {
      wallOn(walls, 'north').items.push(
        item('base_cabinet', { id: 'a', x: 0 }),
        item('base_cabinet', { id: 'b', x: 50 }),
      );
    });
    const v = checkProject(data);
    expect(runViolations(v, data.walls[0].id)).toHaveLength(v.length);
    expect(runViolations(v, data.walls[1].id)).toEqual([]);
    expect(severityByItem(v).get('a')).toBe('error');
  });
});
