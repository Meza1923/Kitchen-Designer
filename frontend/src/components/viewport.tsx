import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pan / zoom / auto-fit for an SVG drawing of `size` (px at 100%). Re-fits when `fitKey` changes
 * or the container resizes. Wheel zooms around the cursor; dragging the background pans.
 */
export function useViewport(size: { width: number; height: number }, fitKey: string) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: 1000, h: 700 });
  const [zoom, setZoom] = useState(1);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pan = useRef<{ startClient: { x: number; y: number }; startVb: ViewBox; moved: boolean } | null>(null);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = sizeRef.current;
    const cw = el.clientWidth || 1000;
    const ch = el.clientHeight || 700;
    const z = Math.min(cw / width, ch / height);
    const w = cw / z;
    const h = ch / z;
    setZoom(z);
    setVb({ x: (width - w) / 2, y: (height - h) / 2, w, h });
  }, []);

  useEffect(fit, [fit, fitKey]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse());
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const nz = Math.min(8, Math.max(0.2, zoom * factor));
    const f = zoom / nz;
    const p = clientX !== undefined ? toSvg(clientX, clientY!) : { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
    setVb({ x: p.x - (p.x - vb.x) * f, y: p.y - (p.y - vb.y) * f, w: vb.w * f, h: vb.h * f });
    setZoom(nz);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  const startPan = (e: ReactPointerEvent) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    pan.current = { startClient: { x: e.clientX, y: e.clientY }, startVb: vb, moved: false };
  };

  /** Returns true while a pan is in progress (the event was consumed). */
  const movePan = (e: ReactPointerEvent) => {
    const p = pan.current;
    if (!p) return false;
    const dx = e.clientX - p.startClient.x;
    const dy = e.clientY - p.startClient.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    setVb({ ...p.startVb, x: p.startVb.x - dx / zoom, y: p.startVb.y - dy / zoom });
    return true;
  };

  /** Ends a pan; returns true when it was a plain click on the background (no movement). */
  const endPan = (e: ReactPointerEvent) => {
    const p = pan.current;
    pan.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    return !!p && !p.moved;
  };

  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  return { svgRef, wrapRef, viewBox, zoom, fit, zoomAt, toSvg, startPan, movePan, endPan };
}

export function ZoomControls({ zoom, onZoom, onFit }: { zoom: number; onZoom: (factor: number) => void; onFit: () => void }) {
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded border border-slate-300 bg-white/95 p-1 shadow-sm">
      <button className="btn border-0 px-1.5" title="Zoom out" onClick={() => onZoom(1 / 1.2)}><Minus size={14} /></button>
      <span className="w-12 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
      <button className="btn border-0 px-1.5" title="Zoom in" onClick={() => onZoom(1.2)}><Plus size={14} /></button>
      <button className="btn border-0 px-1.5" title="Fit to screen" onClick={onFit}><Maximize size={14} /></button>
    </div>
  );
}

/** 10 cm / 50 cm drafting grid aligned to (originX, originY). */
export function GridBackground({ id, cell, originX, originY }: { id: string; cell: number; originX: number; originY: number }) {
  return (
    <>
      <defs>
        <pattern id={`${id}Minor`} width={cell} height={cell} patternUnits="userSpaceOnUse" x={originX} y={originY}>
          <path d={`M ${cell} 0 L 0 0 0 ${cell}`} fill="none" stroke="#e2e8f0" strokeWidth={0.6} />
        </pattern>
        <pattern id={`${id}Major`} width={cell * 5} height={cell * 5} patternUnits="userSpaceOnUse" x={originX} y={originY}>
          <rect width={cell * 5} height={cell * 5} fill={`url(#${id}Minor)`} />
          <path d={`M ${cell * 5} 0 L 0 0 0 ${cell * 5}`} fill="none" stroke="#cbd5e1" strokeWidth={0.9} />
        </pattern>
      </defs>
      <rect x={-20000} y={-20000} width={40000} height={40000} fill={`url(#${id}Major)`} />
    </>
  );
}

/** Tracks whether Shift is held (snapping bypass indicator). */
export function useShiftHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setHeld(e.shiftKey);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);
  return held;
}
