import * as THREE from 'three';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { boxHeight, computeCountertops, isElectrical, isOpening, isWallMounted } from './geometry';
import { countertopRects, islandRect, localRect, toPlan, wallFrame, WALL_THICKNESS_CM, type Frame, type Rect } from './plan';

/**
 * Builds a shaded 3D model of the project. Units are cm; plan X → three X, plan Y → three Z, height → three Y.
 * Every mesh of a kitchen item carries `userData.itemId` / `userData.runId` for picking. Each wall is its own
 * group with `userData.wall = { point, normal }` (inner face, normal into the room) so the viewer can hide
 * walls that stand between the camera and the room.
 */

const C = {
  floor: 0xe7e5e4,
  wall: 0xf5f5f4,
  carcass: 0xf1f5f9,
  front: 0xffffff,
  plinth: 0x94a3b8,
  counter: 0xd6d3d1,
  handle: 0x475569,
  dark: 0x1e293b,
  steel: 0xe2e8f0,
  hatch: 0xcbd5e1,
  sink: 0x9ca3af,
  hob: 0x111827,
  glass: 0xbae6fd,
  door: 0xd6c7b0,
  open: 0xcbd5e1,
};

const FRONT = 1.8; // front panel thickness (cm)
const GAP = 0.3; // reveal between fronts (cm)
const T = WALL_THICKNESS_CM;

export interface WallMeta {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

class Builder {
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  readonly edge = new THREE.LineBasicMaterial({ color: 0x334155 });
  readonly edgeSelected = new THREE.LineBasicMaterial({ color: 0x2563eb });

  constructor(public selectedId: string | null) {}

  mat(color: number, opacity = 1) {
    const key = `${color}:${opacity}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, transparent: opacity < 1, opacity });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Axis-aligned box over plan rect `r` between heights y0..y1. */
  box(parent: THREE.Object3D, r: Rect, y0: number, y1: number, color: number, o: { opacity?: number; edges?: boolean; item?: KitchenItem; run?: WallRun } = {}) {
    const h = y1 - y0;
    if (r.w <= 0.01 || r.h <= 0.01 || h <= 0.01) return;
    const geom = new THREE.BoxGeometry(r.w, h, r.h);
    const mesh = new THREE.Mesh(geom, this.mat(color, o.opacity));
    mesh.position.set(r.x + r.w / 2, y0 + h / 2, r.y + r.h / 2);
    mesh.castShadow = mesh.receiveShadow = (o.opacity ?? 1) === 1;
    if (o.item) mesh.userData = { itemId: o.item.id, runId: o.run?.id };
    parent.add(mesh);
    if (o.edges !== false) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geom), o.item?.id === this.selectedId ? this.edgeSelected : this.edge);
      lines.position.copy(mesh.position);
      lines.raycast = () => {}; // edges never steal clicks
      parent.add(lines);
    }
  }

  /** A disc (washer drum, burner) facing out of the run along its normal. */
  disc(parent: THREE.Object3D, f: Frame, along: number, depth: number, y: number, radius: number, color: number, flatOnTop = false) {
    const geom = new THREE.CylinderGeometry(radius, radius, 0.6, 32);
    const mesh = new THREE.Mesh(geom, this.mat(color));
    const p = toPlan(f, along, depth);
    mesh.position.set(p.x, y, p.y);
    if (!flatOnTop) {
      // Cylinder axis is +Y; turn it to point along the run's normal.
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.n.x, 0, f.n.y));
    }
    parent.add(mesh);
  }
}

interface Panel {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  color?: number;
  /** Optional dark window inset (oven, microwave, coffee) as fractions of the panel. */
  window?: { fa0: number; fa1: number; fy0: number; fy1: number };
  handle?: 'top' | 'bottom' | 'middle' | 'drawer';
  hinge?: 'left' | 'right';
}

/** Front panels (doors / drawers / zones) of a cabinet box spanning a0..a1 × y0..y1. */
function frontPanels(item: KitchenItem, a0: number, a1: number, y0: number, y1: number): Panel[] {
  const g = GAP;
  const doors = (count: number, handle: Panel['handle'], ya = y0, yb = y1): Panel[] =>
    count === 2
      ? [
          { a0: a0 + g, a1: (a0 + a1) / 2 - g / 2, y0: ya + g, y1: yb - g, handle, hinge: 'left' },
          { a0: (a0 + a1) / 2 + g / 2, a1: a1 - g, y0: ya + g, y1: yb - g, handle, hinge: 'right' },
        ]
      : [{ a0: a0 + g, a1: a1 - g, y0: ya + g, y1: yb - g, handle, hinge: 'left' }];
  const drawers = (pcts: number[], ya = y0, yb = y1): Panel[] => {
    const total = pcts.reduce((s, p) => s + p, 0) || 1;
    let top = yb;
    return pcts.map((p) => {
      const h = ((yb - ya) * p) / total;
      const panel: Panel = { a0: a0 + g, a1: a1 - g, y0: top - h + g / 2, y1: top - g / 2, handle: 'drawer' };
      top -= h;
      return panel;
    });
  };

  switch (item.category) {
    case 'base_cabinet':
    case 'upper_cabinet':
      if (item.frontType === 'drawers') {
        const pcts = item.drawerSplitPcts.length === item.drawerCount ? item.drawerSplitPcts : Array(item.drawerCount).fill(1);
        return drawers(pcts);
      }
      return doors(item.doorCount, item.category === 'upper_cabinet' ? 'bottom' : 'top');
    case 'tall_cabinet': {
      const zones = item.tallZones ?? [];
      const total = zones.reduce((s, z) => s + z.heightPct, 0) || 1;
      let bottom = y0;
      return zones.flatMap((z) => {
        const h = ((y1 - y0) * z.heightPct) / total;
        const ya = bottom;
        const yb = bottom + h;
        bottom = yb;
        switch (z.type) {
          case 'drawers':
            return drawers(Array(Math.max(1, z.drawerCount ?? 3)).fill(1), ya, yb);
          case 'door':
            return doors(1, 'middle', ya, yb);
          case 'oven':
            return [{ a0: a0 + g, a1: a1 - g, y0: ya + g, y1: yb - g, handle: 'drawer', window: { fa0: 0.12, fa1: 0.88, fy0: 0.1, fy1: 0.72 } }];
          case 'microwave':
            return [{ a0: a0 + g, a1: a1 - g, y0: ya + g, y1: yb - g, window: { fa0: 0.06, fa1: 0.68, fy0: 0.12, fy1: 0.88 } }];
          case 'coffee':
            return [{ a0: a0 + g, a1: a1 - g, y0: ya + g, y1: yb - g, color: C.steel, window: { fa0: 0.3, fa1: 0.7, fy0: 0.2, fy1: 0.75 } }];
          case 'open':
            return [];
        }
      });
    }
    case 'under_counter_oven':
      return [
        { a0: a0 + g, a1: a1 - g, y0: y1 - 12, y1: y1 - g, color: C.dark },
        { a0: a0 + g, a1: a1 - g, y0: y0 + g, y1: y1 - 12 - g, handle: 'drawer', window: { fa0: 0.12, fa1: 0.88, fy0: 0.12, fy1: 0.72 } },
      ];
    default:
      return [];
  }
}

function addPanels(b: Builder, group: THREE.Object3D, f: Frame, depth: number, item: KitchenItem, run: WallRun, panels: Panel[]) {
  for (const p of panels) {
    b.box(group, localRect(f, p.a0, p.a1, depth - FRONT, depth), p.y0, p.y1, p.color ?? C.front, { item, run });
    const w = p.a1 - p.a0;
    const h = p.y1 - p.y0;
    if (p.window) {
      const wr = localRect(f, p.a0 + w * p.window.fa0, p.a0 + w * p.window.fa1, depth, depth + 0.3);
      b.box(group, wr, p.y0 + h * p.window.fy0, p.y0 + h * p.window.fy1, C.dark, { item, run, edges: false });
    }
    if (!p.handle) continue;
    if (p.handle === 'drawer') {
      const hw = Math.min(w * 0.4, 30);
      const cy = p.y1 - Math.min(h / 2, 6);
      b.box(group, localRect(f, p.a0 + (w - hw) / 2, p.a0 + (w + hw) / 2, depth, depth + 2), cy - 0.6, cy + 0.6, C.handle, { edges: false, item, run });
    } else {
      const ax = p.hinge === 'right' ? p.a0 + 4 : p.a1 - 4;
      const len = Math.min(14, h * 0.3);
      const cy = p.handle === 'top' ? p.y1 - 5 - len / 2 : p.handle === 'bottom' ? p.y0 + 5 + len / 2 : (p.y0 + p.y1) / 2;
      b.box(group, localRect(f, ax - 0.6, ax + 0.6, depth, depth + 2), cy - len / 2, cy + len / 2, C.handle, { edges: false, item, run });
    }
  }
}

function addItem(b: Builder, group: THREE.Object3D, f: Frame, run: WallRun, item: KitchenItem, counterThickness: number) {
  const a0 = item.x;
  const a1 = item.x + item.width;
  const d = item.depth;
  const y0 = item.y;
  const y1 = item.y + item.height;
  const o = { item, run };

  switch (item.category) {
    case 'base_cabinet':
    case 'upper_cabinet':
    case 'tall_cabinet':
    case 'corner_blocker':
    case 'under_counter_oven': {
      const tk = item.hasToeKick ? item.toeKickHeight : 0;
      if (tk > 0) b.box(group, localRect(f, a0 + 0.5, a1 - 0.5, 0, d - 6), y0, y0 + tk, C.plinth, o);
      const isCorner = item.category === 'corner_blocker';
      b.box(group, localRect(f, a0, a1, 0, isCorner ? d : d - FRONT), y0 + tk, y1, isCorner ? C.hatch : C.carcass, o);
      addPanels(b, group, f, d, item, run, frontPanels(item, a0, a1, y0 + tk, y0 + tk + boxHeight(item)));
      return;
    }
    case 'fridge': {
      b.box(group, localRect(f, a0, a1, 0, d - FRONT), y0, y1, C.steel, o);
      addPanels(b, group, f, d, item, run, [
        { a0: a0 + GAP, a1: (a0 + a1) / 2 - GAP / 2, y0: y0 + 2, y1: y1 - GAP, color: C.steel, handle: 'middle', hinge: 'left' },
        { a0: (a0 + a1) / 2 + GAP / 2, a1: a1 - GAP, y0: y0 + 2, y1: y1 - GAP, color: C.steel, handle: 'middle', hinge: 'right' },
      ]);
      return;
    }
    case 'washing_machine': {
      b.box(group, localRect(f, a0, a1, 0, d), y0, y1, C.front, o);
      b.box(group, localRect(f, a0 + 2, a1 - 2, d, d + 0.3), y1 - 12, y1 - 3, C.steel, { ...o, edges: false });
      b.disc(group, f, (a0 + a1) / 2, d + 0.3, y0 + (item.height - 12) / 2 + 2, Math.min(item.width, item.height) * 0.3, C.dark);
      return;
    }
    case 'sink': {
      const top = y0 + counterThickness;
      const bowls = item.sinkBowls ?? 1;
      const inner = (a1 - a0 - 8 - (bowls - 1) * 3) / bowls;
      for (let i = 0; i < bowls; i++) {
        const s = a0 + 4 + i * (inner + 3);
        b.box(group, localRect(f, s, s + inner, 8, d - 3), top - 0.2, top + 0.15, C.sink, o);
      }
      if (item.hasFaucet) {
        const c = (a0 + a1) / 2;
        b.box(group, localRect(f, c - 1.2, c + 1.2, 3, 5.4), top, top + 28, C.handle, { ...o, edges: false });
        b.box(group, localRect(f, c - 1.2, c + 1.2, 3, 20), top + 26, top + 28.4, C.handle, { ...o, edges: false });
      }
      return;
    }
    case 'stove': {
      const top = y0 + counterThickness;
      b.box(group, localRect(f, a0 + 1, a1 - 1, 3, d - 1), top, top + 1.5, C.hob, o);
      const n = item.burnerCount ?? 4;
      const spots = n === 5 ? [[0.2, 0.32], [0.8, 0.32], [0.2, 0.74], [0.8, 0.74], [0.5, 0.53]] : [[0.28, 0.32], [0.72, 0.32], [0.28, 0.74], [0.72, 0.74]];
      for (const [fa, fd] of spots) b.disc(group, f, a0 + item.width * fa, d * fd, top + 1.8, Math.min(item.width, d) * 0.11, 0x6b7280, true);
      return;
    }
    case 'water_bar':
    case 'coffee_machine': {
      const top = y0 + counterThickness;
      b.box(group, localRect(f, a0 + 1, a1 - 1, 4, d), top, top + item.height, item.category === 'water_bar' ? C.front : C.steel, o);
      const w = a1 - a0;
      b.box(group, localRect(f, a0 + w * 0.2, a1 - w * 0.2, d, d + 0.3), top + item.height * 0.65, top + item.height * 0.9, C.dark, { ...o, edges: false });
      b.box(group, localRect(f, a0 + w * 0.3, a1 - w * 0.3, d - 12, d + 1), top, top + 1.5, C.handle, { ...o, edges: false });
      return;
    }
  }
}

/** Wall with holes for its windows / doors, plus their glazing and door leaves. */
function addWall(b: Builder, root: THREE.Group, data: ProjectData, run: WallRun) {
  const f = wallFrame(data.room, run);
  const H = data.room.heightCm;
  const present = (side: string) => data.walls.some((w) => w.kind === 'wall' && w.side === side && !w.removed);
  // North/south walls own the corners (as in the plan), extended toward a neighbour that exists.
  const startNeighbour = { north: 'west', south: 'east' }[run.side as 'north' | 'south'];
  const endNeighbour = { north: 'east', south: 'west' }[run.side as 'north' | 'south'];
  const start = startNeighbour && present(startNeighbour) ? -T : 0;
  const end = f.length + (endNeighbour && present(endNeighbour) ? T : 0);

  const group = new THREE.Group();
  const inner = toPlan(f, f.length / 2, 0);
  group.userData.wall = { point: new THREE.Vector3(inner.x, 0, inner.y), normal: new THREE.Vector3(f.n.x, 0, f.n.y) } satisfies WallMeta;

  const piece = (x0: number, x1: number, y0: number, y1: number) => b.box(group, localRect(f, x0, x1, -T, 0), y0, y1, C.wall);
  const openings = run.items.filter((i) => isOpening(i.category)).sort((p, q) => p.x - q.x);
  let cursor = start;
  for (const op of openings) {
    const x0 = Math.max(op.x, cursor);
    const x1 = op.x + op.width;
    if (x0 > cursor) piece(cursor, x0, 0, H);
    if (op.y > 0) piece(x0, x1, 0, op.y);
    if (op.y + op.height < H) piece(x0, x1, op.y + op.height, H);
    const o = { item: op, run };
    if (op.category === 'window') {
      b.box(group, localRect(f, x0, x1, -T / 2 - 0.5, -T / 2 + 0.5), op.y, op.y + op.height, C.glass, { ...o, opacity: 0.35 });
      b.box(group, localRect(f, x0 - 3, x1 + 3, 0, 4), op.y - 2, op.y, C.front, o); // sill
    } else {
      const out = op.doorSwing === 'out';
      const face = out ? -T : 0;
      b.box(group, localRect(f, x0 + 0.5, x1 - 0.5, out ? face : face - 4, out ? face + 4 : face), 0, op.y + op.height - 0.5, C.door, o);
      const hx = op.doorHinge === 'right' ? x0 + 7 : x1 - 7;
      const hd = out ? face - 3 : face + 3;
      b.box(group, localRect(f, hx - 6, hx + 6, Math.min(face, hd), Math.max(face, hd)), 103, 105, C.handle, { ...o, edges: false });
    }
    cursor = Math.max(cursor, x1);
  }
  if (cursor < end) piece(cursor, end, 0, H);

  // Socket plates on the wall's inner face (part of the wall group, so they hide with it).
  for (const s of run.items.filter((i) => isElectrical(i.category))) {
    const o = { item: s, run };
    b.box(group, localRect(f, s.x, s.x + s.width, 0, 0.8), s.y, s.y + s.height, C.front, o);
    const n = s.category === 'power_socket' ? 1 : s.socketCount ?? 1;
    const cell = s.width / n;
    for (let k = 0; k < n; k++) {
      const c = s.x + cell * (k + 0.5);
      const r = Math.min(cell, s.height) * 0.3;
      b.box(group, localRect(f, c - r, c + r, 0.8, 1.1), s.y + s.height / 2 - r, s.y + s.height / 2 + r, s.category === 'power_socket' ? 0xb91c1c : C.steel, { ...o, edges: false });
    }
  }
  root.add(group);
}

export function buildKitchen(data: ProjectData, selectedId: string | null): THREE.Group {
  const b = new Builder(selectedId);
  const root = new THREE.Group();
  const { room } = data;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.widthCm, room.depthCm), b.mat(C.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(room.widthCm / 2, 0, room.depthCm / 2);
  floor.receiveShadow = true;
  root.add(floor);
  const grid = new THREE.GridHelper(Math.max(room.widthCm, room.depthCm), Math.round(Math.max(room.widthCm, room.depthCm) / 50), 0xd6d3d1, 0xd6d3d1);
  grid.position.set(room.widthCm / 2, 0.05, room.depthCm / 2);
  grid.raycast = () => {};
  root.add(grid);

  for (const run of data.walls) {
    if (run.kind === 'wall' && run.removed) continue;
    if (run.kind === 'wall') addWall(b, root, data, run);
    if (run.kind === 'island' && !run.items.length) {
      const r = islandRect(run);
      b.box(root, r, 0, 0.4, C.open, { opacity: 0.6 });
    }
    const f = wallFrame(room, run);
    const group = new THREE.Group();
    for (const item of run.items) {
      if (isWallMounted(item.category)) continue;
      addItem(b, group, f, run, item, run.countertopThicknessCm);
    }
    const slabs = computeCountertops(run); // same order as countertopRects
    countertopRects(f, run).forEach((r, i) => b.box(group, r, slabs[i].y, slabs[i].y + slabs[i].thickness, C.counter));
    root.add(group);
  }
  return root;
}

/** Free the GPU resources of a tree built by buildKitchen (each build owns its geometries and materials). */
export function disposeTree(obj: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
    }
  });
  materials.forEach((m) => m.dispose());
}
