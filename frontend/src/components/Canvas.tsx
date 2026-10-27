import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { KitchenItem, WallRun } from '../types';
import { canMoveVertically, clampY, round1, snapX } from '../lib/geometry';
import { Drawing, drawingSize, PAD } from './Drawing';
import { GridBackground, useShiftHeld, useViewport, ZoomControls } from './viewport';

export const SCALE = 2; // px per cm at 100% zoom

interface ItemDrag {
  id: string;
  start: DOMPoint;
  startX: number;
  startY: number;
  moved: boolean;
}

interface Props {
  wall: WallRun;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveItem: (id: string, pos: { x: number; y: number }) => void;
}

/** Interactive front elevation of one wall run. */
export function Canvas({ wall, selectedId, onSelect, onMoveItem }: Props) {
  const vp = useViewport(drawingSize(wall, SCALE), `${wall.id}:${wall.widthCm}:${wall.heightCm}`);
  const shiftHeld = useShiftHeld();
  const drag = useRef<ItemDrag | null>(null);
  const wallRef = useRef(wall);
  wallRef.current = wall;

  const onItemPointerDown = (e: ReactPointerEvent, item: KitchenItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(item.id);
    vp.svgRef.current!.setPointerCapture(e.pointerId);
    drag.current = { id: item.id, start: vp.toSvg(e.clientX, e.clientY), startX: item.x, startY: item.y, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (vp.movePan(e)) return;
    const d = drag.current;
    if (!d) return;
    const p = vp.toSvg(e.clientX, e.clientY);
    const dxPx = p.x - d.start.x;
    const dyPx = p.y - d.start.y;
    if (!d.moved && Math.hypot(dxPx, dyPx) < 3) return;
    d.moved = true;
    const w = wallRef.current;
    const item = w.items.find((i) => i.id === d.id);
    if (!item) return;
    const x = snapX(w, item, d.startX + dxPx / SCALE, !e.shiftKey);
    const y = canMoveVertically(item.category) ? round1(clampY(w, item, Math.round(d.startY - dyPx / SCALE))) : item.y;
    if (x !== item.x || y !== item.y) onMoveItem(item.id, { x, y });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    drag.current = null;
    if (vp.endPan(e)) onSelect(null);
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
        <GridBackground id="elevGrid" cell={10 * SCALE} originX={PAD.left} originY={PAD.top} />
        <Drawing wall={wall} scale={SCALE} selectedId={selectedId} interactive onItemPointerDown={onItemPointerDown} />
      </svg>
      <ZoomControls zoom={vp.zoom} onZoom={(f) => vp.zoomAt(f)} onFit={vp.fit} />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-500 shadow-sm">
        <span className="font-semibold text-slate-700">ELEVATION · {wall.name}</span>
        {' · '}
        {shiftHeld ? (
          <span className="font-semibold text-amber-600">SNAP OFF · freeform 1 cm</span>
        ) : (
          'snap 3 cm · Shift = freeform'
        )}
      </div>
    </div>
  );
}
