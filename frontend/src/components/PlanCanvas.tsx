import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import type { Violation } from '../lib/rules';
import { snapX } from '../lib/geometry';
import { planPointToWallX, snapTo, wallFrame } from '../lib/plan';
import { dragCorner, dragWall } from '../lib/roomShape';
import { roomOutline, segments } from '../lib/outline';
import { planOrigin, PlanDrawing, planSize } from './PlanDrawing';
import { GridBackground, useShiftHeld, useViewport, ZoomControls } from './viewport';

export const PLAN_SCALE = 2; // px per cm at 100% zoom
const ISLAND_GRID_CM = 5;

/** Dragging a wall or a room corner. */
interface BoundaryDrag {
  /** The wall dragged, or (corner) the outline point index as a string. */
  runId: string;
  /** The project when the drag started: every move is computed from it, so nothing drifts. */
  start: ProjectData;
  startPt: { x: number; y: number };
  /** The wall's normal; for a corner, the normals of the wall ending and the wall starting there. */
  normal: { x: number; y: number };
  normal2?: { x: number; y: number };
  /** How far the plan's coordinates have moved so far (the room's top-left stays at 0, 0). */
  shift: { x: number; y: number };
  /** Last snapped distance(s) applied, to skip moves that don't change them. */
  applied: string;
  moved: boolean;
}

type Drag =
  | { kind: 'item'; runId: string; itemId: string; startX: number; startProj: number; moved: boolean }
  | (BoundaryDrag & { kind: 'wall' })
  | (BoundaryDrag & { kind: 'corner' })
  | {
      /** A partition wall: slid along its host wall, or (length) its tip pulled along the partition. */
      kind: 'partition';
      partitionId: string;
      mode: 'slide' | 'length';
      /** Direction of the drag that counts, and the value it changes when the drag started. */
      axis: { x: number; y: number };
      startValue: number;
      startPt: { x: number; y: number };
      moved: boolean;
    }
  | {
      kind: 'island';
      runId: string;
      startPlan: { x: number; y: number };
      startPt: { x: number; y: number };
      moved: boolean;
    };

interface Props {
  data: ProjectData;
  selectedId: string | null;
  onSelect: (runId: string, itemId: string | null) => void;
  onActivate: (runId: string) => void;
  onMoveItem: (itemId: string, pos: { x: number }) => void;
  onMoveIsland: (runId: string, pos: { planX: number; planY: number }) => void;
  /** A wall dragged in the plan: the whole updated project (one undo step per drag). */
  onDragWall: (next: ProjectData) => void;
  /** A partition wall moved along its host or resized in the plan. */
  onUpdatePartition: (partitionId: string, change: { hostX?: number; length?: number }) => void;
  violations: Violation[];
}

/** Interactive top-down floor plan. Items slide along their wall; islands move freely. */
export function PlanCanvas({
  data,
  selectedId,
  onSelect,
  onActivate,
  onMoveItem,
  onMoveIsland,
  onDragWall,
  onUpdatePartition,
  violations,
}: Props) {
  // Re-fit when the room's size changes, but not while (or because) a wall is being dragged: the view stays put.
  const dims = `${data.room.widthCm}:${data.room.depthCm}`;
  const lastDims = useRef(dims);
  const fitCount = useRef(0);
  const draggingWall = useRef(false);
  if (dims !== lastDims.current) {
    lastDims.current = dims;
    if (!draggingWall.current) fitCount.current++;
  }
  const vp = useViewport(planSize(data, PLAN_SCALE), String(fitCount.current));
  const shiftHeld = useShiftHeld();
  const drag = useRef<Drag | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const toCm = (e: ReactPointerEvent) => {
    const p = vp.toSvg(e.clientX, e.clientY);
    const o = planOrigin(PLAN_SCALE);
    return { x: (p.x - o) / PLAN_SCALE, y: (p.y - o) / PLAN_SCALE };
  };

  const onItemPointerDown = (e: ReactPointerEvent, run: WallRun, item: KitchenItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(run.id, item.id);
    vp.svgRef.current!.setPointerCapture(e.pointerId);
    const f = wallFrame(data.room, run);
    drag.current = {
      kind: 'item',
      runId: run.id,
      itemId: item.id,
      startX: item.x,
      startProj: planPointToWallX(f, toCm(e)),
      moved: false,
    };
  };

  const onRunPointerDown = (e: ReactPointerEvent, run: WallRun) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onActivate(run.id);
    if (run.kind === 'wall') {
      vp.svgRef.current!.setPointerCapture(e.pointerId);
      drag.current = {
        kind: 'wall',
        runId: run.id,
        start: data,
        startPt: toCm(e),
        normal: wallFrame(data.room, run).n,
        shift: { x: 0, y: 0 },
        applied: '0',
        moved: false,
      };
      return;
    }
    if (run.kind === 'partition') {
      const host = data.walls.find((w) => w.id === run.hostId);
      if (!host) return;
      vp.svgRef.current!.setPointerCapture(e.pointerId);
      drag.current = {
        kind: 'partition',
        partitionId: run.partitionId ?? '',
        mode: 'slide',
        axis: wallFrame(data.room, host).u,
        startValue: run.hostX ?? 0,
        startPt: toCm(e),
        moved: false,
      };
      return;
    }
    if (run.kind !== 'island') return;
    vp.svgRef.current!.setPointerCapture(e.pointerId);
    drag.current = {
      kind: 'island',
      runId: run.id,
      startPlan: { x: run.planX ?? 0, y: run.planY ?? 0 },
      startPt: toCm(e),
      moved: false,
    };
  };

  const onCornerPointerDown = (e: ReactPointerEvent, corner: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    vp.svgRef.current!.setPointerCapture(e.pointerId);
    const segs = segments(roomOutline(data.room));
    drag.current = {
      kind: 'corner',
      runId: String(corner),
      start: data,
      startPt: toCm(e),
      normal: segs[(corner + segs.length - 1) % segs.length].n,
      normal2: segs[corner].n,
      shift: { x: 0, y: 0 },
      applied: '0:0',
      moved: false,
    };
  };

  const onPartitionTipPointerDown = (e: ReactPointerEvent, faceA: WallRun) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onActivate(faceA.id);
    vp.svgRef.current!.setPointerCapture(e.pointerId);
    drag.current = {
      kind: 'partition',
      partitionId: faceA.partitionId ?? '',
      mode: 'length',
      axis: wallFrame(data.room, faceA).u,
      startValue: faceA.widthCm,
      startPt: toCm(e),
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (vp.movePan(e)) return;
    const d = drag.current;
    if (!d) return;
    const pt = toCm(e);
    if (d.kind === 'wall' || d.kind === 'corner') {
      // Pointer in the drag's starting coordinates, then its distance along each moving wall's normal (into the room).
      const mx = pt.x + d.shift.x - d.startPt.x;
      const my = pt.y + d.shift.y - d.startPt.y;
      if (!d.moved && Math.hypot(mx, my) * PLAN_SCALE < 3) return;
      const step = e.shiftKey ? 1 : ISLAND_GRID_CM;
      const along = (n: { x: number; y: number }) => snapTo(mx * n.x + my * n.y, step);
      const a = along(d.normal);
      const b = d.normal2 ? along(d.normal2) : 0;
      const key = d.kind === 'corner' ? `${a}:${b}` : String(a);
      if (key === d.applied) return; // same snapped position: nothing to redo
      d.moved = true;
      draggingWall.current = true;
      const result = d.kind === 'corner' ? dragCorner(d.start, Number(d.runId), a, b) : dragWall(d.start, d.runId, a);
      if (typeof result === 'string') return; // keep the last valid position
      // Keep the room still on screen when its top-left (the plan's origin) moves.
      // d.shift holds minus the previous shift, so this pans by (new shift − previous shift).
      vp.panBy((result.shift.x + d.shift.x) * PLAN_SCALE, (result.shift.y + d.shift.y) * PLAN_SCALE);
      d.shift = { x: -result.shift.x, y: -result.shift.y };
      d.applied = key;
      onDragWall(result.data);
      return;
    }
    if (d.kind === 'partition') {
      const raw = (pt.x - d.startPt.x) * d.axis.x + (pt.y - d.startPt.y) * d.axis.y;
      if (!d.moved && Math.abs(raw) * PLAN_SCALE < 3) return;
      d.moved = true;
      const value = snapTo(d.startValue + raw, e.shiftKey ? 1 : ISLAND_GRID_CM);
      const faceA = dataRef.current.walls.find((w) => w.partitionId === d.partitionId && w.face !== 'b');
      const current = d.mode === 'slide' ? faceA?.hostX : faceA?.widthCm;
      if (value !== current)
        onUpdatePartition(d.partitionId, d.mode === 'slide' ? { hostX: value } : { length: value });
      return;
    }
    const current = dataRef.current;
    const run = current.walls.find((w) => w.id === d.runId);
    if (!run) return;

    if (d.kind === 'island') {
      const dx = pt.x - d.startPt.x;
      const dy = pt.y - d.startPt.y;
      if (!d.moved && Math.hypot(dx, dy) * PLAN_SCALE < 3) return;
      d.moved = true;
      const step = e.shiftKey ? 1 : ISLAND_GRID_CM;
      const planX = snapTo(d.startPlan.x + dx, step);
      const planY = snapTo(d.startPlan.y + dy, step);
      if (planX !== run.planX || planY !== run.planY) onMoveIsland(run.id, { planX, planY });
      return;
    }

    const item = run.items.find((i) => i.id === d.itemId);
    if (!item) return;
    const delta = planPointToWallX(wallFrame(current.room, run), pt) - d.startProj;
    if (!d.moved && Math.abs(delta) * PLAN_SCALE < 3) return;
    d.moved = true;
    const x = snapX(run, item, d.startX + delta, !e.shiftKey);
    if (x !== item.x) onMoveItem(item.id, { x });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    drag.current = null;
    draggingWall.current = false;
    if (vp.endPan(e)) onSelect(dataRef.current.activeWallId, null);
    else if (vp.svgRef.current?.hasPointerCapture(e.pointerId)) vp.svgRef.current.releasePointerCapture(e.pointerId);
  };

  return (
    <div ref={vp.wrapRef} className="relative h-full w-full overflow-hidden bg-[#f8fafc]">
      <svg
        ref={vp.svgRef}
        className="h-full w-full touch-none select-none"
        viewBox={vp.viewBox}
        onPointerDown={vp.startPan}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <GridBackground
          id="planGrid"
          cell={10 * PLAN_SCALE}
          originX={planOrigin(PLAN_SCALE)}
          originY={planOrigin(PLAN_SCALE)}
        />
        <PlanDrawing
          data={data}
          scale={PLAN_SCALE}
          selectedId={selectedId}
          interactive
          onItemPointerDown={onItemPointerDown}
          onRunPointerDown={onRunPointerDown}
          onCornerPointerDown={onCornerPointerDown}
          onPartitionTipPointerDown={onPartitionTipPointerDown}
          violations={violations}
        />
      </svg>
      <ZoomControls zoom={vp.zoom} onZoom={(f) => vp.zoomAt(f)} onFit={vp.fit} />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-500 shadow-sm">
        <span className="font-semibold text-slate-700">PLAN</span>
        {' · '}click a wall to make it active · drag walls, corners and items
        {' · '}
        {shiftHeld ? <span className="font-semibold text-amber-600">SNAP OFF</span> : 'Shift = freeform'}
      </div>
    </div>
  );
}
