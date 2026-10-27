import type { KitchenItem, ProjectData, Room, WallRun, WallSide } from '../types';
import { createRoomWalls, defaultDepth, DEFAULT_ROOM, WALL_SIDES } from './defaults';
import { syncRoom } from './plan';

type LegacyWall = Omit<WallRun, 'kind' | 'items'> & Partial<Pick<WallRun, 'kind'>>;
type LegacyItem = Omit<KitchenItem, 'depth'> & { depth?: number };
interface LegacyData {
  room?: Room;
  walls: (LegacyWall & { items: LegacyItem[] })[];
  activeWallId: string;
}

const withDepth = (items: LegacyItem[]): KitchenItem[] =>
  items.map((i) => ({ ...i, depth: typeof i.depth === 'number' ? i.depth : defaultDepth(i.category) }));

/**
 * Bring project data from any earlier format up to the room-based model:
 * the first four legacy walls become the North/East/South/West walls, any further ones become islands,
 * and items without a depth get their category default.
 */
export function migrateProjectData(raw: LegacyData): ProjectData {
  if (raw.room && raw.walls.every((w) => w.kind)) {
    return syncRoom({
      ...raw,
      room: raw.room,
      walls: raw.walls.map((w) => ({ ...(w as WallRun), items: withDepth(w.items) })),
    });
  }

  const legacy = raw.walls;
  const room: Room = {
    widthCm: legacy[0]?.widthCm ?? DEFAULT_ROOM.widthCm,
    depthCm: legacy[1]?.widthCm ?? DEFAULT_ROOM.depthCm,
    heightCm: legacy[0]?.heightCm ?? DEFAULT_ROOM.heightCm,
  };
  const fresh = createRoomWalls(room);
  const walls: WallRun[] = WALL_SIDES.map((side: WallSide, i) => {
    const old = legacy[i];
    if (!old) return fresh[i];
    return {
      ...fresh[i],
      id: old.id,
      name: old.name,
      countertopThicknessCm: old.countertopThicknessCm,
      items: withDepth(old.items),
      side,
      kind: 'wall',
    };
  });
  legacy.slice(4).forEach((old, k) => {
    walls.push({
      ...old,
      kind: 'island',
      items: withDepth(old.items),
      planX: 20 + k * 20,
      planY: 20 + k * 20,
      depthCm: 90,
      rotationDeg: 0,
    });
  });
  const activeWallId = walls.some((w) => w.id === raw.activeWallId) ? raw.activeWallId : walls[0].id;
  return syncRoom({ room, walls, activeWallId });
}
