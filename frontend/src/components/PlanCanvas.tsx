import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { snapX } from '../lib/geometry';
import { planPointToWallX, snapTo, wallFrame } from '../lib/plan';
import { planOrigin, PlanDrawing, planSize } from './PlanDrawing';
import { GridBackground, useShiftHeld, useViewport, ZoomControls } from './viewport';

export const PLAN_SCALE = 2; // px per cm at 100% zoom
const ISLAND_GRID_CM = 5;

type Drag =
  | { kind: 'item'; runId: string; itemId: string; startX: number; startProj: number; moved: boolean }
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
}

/** Interactive top-down floor plan. Items slide along their wall; islands move freely. */
export function PlanCanvas({ data, selectedId, onSelect, onActivate, onMoveItem, onMoveIsland }: Props) {
  const vp = useViewport(planSize(data, PLAN_SCALE), `${data.room.widthCm}:${data.room.depthCm}`);
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

  const onPointerMove = (e: ReactPointerEvent) => {
    if (vp.movePan(e)) return;
    const d = drag.current;
    if (!d) return;
    const pt = toCm(e);
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
        />
      </svg>
      <ZoomControls zoom={vp.zoom} onZoom={(f) => vp.zoomAt(f)} onFit={vp.fit} />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-500 shadow-sm">
        <span className="font-semibold text-slate-700">PLAN</span>
        {' · '}click a wall to make it active · drag items along their wall
        {' · '}
        {shiftHeld ? <span className="font-semibold text-amber-600">SNAP OFF</span> : 'Shift = freeform'}
      </div>
    </div>
  );
}
