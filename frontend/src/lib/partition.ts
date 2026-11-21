/**
 * Partition walls (FEATURES.md #10 phase B): a wall standing at 90° on a room wall (a T-joint) and running into the
 * room. It is two runs, side A and side B, each with its own elevation and cabinets; `syncRoom` keeps their geometry
 * and the host's joint item in step (see lib/plan.ts → syncPartitions).
 */
import type { ProjectData, WallRun } from '../types';
import { uid } from './defaults';
import { isJoint } from './geometry';
import { MIN_PARTITION_CM, syncRoom, WALL_THICKNESS_CM } from './plan';
import { runName, t } from './i18n';

export const DEFAULT_PARTITION_CM = 120;

/** Both faces of a partition, side A first. */
export const partitionFaces = (data: ProjectData, partitionId: string): WallRun[] =>
  data.walls
    .filter((w) => w.kind === 'partition' && w.partitionId === partitionId)
    .sort((a, b) => (a.face === 'a' ? 0 : 1) - (b.face === 'a' ? 0 : 1));

/** Partition number for names: the lowest "Partition N" not in use. */
function nextNumber(data: ProjectData): number {
  const used = new Set(
    data.walls.flatMap((w) => (w.kind === 'partition' ? [Number(/^Partition (\d+)/.exec(w.name)?.[1])] : [])),
  );
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * A new partition on wall `hostId`, centred on the widest free stretch of its floor (or the middle of the wall), and
 * side A made the active run. Returns a sentence when the wall can't hold one.
 */
export function addPartition(data: ProjectData, hostId: string): ProjectData | string {
  const host = data.walls.find((w) => w.id === hostId);
  if (!host || host.kind !== 'wall' || host.removed) return 'Select a wall tab first: partitions stand on a room wall.';
  const T = WALL_THICKNESS_CM;
  if (host.widthCm < T) return t('{host} is too short for a partition.', { host: runName(host.name) });
  const hostX = Math.round(freeCentre(host) - T / 2);
  const partitionId = uid();
  const n = nextNumber(data);
  const face = (f: 'a' | 'b'): WallRun => ({
    id: uid(),
    name: `Partition ${n} · ${f.toUpperCase()}`,
    kind: 'partition',
    partitionId,
    face: f,
    hostId,
    hostX,
    widthCm: DEFAULT_PARTITION_CM,
    heightCm: data.room.heightCm,
    countertopThicknessCm: 3,
    items: [],
  });
  const a = face('a');
  return syncRoom({ ...data, walls: [...data.walls, a, face('b')], activeWallId: a.id });
}

/** Middle of the widest stretch of the host's floor not taken by a floor unit or another partition. */
function freeCentre(host: WallRun): number {
  const blockers = host.items
    .filter((i) => isJoint(i) || (i.depth > 0 && i.y < 1))
    .map((i) => [i.x, i.x + i.width] as const)
    .sort((p, q) => p[0] - q[0]);
  let best = { x0: 0, x1: 0 };
  let cursor = 0;
  for (const [x0, x1] of blockers) {
    if (x0 - cursor > best.x1 - best.x0) best = { x0: cursor, x1: x0 };
    cursor = Math.max(cursor, x1);
  }
  if (host.widthCm - cursor > best.x1 - best.x0) best = { x0: cursor, x1: host.widthCm };
  return best.x1 - best.x0 >= WALL_THICKNESS_CM ? (best.x0 + best.x1) / 2 : host.widthCm / 2;
}

/** Move a partition along its host wall and/or change its length (both faces follow). */
export function setPartition(
  data: ProjectData,
  partitionId: string,
  change: { hostX?: number; length?: number },
): ProjectData {
  const walls = data.walls.map((w) =>
    w.kind === 'partition' && w.partitionId === partitionId
      ? {
          ...w,
          ...(change.hostX !== undefined ? { hostX: change.hostX } : {}),
          ...(change.length !== undefined ? { widthCm: Math.max(MIN_PARTITION_CM, change.length) } : {}),
        }
      : w,
  );
  return syncRoom({ ...data, walls });
}

/** The project without the partition (both faces, their cabinets and the host's joint). */
export function deletePartition(data: ProjectData, partitionId: string): ProjectData {
  const walls = data.walls.filter((w) => !(w.kind === 'partition' && w.partitionId === partitionId));
  const activeWallId = walls.some((w) => w.id === data.activeWallId)
    ? data.activeWallId
    : (data.walls.find((w) => w.kind === 'partition' && w.partitionId === partitionId)?.hostId ?? walls[0].id);
  return syncRoom({ ...data, walls, activeWallId });
}
