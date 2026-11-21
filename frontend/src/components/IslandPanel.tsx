import type { ReactNode } from 'react';
import { Armchair, RotateCw } from 'lucide-react';
import type { EndProfile, IslandFace, ProjectData, Rotation, WallRun } from '../types';
import { fmt } from '../lib/geometry';
import { runName, t } from '../lib/i18n';
import { LAYOUTS, SIDE_NAMES, type IslandLayout } from '../lib/island';
import { islandClearances, islandOverhangs, isIslandSide } from '../lib/plan';
import { Chips, NumField } from './Inspector';

const PROFILES: Record<EndProfile, string> = { none: 'None', panel: 'Plain end panel', waterfall: 'Waterfall' };
const FACES: IslandFace[] = ['a', 'b', 'left', 'right'];

const Step = ({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) => (
  <section className="border-b border-slate-200 px-4 py-3">
    <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">
        {n}
      </span>
      {t(title)}
    </h3>
    <p className="mb-2 mt-1 text-[11px] leading-snug text-slate-500">{t(hint)}</p>
    <div className="space-y-2">{children}</div>
  </section>
);

interface Props {
  data: ProjectData;
  island: WallRun;
  /** The side being worked on (where the catalog adds, shown in the elevation). */
  face: IslandFace;
  onFace: (face: IslandFace) => void;
  onUpdateIsland: (patch: Partial<WallRun>) => void;
  onLayout: (layout: IslandLayout) => void;
  onAddChair: (type: 'bar' | 'counter') => void;
}

/**
 * The island panel (FEATURES.md #15): the steps to design an island, in order, each with a short hint —
 * countertop, cabinets (which side), seating, ends — plus a layout to start from and the aisle distances.
 */
export function IslandPanel({ data, island, face, onFace, onUpdateIsland, onLayout, onAddChair }: Props) {
  const sides = data.walls.filter((w) => w.hostId === island.id && isIslandSide(w));
  const empty = [island, ...sides].every((r) => !r.items.length);
  const overhangs = islandOverhangs(data, island);
  const here = overhangs.find((o) => o.face === face)?.cantilever ?? 0;
  const aisles = islandClearances(data, island);
  return (
    <div data-island-panel>
      <div className="border-b border-slate-200 bg-blue-50 px-4 py-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700">{runName(island.name)}</div>
        <p className="mt-1 text-[11px] leading-snug text-slate-600">
          {t('An island is a countertop with cabinets under it and, where it sticks out, room for chairs.')}
        </p>
      </div>

      {empty && (
        <section className="border-b border-slate-200 px-4 py-3">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">
            {t('Start from a layout')}
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className="rounded border border-slate-300 px-2 py-1.5 text-start hover:border-blue-400 hover:bg-blue-50"
                onClick={() => onLayout(l.id)}
                title={t(l.hint)}
              >
                <span className="block text-xs font-semibold text-slate-800">{t(l.label)}</span>
                <span className="block text-[10px] leading-tight text-slate-500">{t(l.hint)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <Step
        n={1}
        title="Countertop"
        hint="The island's size. Cabinets go under it; what has nothing under it is the overhang."
      >
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-slate-600">
            {t('Length')}
            <NumField value={island.widthCm} min={30} max={1000} onChange={(widthCm) => onUpdateIsland({ widthCm })} />
          </label>
          <label className="flex-1 text-xs text-slate-600">
            {t('Depth')}
            <NumField
              value={island.depthCm ?? 90}
              min={20}
              max={300}
              onChange={(depthCm) => onUpdateIsland({ depthCm })}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => onUpdateIsland({ rotationDeg: (((island.rotationDeg ?? 0) + 90) % 360) as Rotation })}
        >
          <RotateCw size={14} /> {t('Turn 90°')} ({island.rotationDeg ?? 0}°)
        </button>
      </Step>

      <Step
        n={2}
        title="Cabinets"
        hint="Pick the side, then click a cabinet in the catalog on the left: it goes under the countertop, against that side. The arrow in the plan marks the front."
      >
        <Chips options={FACES} value={face} onChange={onFace} render={(f) => SIDE_NAMES[f]} />
      </Step>

      <Step
        n={3}
        title="Seating"
        hint="Chairs go on the side being worked on, at the edge of the countertop, 60 cm apart. They need 25–30 cm of countertop over their knees."
      >
        <p data-knee-room className={`text-xs ${here >= 25 ? 'text-emerald-700' : 'text-amber-700'}`}>
          {t('Countertop past the cabinets on this side: {cm} cm', { cm: fmt(here) })}
        </p>
        <div className="flex gap-1.5">
          <button type="button" className="btn flex-1 justify-center" onClick={() => onAddChair('bar')}>
            <Armchair size={14} /> {t('Bar stool')}
          </button>
          <button type="button" className="btn flex-1 justify-center" onClick={() => onAddChair('counter')}>
            <Armchair size={14} /> {t('Counter stool')}
          </button>
        </div>
      </Step>

      <Step
        n={4}
        title="Ends"
        hint="How the two short ends look. A waterfall (the countertop turning down to the floor) also holds up an overhang over 30 cm."
      >
        {(['left', 'right'] as const).map((end) => {
          const key = end === 'left' ? 'leftProfile' : 'rightProfile';
          return (
            <label key={end} className="block text-xs text-slate-600">
              {t(SIDE_NAMES[end])}
              <Chips
                options={Object.keys(PROFILES) as EndProfile[]}
                value={island[key] ?? 'none'}
                onChange={(p) => onUpdateIsland({ [key]: p === 'none' ? undefined : p })}
                render={(p) => PROFILES[p]}
              />
            </label>
          );
        })}
      </Step>

      <section className="border-b border-slate-200 px-4 py-3">
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">{t('Aisles')}</h3>
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          {t('Distance from each side of the island to what faces it. Aim for 105–120 cm; under 90 cm is too tight.')}
        </p>
        <ul className="space-y-0.5 font-mono text-xs" data-aisles>
          {aisles.map((a) => (
            <li
              key={a.face}
              className={a.distance < 90 ? 'text-red-600' : a.distance < 105 ? 'text-amber-600' : 'text-slate-600'}
            >
              {t(SIDE_NAMES[a.face])}: {fmt(a.distance)} {t('cm')}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
