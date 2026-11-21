import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import {
  boxHeight,
  computeCountertops,
  fridgeDoors,
  isElectrical,
  isJoint,
  layerOf,
  isOpening,
  isWallMounted,
} from './geometry';
import {
  countertopRects,
  islandRect,
  endProfiles,
  islandTop,
  isIslandFront,
  isIslandSide,
  stoolPoint,
  localRect,
  toPlan,
  wallFrame,
  runEnds,
  WALL_THICKNESS_CM,
  type Frame,
  type Pt,
  type Rect,
} from './plan';
import { roomOutline } from './outline';

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

/** Appliance finishes; the plain `mat` colours stay matte for cabinets, walls and counters. */
const FINISHES = {
  steel: { color: 0xd1d5db, metalness: 0.9, roughness: 0.38 },
  chrome: { color: 0xe5e7eb, metalness: 0.9, roughness: 0.18 },
  glossWhite: { color: 0xe5e9ee, roughness: 0.35 },
  glossBlack: { color: 0x1f2937, roughness: 0.3 },
  blackGlass: { color: 0x0b1120, roughness: 0.08 },
  screen: { color: 0x0f172a, roughness: 0.1, emissive: 0x38bdf8, emissiveIntensity: 0.55 },
  led: { color: 0xe0f2fe, emissive: 0x7dd3fc, emissiveIntensity: 1 },
  ceramic: { color: 0xffffff, roughness: 0.45 },
  waterGlass: { color: 0xbae6fd, roughness: 0.05, opacity: 0.45, depthWrite: false },
} satisfies Record<string, THREE.MeshStandardMaterialParameters>;
type Finish = keyof typeof FINISHES;

class Builder {
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  readonly edge = new THREE.LineBasicMaterial({ color: 0x334155 });
  readonly edgeSelected = new THREE.LineBasicMaterial({ color: 0x2563eb });

  private special = new Map<string, THREE.MeshStandardMaterial>();

  constructor(
    public selectedId: string | null,
    /** Environment map for reflective appliance materials; without one they fall back to a duller look. */
    private envMap: THREE.Texture | null = null,
  ) {}

  /** Appliance surface finish (see FINISHES), reflecting the environment map when there is one. */
  finish(name: Finish) {
    let m = this.special.get(name);
    if (!m) {
      const { metalness = 0, ...rest }: THREE.MeshStandardMaterialParameters = FINISHES[name];
      // Without reflections, metal renders almost black; tone it down.
      m = new THREE.MeshStandardMaterial({
        ...rest,
        metalness: this.envMap ? metalness : metalness * 0.3,
        envMap: this.envMap,
        transparent: rest.opacity !== undefined,
      });
      this.special.set(name, m);
    }
    return m;
  }

  /** Box over plan rect `r` between heights y0..y1 with rounded edges and no outline (appliance bodies, doors). */
  roundedBox(
    parent: THREE.Object3D,
    r: Rect,
    y0: number,
    y1: number,
    material: THREE.Material,
    radius: number,
    o: { item?: KitchenItem; run?: WallRun } = {},
  ) {
    const h = y1 - y0;
    if (r.w <= 0.01 || r.h <= 0.01 || h <= 0.01) return;
    const geom = new RoundedBoxGeometry(r.w, h, r.h, 4, Math.min(radius, r.w / 2, h / 2, r.h / 2));
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(r.x + r.w / 2, y0 + h / 2, r.y + r.h / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    if (o.item) mesh.userData = { itemId: o.item.id, runId: o.run?.id };
    parent.add(mesh);
  }

  /** Cylinder centred at plan point `p`, height `y`; vertical, or pointing along `axis` (a plan direction). */
  cylinder(
    parent: THREE.Object3D,
    p: Pt,
    y: number,
    radius: number,
    length: number,
    material: THREE.Material,
    axis: Pt | null,
    o: { item?: KitchenItem; run?: WallRun } = {},
  ) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), material);
    mesh.position.set(p.x, y, p.y);
    if (axis) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(axis.x, 0, axis.y));
    mesh.castShadow = !material.transparent; // transparent shadows render as dithered noise
    if (o.item) mesh.userData = { itemId: o.item.id, runId: o.run?.id };
    parent.add(mesh);
  }

  /** Selection outline only (for items drawn without edges). */
  outline(parent: THREE.Object3D, r: Rect, y0: number, y1: number) {
    const h = y1 - y0;
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(r.w, h, r.h)),
      this.edgeSelected,
    );
    lines.position.set(r.x + r.w / 2, y0 + h / 2, r.y + r.h / 2);
    lines.raycast = () => {};
    parent.add(lines);
  }

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
  box(
    parent: THREE.Object3D,
    r: Rect,
    y0: number,
    y1: number,
    color: number,
    o: { opacity?: number; edges?: boolean; item?: KitchenItem; run?: WallRun } = {},
  ) {
    const h = y1 - y0;
    if (r.w <= 0.01 || r.h <= 0.01 || h <= 0.01) return;
    const geom = new THREE.BoxGeometry(r.w, h, r.h);
    const mesh = new THREE.Mesh(geom, this.mat(color, o.opacity));
    mesh.position.set(r.x + r.w / 2, y0 + h / 2, r.y + r.h / 2);
    mesh.castShadow = mesh.receiveShadow = (o.opacity ?? 1) === 1;
    if (o.item) mesh.userData = { itemId: o.item.id, runId: o.run?.id };
    parent.add(mesh);
    if (o.edges !== false) {
      const lines = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        o.item?.id === this.selectedId ? this.edgeSelected : this.edge,
      );
      lines.position.copy(mesh.position);
      lines.raycast = () => {}; // edges never steal clicks
      parent.add(lines);
    }
  }

  /** A disc (washer drum, burner) facing out of the run along its normal. */
  disc(
    parent: THREE.Object3D,
    f: Frame,
    along: number,
    depth: number,
    y: number,
    radius: number,
    color: number,
    flatOnTop = false,
  ) {
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
  /** Optional dark window inset as fractions of the panel. */
  window?: { fa0: number; fa1: number; fy0: number; fy1: number };
  /** Built-in appliance front instead of a cabinet panel (#12). */
  appliance?: 'oven' | 'microwave' | 'coffee';
  handle?: 'top' | 'bottom' | 'middle' | 'drawer';
  hinge?: 'left' | 'right';
}

/** Front panels (doors / drawers / zones) of a cabinet box spanning a0..a1 × y0..y1. */
function frontPanels(item: KitchenItem, a0: number, a1: number, y0: number, y1: number): Panel[] {
  const g = GAP;
  const doors = (count: number, handle: Panel['handle'], ya = y0, yb = y1, hinge: Panel['hinge'] = 'left'): Panel[] =>
    count === 2
      ? [
          { a0: a0 + g, a1: (a0 + a1) / 2 - g / 2, y0: ya + g, y1: yb - g, handle, hinge: 'left' },
          { a0: (a0 + a1) / 2 + g / 2, a1: a1 - g, y0: ya + g, y1: yb - g, handle, hinge: 'right' },
        ]
      : [{ a0: a0 + g, a1: a1 - g, y0: ya + g, y1: yb - g, handle, hinge }];
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
      if (item.frontType === 'open') return [];
      if (item.frontType === 'drawers') {
        const pcts =
          item.drawerSplitPcts.length === item.drawerCount ? item.drawerSplitPcts : Array(item.drawerCount).fill(1);
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
            return doors(1, 'middle', ya, yb, item.doorHinge ?? 'left');
          case 'oven':
          case 'microwave':
          case 'coffee':
            return [{ a0: a0 + g, a1: a1 - g, y0: ya + g, y1: yb - g, appliance: z.type }];
          case 'open':
            return [];
        }
      });
    }
    case 'under_counter_oven':
      return [{ a0: a0 + g, a1: a1 - g, y0: y0 + g, y1: y1 - g, appliance: 'oven' }];
    default:
      return [];
  }
}

function addPanels(
  b: Builder,
  group: THREE.Object3D,
  f: Frame,
  depth: number,
  item: KitchenItem,
  run: WallRun,
  panels: Panel[],
) {
  for (const p of panels) {
    if (p.appliance) {
      applianceFront(b, group, f, depth, p.a0, p.a1, p.y0, p.y1, p.appliance, { item, run });
      continue;
    }
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
      b.box(
        group,
        localRect(f, p.a0 + (w - hw) / 2, p.a0 + (w + hw) / 2, depth, depth + 2),
        cy - 0.6,
        cy + 0.6,
        C.handle,
        { edges: false, item, run },
      );
    } else {
      const ax = p.hinge === 'right' ? p.a0 + 4 : p.a1 - 4;
      const len = Math.min(14, h * 0.3);
      const cy =
        p.handle === 'top' ? p.y1 - 5 - len / 2 : p.handle === 'bottom' ? p.y0 + 5 + len / 2 : (p.y0 + p.y1) / 2;
      b.box(group, localRect(f, ax - 0.6, ax + 0.6, depth, depth + 2), cy - len / 2, cy + len / 2, C.handle, {
        edges: false,
        item,
        run,
      });
    }
  }
}

/** A chrome bar handle on two stand-offs, horizontal along the run at height y, centred on along-position c. */
function barHandle(
  b: Builder,
  group: THREE.Object3D,
  f: Frame,
  depth: number,
  c: number,
  len: number,
  y: number,
  o: object,
) {
  const chrome = b.finish('chrome');
  for (const s of [c - len / 2 + 2, c + len / 2 - 2])
    b.cylinder(group, toPlan(f, s, depth + 1.5), y, 0.6, 3, chrome, f.n, o);
  b.cylinder(group, toPlan(f, c, depth + 3.5), y, 1, len, chrome, f.u, o);
}

/** Knobs (short chrome cylinders) along a control strip. */
function knobs(
  b: Builder,
  group: THREE.Object3D,
  f: Frame,
  depth: number,
  xs: number[],
  y: number,
  r: number,
  o: object,
) {
  for (const x of xs) b.cylinder(group, toPlan(f, x, depth + 0.8), y, r, 1.6, b.finish('chrome'), f.n, o);
}

/**
 * Built-in appliance fronts (#12), between a0..a1 × y0..y1 with their face at wall-local `depth`: an oven (black-glass
 * control strip with a display and knobs, steel door with a glass window and a bar handle), a microwave (glass door
 * and a control column) or a coffee machine (steel with a display and a cup recess).
 */
function applianceFront(
  b: Builder,
  group: THREE.Object3D,
  f: Frame,
  depth: number,
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  kind: 'oven' | 'microwave' | 'coffee',
  o: { item?: KitchenItem; run?: WallRun },
) {
  const steel = b.finish('steel');
  const glass = b.finish('blackGlass');
  const screen = b.finish('screen');
  const w = a1 - a0;
  const h = y1 - y0;
  const mid = (a0 + a1) / 2;
  const face = localRect(f, a0, a1, depth - FRONT, depth);
  if (kind === 'oven') {
    const strip = Math.min(11, h * 0.2);
    b.roundedBox(group, face, y1 - strip, y1, glass, 0.6, o);
    b.roundedBox(
      group,
      localRect(f, mid - 6, mid + 6, depth, depth + 0.2),
      y1 - strip * 0.72,
      y1 - strip * 0.28,
      screen,
      0.3,
      o,
    );
    knobs(
      b,
      group,
      f,
      depth,
      [a0 + 7, a0 + 13, a1 - 13, a1 - 7].filter((x) => x > a0 + 3 && x < a1 - 3),
      y1 - strip / 2,
      1.8,
      o,
    );
    b.roundedBox(group, face, y0, y1 - strip - 0.4, steel, 1, o);
    b.roundedBox(
      group,
      localRect(f, a0 + w * 0.1, a1 - w * 0.1, depth, depth + 0.3),
      y0 + h * 0.1,
      y1 - strip - h * 0.2,
      glass,
      0.6,
      o,
    );
    barHandle(b, group, f, depth, mid, w * 0.78, y1 - strip - Math.min(5, h * 0.08), o);
    return;
  }
  if (kind === 'microwave') {
    const col = Math.min(14, w * 0.26);
    b.roundedBox(group, face, y0, y1, steel, 1, o);
    b.roundedBox(group, localRect(f, a0 + 2, a1 - col - 1, depth, depth + 0.3), y0 + 2.5, y1 - 2.5, glass, 0.6, o);
    b.roundedBox(group, localRect(f, a1 - col, a1 - 1.5, depth, depth + 0.3), y0 + 2.5, y1 - 2.5, glass, 0.5, o);
    b.roundedBox(group, localRect(f, a1 - col + 2, a1 - 3.5, depth + 0.3, depth + 0.5), y1 - 9, y1 - 5, screen, 0.3, o);
    knobs(b, group, f, depth + 0.3, [a1 - col / 2 - 0.75], y0 + h * 0.4, 2, o);
    return;
  }
  // Coffee machine: steel front, a display, and a dark cup recess with twin spouts.
  b.roundedBox(group, face, y0, y1, steel, 1, o);
  b.roundedBox(
    group,
    localRect(f, a0 + w * 0.15, a1 - w * 0.15, depth, depth + 0.2),
    y1 - h * 0.22,
    y1 - h * 0.08,
    screen,
    0.4,
    o,
  );
  b.box(
    group,
    localRect(f, mid - w * 0.22, mid + w * 0.22, depth - 6, depth - 0.2),
    y0 + h * 0.12,
    y0 + h * 0.62,
    C.dark,
    { ...o, edges: false },
  );
  for (const s of [mid - 2, mid + 2])
    b.cylinder(group, toPlan(f, s, depth - 3), y0 + h * 0.55, 0.6, 3, b.finish('chrome'), null, o);
}

function addItem(
  b: Builder,
  group: THREE.Object3D,
  f: Frame,
  run: WallRun,
  item: KitchenItem,
  counterThickness: number,
) {
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
      if (item.frontType === 'open' && (item.category === 'base_cabinet' || item.category === 'upper_cabinet')) {
        // Open cabinet: built from boards so the inside and its shelves show.
        const t = 1.8;
        const [yb, yt] = [y0 + tk, y1];
        b.box(group, localRect(f, a0, a1, 0, t), yb, yt, C.carcass, o); // back
        b.box(group, localRect(f, a0, a0 + t, 0, d), yb, yt, C.front, o); // sides
        b.box(group, localRect(f, a1 - t, a1, 0, d), yb, yt, C.front, o);
        b.box(group, localRect(f, a0 + t, a1 - t, 0, d), yb, yb + t, C.front, o); // bottom, top
        b.box(group, localRect(f, a0 + t, a1 - t, 0, d), yt - t, yt, C.front, o);
        const n = item.shelfCount ?? 0;
        for (let k = 1; k <= n; k++) {
          const ys = yb + ((yt - yb) * k) / (n + 1);
          b.box(group, localRect(f, a0 + t, a1 - t, t, d - 1), ys - t / 2, ys + t / 2, C.front, o);
        }
        return;
      }
      const isCorner = item.category === 'corner_blocker';
      b.box(group, localRect(f, a0, a1, 0, isCorner ? d : d - FRONT), y0 + tk, y1, isCorner ? C.hatch : C.carcass, o);
      addPanels(b, group, f, d, item, run, frontPanels(item, a0, a1, y0 + tk, y0 + tk + boxHeight(item)));
      return;
    }
    case 'end_panel':
      b.box(group, localRect(f, a0, a1, 0, d), y0, y1, C.front, o);
      return;
    case 'hood': {
      // Chimney hood: a slim steel canopy with filters and a light strip underneath, and a chimney to the ceiling.
      const steel = b.finish('steel');
      const slab = Math.min(8, item.height * 0.2);
      b.roundedBox(group, localRect(f, a0, a1, 0, d), y0, y0 + slab, steel, 1, o);
      b.box(group, localRect(f, a0 + 3, a1 - 3, 4, d - 6), y0 - 0.2, y0, 0x6b7280, { ...o, edges: false });
      b.roundedBox(group, localRect(f, a0 + 4, a1 - 4, d - 5, d - 3.5), y0 - 0.3, y0, b.finish('led'), 0.2, o);
      // T-shaped hood: a slim canopy, then the chimney straight up from it to the ceiling (glass edge strip in front).
      b.roundedBox(
        group,
        localRect(f, a0 + 0.5, a1 - 0.5, d - 1.2, d - 0.4),
        y0 + 1,
        y0 + slab - 1,
        b.finish('blackGlass'),
        0.3,
        o,
      );
      const cw = Math.max(12, item.width * 0.2);
      const mid = (a0 + a1) / 2;
      const top = Math.max(y1, run.heightCm);
      b.roundedBox(group, localRect(f, mid - cw, mid + cw, 0, Math.min(d * 0.55, 30)), y0 + slab, top, steel, 0.5, o);
      if (item.id === b.selectedId) b.outline(group, localRect(f, a0, a1, 0, d), y0, y1);
      return;
    }
    case 'column':
      // Column or pipe box (#6 phase 2): part of the building, so wall-coloured.
      b.box(group, localRect(f, a0, a1, 0, d), y0, y1, C.wall, o);
      return;
    case 'shelf':
      // Open wall shelf: a floating board (concealed fixings).
      b.box(group, localRect(f, a0, a1, 0, d), y0, y1, C.front, o);
      return;
    case 'filler': {
      // A plain panel flush with the cabinet fronts.
      const tk = item.hasToeKick ? item.toeKickHeight : 0;
      if (tk > 0) b.box(group, localRect(f, a0, a1, 0, d - 6), y0, y0 + tk, C.plinth, o);
      b.box(group, localRect(f, a0, a1, 0, d), y0 + tk, y1, C.front, o);
      return;
    }
    case 'fridge': {
      // Appliance look: steel body and thick rounded doors (no CAD outlines), dark shadow lines between the doors,
      // round bar handles on stand-offs and a dark kick grille.
      const DOOR = Math.min(6, d * 0.1);
      const SPLIT = 0.8;
      const grille = 5;
      const steel = b.finish('steel');
      const chrome = b.finish('chrome');
      b.roundedBox(group, localRect(f, a0, a1, 0, d - DOOR - 0.5), y0, y1, steel, 1.5, o);
      b.box(group, localRect(f, a0 + 0.5, a1 - 0.5, d - DOOR - 0.5, d - DOOR), y0, y1 - 0.5, C.dark, {
        ...o,
        edges: false,
      });
      b.box(group, localRect(f, a0 + 2, a1 - 2, d - DOOR - 0.5, d - 3), y0, y0 + grille - 0.5, C.dark, {
        ...o,
        edges: false,
      });
      const [fa0, fa1, fy0, fy1] = [a0, a1, y0 + grille, y1];
      const at = (from: number, to: number, frac: number) => from + (to - from) * frac;
      for (const door of fridgeDoors(item.fridgeType, item.doorHinge)) {
        const da0 = at(fa0, fa1, door.fx0) + (door.fx0 > 0 ? SPLIT / 2 : 0);
        const da1 = at(fa0, fa1, door.fx1) - (door.fx1 < 1 ? SPLIT / 2 : 0);
        const dy0 = at(fy0, fy1, door.fy0) + (door.fy0 > 0 ? SPLIT / 2 : 0);
        const dy1 = at(fy0, fy1, door.fy1) - (door.fy1 < 1 ? SPLIT / 2 : 0);
        b.roundedBox(group, localRect(f, da0, da1, d - DOOR, d), dy0, dy1, steel, 1.2, o);

        const dh = dy1 - dy0;
        const len = Math.min(dh * (door.handle === 'middle' ? 0.45 : 0.55), 75);
        const end = Math.min(dh * 0.08, 8);
        const hy0 =
          door.handle === 'top' ? dy1 - end - len : door.handle === 'bottom' ? dy0 + end : dy0 + (dh - len) / 2;
        const hx = door.hinge === 'left' ? da1 - 5 : da0 + 5;
        for (const sy of [hy0 + 2.5, hy0 + len - 2.5]) {
          b.cylinder(group, toPlan(f, hx, d + 1.5), sy, 0.6, 3, chrome, f.n, o);
        }
        b.cylinder(group, toPlan(f, hx, d + 4), hy0 + len / 2, 1.2, len, chrome, null, o);
      }
      if (item.id === b.selectedId) b.outline(group, localRect(f, a0, a1, 0, d + 5.2), y0, y1);
      return;
    }
    case 'washing_machine': {
      // Gloss-white body, a control strip with a display and a dial, and a round door: chrome ring, dark glass.
      const white = b.finish('glossWhite');
      const strip = Math.min(12, item.height * 0.15);
      b.roundedBox(group, localRect(f, a0, a1, 0, d), y0, y1, white, 1.5, o);
      b.roundedBox(group, localRect(f, a0 + 2, a1 - 2, d, d + 0.3), y1 - strip, y1 - 2, b.finish('glossBlack'), 0.5, o);
      b.roundedBox(
        group,
        localRect(f, a0 + item.width * 0.42, a0 + item.width * 0.62, d + 0.3, d + 0.5),
        y1 - strip * 0.75,
        y1 - strip * 0.3,
        b.finish('screen'),
        0.3,
        o,
      );
      knobs(b, group, f, d + 0.3, [a0 + item.width * 0.2], y1 - strip / 2 - 1, 2.6, o);
      const r = Math.min(item.width, item.height - strip) * 0.32;
      const cy = y0 + (item.height - strip) / 2 + 1;
      const c = (a0 + a1) / 2;
      b.cylinder(group, toPlan(f, c, d + 1), cy, r, 2, b.finish('chrome'), f.n, o);
      b.cylinder(group, toPlan(f, c, d + 1.4), cy, r * 0.78, 2, b.finish('blackGlass'), f.n, o);
      b.cylinder(group, toPlan(f, c + r * 0.85, d + 2.4), cy, 1, 2.5, b.finish('glossBlack'), f.n, o);
      if (item.id === b.selectedId) b.outline(group, localRect(f, a0, a1, 0, d + 2.5), y0, y1);
      return;
    }
    case 'dishwasher': {
      const tk = item.hasToeKick ? item.toeKickHeight : 0;
      if (tk > 0) b.box(group, localRect(f, a0 + 0.5, a1 - 0.5, 0, d - 6), y0, y0 + tk, C.plinth, o);
      if (item.dishwasherFront === 'visible') {
        // Its own stainless door with a black-glass control strip and a bar handle (#11).
        b.box(group, localRect(f, a0, a1, 0, d - FRONT), y0 + tk, y1, C.carcass, o);
        b.roundedBox(
          group,
          localRect(f, a0 + 0.2, a1 - 0.2, d - FRONT, d),
          y0 + tk + 0.2,
          y1 - 0.2,
          b.finish('steel'),
          1,
          o,
        );
        b.roundedBox(
          group,
          localRect(f, a0 + 0.5, a1 - 0.5, d, d + 0.3),
          y1 - 9,
          y1 - 1.5,
          b.finish('blackGlass'),
          0.5,
          o,
        );
        b.roundedBox(group, localRect(f, a1 - 16, a1 - 4, d + 0.3, d + 0.5), y1 - 7, y1 - 3.5, b.finish('led'), 0.3, o);
        barHandle(b, group, f, d, (a0 + a1) / 2, item.width * 0.6, y1 - 12, o);
        if (item.id === b.selectedId) b.outline(group, localRect(f, a0, a1, 0, d + 5), y0, y1);
        return;
      }
      // Integrated: a cabinet front like the units beside it, with its handle near the top.
      b.box(group, localRect(f, a0, a1, 0, d - FRONT), y0 + tk, y1, C.carcass, o);
      b.box(group, localRect(f, a0 + 0.2, a1 - 0.2, d - FRONT, d), y0 + tk + 0.2, y1 - 0.2, C.front, o);
      const hw = item.width * 0.25;
      b.box(group, localRect(f, a0 + hw, a1 - hw, d, d + 2), y1 - 7, y1 - 5.8, C.handle, { ...o, edges: false });
      return;
    }
    case 'trash_cabinet': {
      const tk = item.hasToeKick ? item.toeKickHeight : 0;
      if (tk > 0) b.box(group, localRect(f, a0 + 0.5, a1 - 0.5, 0, d - 6), y0, y0 + tk, C.plinth, o);
      b.box(group, localRect(f, a0, a1, 0, d - FRONT), y0 + tk, y1, C.carcass, o);
      b.box(group, localRect(f, a0 + 0.2, a1 - 0.2, d - FRONT, d), y0 + tk + 0.2, y1 - 0.2, C.front, o);
      const hw = item.width * 0.25;
      b.box(group, localRect(f, a0 + hw, a1 - hw, d, d + 2), y1 - 7, y1 - 5.8, C.handle, { ...o, edges: false });
      return;
    }
    case 'sink': {
      const top = y0 + counterThickness;
      const bowls = item.sinkBowls ?? 1;
      const inner = (a1 - a0 - 8 - (bowls - 1) * 3) / bowls;
      // Stainless bowls sunk into the countertop (a steel rim, a dark well, a drain), and a chrome faucet.
      const steel = b.finish('steel');
      for (let i = 0; i < bowls; i++) {
        const s0 = a0 + 4 + i * (inner + 3);
        b.roundedBox(group, localRect(f, s0 - 1, s0 + inner + 1, 7, d - 2), top - 0.1, top + 0.25, steel, 0.8, o);
        b.box(group, localRect(f, s0, s0 + inner, 8, d - 3), top + 0.2, top + 0.27, 0x6b7280, { ...o, edges: false });
        b.cylinder(group, toPlan(f, s0 + inner / 2, (8 + d - 3) / 2), top + 0.3, 2, 0.1, b.finish('chrome'), null, o);
      }
      if (item.hasFaucet) {
        const c = (a0 + a1) / 2;
        const chrome = b.finish('chrome');
        b.cylinder(group, toPlan(f, c, 4.5), top + 1.5, 2.6, 3, chrome, null, o);
        b.cylinder(group, toPlan(f, c, 4.5), top + 15, 1.3, 27, chrome, null, o);
        b.cylinder(group, toPlan(f, c, 4.5 + 8), top + 28, 1.1, 16, chrome, f.n, o);
        b.cylinder(group, toPlan(f, c, 4.5 + 16), top + 25.5, 1.1, 5, chrome, null, o);
        b.cylinder(group, toPlan(f, c + 4, 4.5), top + 8, 0.6, 7, chrome, f.u, o);
      }
      return;
    }
    case 'stove': {
      // Black glass (electric / induction) or a steel top with cast-iron grates and burner caps (gas).
      const top = y0 + counterThickness;
      const type = item.cooktopType ?? 'electric';
      const gas = type === 'gas';
      b.roundedBox(
        group,
        localRect(f, a0 + 1, a1 - 1, 3, d - 1),
        top,
        top + 0.8,
        b.finish(gas ? 'steel' : 'blackGlass'),
        0.4,
        o,
      );
      const n = item.burnerCount ?? 4;
      const spots =
        n === 5
          ? [
              [0.2, 0.32],
              [0.8, 0.32],
              [0.2, 0.74],
              [0.8, 0.74],
              [0.5, 0.53],
            ]
          : [
              [0.28, 0.32],
              [0.72, 0.32],
              [0.28, 0.74],
              [0.72, 0.74],
            ];
      const r = Math.min(item.width, d) * 0.11;
      for (const [fa, fd] of spots) {
        const p = toPlan(f, a0 + item.width * fa, d * fd);
        if (gas) {
          b.cylinder(group, p, top + 1.4, r * 0.5, 1.2, b.finish('glossBlack'), null, o);
          b.cylinder(group, p, top + 2.1, r * 0.3, 0.6, b.finish('chrome'), null, o);
        } else {
          // Heating zones: a ring (electric) or a faint outline (induction).
          b.cylinder(group, p, top + 0.85, r, 0.05, b.mat(type === 'induction' ? 0x475569 : 0x7f1d1d), null, o);
          b.cylinder(group, p, top + 0.88, r * 0.85, 0.05, b.finish('blackGlass'), null, o);
        }
      }
      if (gas) {
        // Two cast-iron grates across the burners.
        for (const [g0, g1] of [
          [0.05, 0.49],
          [0.51, 0.95],
        ]) {
          for (const fd of [0.2, 0.53, 0.86])
            b.box(
              group,
              localRect(f, a0 + item.width * g0, a0 + item.width * g1, d * fd - 0.6, d * fd + 0.6),
              top + 0.8,
              top + 2.6,
              0x111827,
              { ...o, edges: false },
            );
          for (const fa of [g0 + 0.02, (g0 + g1) / 2, g1 - 0.02])
            b.box(
              group,
              localRect(f, a0 + item.width * fa - 0.6, a0 + item.width * fa + 0.6, d * 0.18, d * 0.88),
              top + 0.8,
              top + 2.6,
              0x111827,
              { ...o, edges: false },
            );
        }
      } else {
        // Touch controls printed on the glass, near the front edge.
        b.box(
          group,
          localRect(f, a0 + item.width * 0.35, a0 + item.width * 0.65, d - 6, d - 3),
          top + 0.8,
          top + 0.85,
          0x94a3b8,
          { ...o, edges: false },
        );
      }
      if (item.id === b.selectedId) b.outline(group, localRect(f, a0, a1, 3, d - 1), top, top + 3);
      return;
    }
    case 'water_bar':
    case 'coffee_machine': {
      // A real dispensing alcove (back column, overhanging head, side walls), drip tray, nozzle or spouts,
      // controls on the head, and a glass / cup as the strongest "what is it" cue.
      const coffee = item.category === 'coffee_machine';
      const top = y0 + counterThickness;
      const h = item.height;
      const w = a1 - a0;
      const mid = (a0 + a1) / 2;
      const shell = b.finish(coffee ? 'glossBlack' : 'glossWhite');
      const recess = Math.min(10, d * 0.3);
      const headH = h * (coffee ? 0.32 : 0.36);
      const headY = top + h - headH;
      const side = Math.min(3, w * 0.12);
      const [l0, l1] = [a0 + 0.5, a1 - 0.5];

      b.roundedBox(group, localRect(f, l0, l1, 4, d - recess), top, top + h, shell, 2, o);
      b.roundedBox(
        group,
        localRect(f, l0, l1, d - recess - 1, d),
        headY,
        top + h,
        coffee ? b.finish('steel') : shell,
        2,
        o,
      );
      for (const [s0, s1] of [
        [l0, l0 + side],
        [l1 - side, l1],
      ]) {
        b.roundedBox(group, localRect(f, s0, s1, d - recess - 1, d), top, headY + 1, shell, 1, o);
      }
      b.box(group, localRect(f, l0 + side, l1 - side, d - recess, d - recess + 0.2), top, headY, C.dark, {
        ...o,
        edges: false,
      });

      // Drip tray with slots.
      const trayH = 2;
      b.box(group, localRect(f, l0 + side, l1 - side, d - recess, d + 0.5), top, top + trayH, C.steel, {
        ...o,
        edges: false,
      });
      for (let k = 1; k <= 3; k++) {
        const ax = l0 + side + ((l1 - l0 - 2 * side) * k) / 4;
        b.box(
          group,
          localRect(f, ax - 0.3, ax + 0.3, d - recess + 1, d - 0.5),
          top + trayH,
          top + trayH + 0.05,
          C.dark,
          {
            ...o,
            edges: false,
          },
        );
      }

      // Nozzle (water) or twin spouts (coffee) under the head.
      const spoutDepth = d - recess / 2;
      if (coffee) {
        b.roundedBox(
          group,
          localRect(f, mid - 3, mid + 3, spoutDepth - 2, spoutDepth + 2),
          headY - 3,
          headY,
          b.finish('chrome'),
          0.5,
          o,
        );
        for (const dx of [-1.3, 1.3])
          b.cylinder(group, toPlan(f, mid + dx, spoutDepth), headY - 4, 0.45, 2, b.finish('chrome'), null, o);
      } else {
        b.cylinder(group, toPlan(f, mid, spoutDepth), headY - 1.2, 0.7, 2.4, b.finish('chrome'), null, o);
      }

      // Glass or cup on the tray, sized to fit the alcove.
      const room = headY - (top + trayH);
      const r = Math.min(coffee ? 3.5 : 3, (w - 2 * side) * 0.3, recess * 0.4);
      const ch = Math.min(coffee ? 7 : 10, room * 0.5);
      const cupAt = toPlan(f, mid, spoutDepth);
      b.cylinder(group, cupAt, top + trayH + ch / 2, r, ch, b.finish(coffee ? 'ceramic' : 'waterGlass'), null, o);
      if (coffee) {
        const handleAt = toPlan(f, mid + r + 0.8, spoutDepth);
        b.cylinder(group, handleAt, top + trayH + ch / 2, 0.5, ch * 0.5, b.finish('ceramic'), null, o);
      }

      // Controls on the head front.
      const front = d + 0.15;
      if (coffee) {
        b.box(
          group,
          localRect(f, mid - w * 0.22, mid + w * 0.22, d, front),
          headY + headH * 0.35,
          headY + headH * 0.8,
          C.dark,
          {
            ...o,
            edges: false,
          },
        );
        b.roundedBox(
          group,
          localRect(f, mid - w * 0.2, mid + w * 0.2, d, front + 0.1),
          headY + headH * 0.4,
          headY + headH * 0.75,
          b.finish('screen'),
          0.2,
          o,
        );
        // Bean hopper lid on top, towards the back.
        b.roundedBox(
          group,
          localRect(f, a0 + w * 0.12, a0 + w * 0.55, 6, 6 + Math.min(14, d * 0.35)),
          top + h,
          top + h + 1.2,
          b.finish('glossBlack'),
          0.5,
          o,
        );
      } else {
        b.roundedBox(
          group,
          localRect(f, l0 + side, l1 - side, d, front + 0.1),
          headY + headH * 0.45,
          headY + headH * 0.8,
          b.finish('blackGlass'),
          0.3,
          o,
        );
        for (const fx of [-0.25, 0, 0.25]) {
          const lx = mid + fx * (w - 2 * side);
          b.roundedBox(
            group,
            localRect(f, lx - 0.6, lx + 0.6, front + 0.1, front + 0.3),
            headY + headH * 0.6,
            headY + headH * 0.66,
            b.finish('led'),
            0.1,
            o,
          );
        }
      }
      if (item.id === b.selectedId)
        b.outline(group, localRect(f, a0, a1, 4, d + 0.5), top, top + h + (coffee ? 1.2 : 0));
      return;
    }
  }
}

/** Wall with holes for its windows / doors, plus their glazing and door leaves. */
function addWall(b: Builder, root: THREE.Group, data: ProjectData, run: WallRun) {
  const f = wallFrame(data.room, run);
  const H = data.room.heightCm;
  // Each wall owns the corner at its end: at an inside corner it extends over the corner block, at an outside corner
  // (the tip of an L) it stops short so it doesn't overlap the next wall, which covers that corner.
  const { end: endCorner } = runEnds(data, run);
  const start = 0;
  const end = f.length + (endCorner.kind === 'inside_corner' ? T : 0) - (endCorner.kind === 'outside_corner' ? T : 0);

  const group = new THREE.Group();
  const inner = toPlan(f, f.length / 2, 0);
  // Room walls hide when their outside faces the camera (dollhouse view); partitions stay.
  if (run.kind === 'wall')
    group.userData.wall = {
      point: new THREE.Vector3(inner.x, 0, inner.y),
      normal: new THREE.Vector3(f.n.x, 0, f.n.y),
    } satisfies WallMeta;
  // A partition's body is built once, from side A (side B only adds what is on its face).
  const body = !(run.kind === 'partition' && run.face === 'b');

  const piece = (x0: number, x1: number, y0: number, y1: number) =>
    body && b.box(group, localRect(f, x0, x1, -T, 0), y0, y1, C.wall);
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
      b.box(group, localRect(f, x0, x1, -T / 2 - 0.5, -T / 2 + 0.5), op.y, op.y + op.height, C.glass, {
        ...o,
        opacity: 0.35,
      });
      b.box(group, localRect(f, x0 - 3, x1 + 3, 0, 4), op.y - 2, op.y, C.front, o); // sill
    } else {
      const out = op.doorSwing === 'out';
      const face = out ? -T : 0;
      b.box(
        group,
        localRect(f, x0 + 0.5, x1 - 0.5, out ? face : face - 4, out ? face + 4 : face),
        0,
        op.y + op.height - 0.5,
        C.door,
        o,
      );
      const hx = op.doorHinge === 'right' ? x0 + 7 : x1 - 7;
      const hd = out ? face - 3 : face + 3;
      b.box(group, localRect(f, hx - 6, hx + 6, Math.min(face, hd), Math.max(face, hd)), 103, 105, C.handle, {
        ...o,
        edges: false,
      });
    }
    cursor = Math.max(cursor, x1);
  }
  if (cursor < end) piece(cursor, end, 0, H);

  // Socket plates on the wall's inner face (part of the wall group, so they hide with it).
  for (const s of run.items.filter((i) => isElectrical(i.category))) {
    const o = { item: s, run };
    b.box(group, localRect(f, s.x, s.x + s.width, 0, 0.8), s.y, s.y + s.height, C.front, o);
    const n = s.category === 'power_socket' ? 1 : (s.socketCount ?? 1);
    const cell = s.width / n;
    for (let k = 0; k < n; k++) {
      const c = s.x + cell * (k + 0.5);
      const r = Math.min(cell, s.height) * 0.3;
      b.box(
        group,
        localRect(f, c - r, c + r, 0.8, 1.1),
        s.y + s.height / 2 - r,
        s.y + s.height / 2 + r,
        s.category === 'power_socket' ? 0xb91c1c : C.steel,
        { ...o, edges: false },
      );
    }
  }
  root.add(group);
}

/** A chair at an island (#14): a round seat with a back rest towards the island's far side, a column and a foot ring. */
function addStool(b: Builder, root: THREE.Object3D, c: Pt, st: KitchenItem, run: WallRun) {
  const seat = st.height;
  const r = Math.min(st.width, st.depth) / 2;
  const o = { item: st, run };
  const chrome = b.finish('chrome');
  b.cylinder(root, c, seat - 2, r, 4, b.finish('glossBlack'), null, o);
  b.cylinder(root, c, (seat - 4) / 2, 1.6, seat - 4, chrome, null, o);
  b.cylinder(root, c, 0.6, r * 0.75, 1.2, chrome, null, o);
  b.cylinder(root, c, seat * 0.38, r * 0.7, 0.8, chrome, null, o);
  if (st.id === b.selectedId) b.outline(root, { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }, 0, seat);
}

export function buildKitchen(
  data: ProjectData,
  selectedId: string | null,
  envMap: THREE.Texture | null = null,
): THREE.Group {
  const b = new Builder(selectedId, envMap);
  const root = new THREE.Group();
  const { room } = data;

  // Floor in the room's outline (plan Y is three Z; the shape is drawn in X / −Y and turned flat).
  const shape = new THREE.Shape(roomOutline(room).map((p) => new THREE.Vector2(p.x, -p.y)));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), b.mat(C.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  const grid = new THREE.GridHelper(
    Math.max(room.widthCm, room.depthCm),
    Math.round(Math.max(room.widthCm, room.depthCm) / 50),
    0xd6d3d1,
    0xd6d3d1,
  );
  grid.position.set(room.widthCm / 2, 0.05, room.depthCm / 2);
  grid.raycast = () => {};
  root.add(grid);

  for (const run of data.walls) {
    if (run.kind === 'wall' && run.removed) continue;
    if (run.kind === 'wall' || run.kind === 'partition') addWall(b, root, data, run);
    const islandUnits = (r: WallRun) => r.items.some((i) => layerOf(i.category) === 'floor' && i.depth > 0);
    if (isIslandFront(run) && ![run, ...data.walls.filter((w) => w.hostId === run.id)].some(islandUnits)) {
      const r = islandRect(run);
      b.box(root, r, 0, 0.4, C.open, { opacity: 0.6 });
    }
    const f = wallFrame(room, run);
    const group = new THREE.Group();
    for (const item of run.items) {
      if (isWallMounted(item.category) || isJoint(item) || item.category === 'stool') continue;
      addItem(b, group, f, run, item, run.countertopThicknessCm);
    }
    // Islands get one countertop over all their sides (below); walls one per run of units.
    if (run.kind !== 'island') {
      const slabs = computeCountertops(run); // same order as countertopRects
      countertopRects(f, run).forEach((r, i) =>
        b.box(group, r, slabs[i].y, slabs[i].y + slabs[i].thickness, C.counter),
      );
    }
    root.add(group);
  }
  // Islands (#15): the countertop in one piece, the end profiles (plain panel / waterfall) and the chairs.
  for (const isl of data.walls.filter(isIslandFront)) {
    const sides = [isl, ...data.walls.filter((w) => isIslandSide(w) && w.hostId === isl.id)];
    const top = islandTop(data, isl);
    const t = isl.countertopThicknessCm;
    // An island with no cabinets yet shows only its place on the floor, not a floating top (review finding R22).
    const designed = sides.some((r) => r.items.some((i) => layerOf(i.category) === 'floor' && i.depth > 0));
    if (!designed) continue;
    b.box(root, islandRect(isl), top - t, top, C.counter);
    for (const p of endProfiles(isl))
      b.box(root, p.rect, 0, p.kind === 'waterfall' ? top : top - t, p.kind === 'waterfall' ? C.counter : C.front);
    for (const run of sides)
      for (const st of run.items.filter((i) => i.category === 'stool'))
        addStool(b, root, stoolPoint(data, run, st), st, run);
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
