import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize } from 'lucide-react';
import type { ProjectData } from '../types';
import { buildKitchen, disposeTree, type WallMeta } from '../lib/scene3d';

interface Props {
  data: ProjectData;
  selectedId: string | null;
  /** Called with the clicked item, or null when clicking anything else. */
  onPick: (runId: string | null, itemId: string | null) => void;
}

/** Orbit-only shaded 3D view of the whole kitchen. */
export default function Scene3D({ data, selectedId, onPick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    model: THREE.Group | null;
    resetView: () => void;
  } | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const dataRef = useRef(data);
  dataRef.current = data;
  const roomKey = `${data.room.widthCm}:${data.room.depthCm}:${data.room.heightCm}`;

  // One-time renderer / camera / controls setup.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d3d1, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    const camera = new THREE.PerspectiveCamera(45, 1, 5, 20000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // never below the floor
    controls.minDistance = 60;
    controls.maxDistance = 3000;

    const resetView = () => {
      const { widthCm: W, depthCm: D, heightCm: H } = dataRef.current.room;
      controls.target.set(W / 2, 90, D / 2);
      camera.position.set(W * 0.85, H * 1.25, D * 1.9);
      controls.update();
      const s = Math.max(W, D);
      sun.position.set(W * 0.2, H * 3, D * 1.2);
      sun.target.position.set(W / 2, 0, D / 2);
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: H * 8 });
      sun.shadow.camera.updateProjectionMatrix();
    };

    const resize = () => {
      const w = wrap.clientWidth || 800;
      const h = wrap.clientHeight || 600;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // Hide walls that stand between the camera and the room (dollhouse view).
    const toCam = new THREE.Vector3();
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      ctx.current?.model?.children.forEach((child) => {
        const meta = child.userData.wall as WallMeta | undefined;
        if (meta) child.visible = toCam.copy(camera.position).sub(meta.point).dot(meta.normal) > 0;
      });
      renderer.render(scene, camera);
    };
    loop();

    // Click (without dragging) picks an item.
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const model = ctx.current?.model;
      const hit = model ? raycaster.intersectObjects(model.children, true).find((h) => h.object.visible && isVisible(h.object)) : undefined;
      const ud = hit?.object.userData ?? {};
      onPickRef.current(ud.runId ?? null, ud.itemId ?? null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    ctx.current = { renderer, scene, camera, controls, model: null, resetView };
    resetView();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      if (ctx.current?.model) disposeTree(ctx.current.model);
      renderer.dispose();
      wrap.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  // Rebuild the model whenever the data or selection changes.
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.model) {
      c.scene.remove(c.model);
      disposeTree(c.model);
    }
    c.model = buildKitchen(data, selectedId);
    c.scene.add(c.model);
  }, [data, selectedId]);

  // Re-frame the camera when the room size changes.
  useEffect(() => ctx.current?.resetView(), [roomKey]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={wrapRef} className="h-full w-full" data-testid="scene3d" />
      <button className="btn absolute bottom-3 right-3 bg-white/95 shadow-sm" title="Reset view" onClick={() => ctx.current?.resetView()}>
        <Maximize size={14} /> Reset view
      </button>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-500 shadow-sm">
        <span className="font-semibold text-slate-700">3D</span> · drag to orbit · right-drag to pan · scroll to zoom · click a cabinet to change its fronts
      </div>
    </div>
  );
}

const isVisible = (o: THREE.Object3D): boolean => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};
