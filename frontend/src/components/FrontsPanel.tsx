import { MousePointerClick } from 'lucide-react';
import type { KitchenItem } from '../types';
import { CATEGORY_LABELS, defaultOpenShelves, equalSplit } from '../lib/defaults';
import { fmt } from '../lib/geometry';
import { Chips } from './Inspector';

/** The 3D view's only editor: switch a cabinet between doors and drawers, and set the drawer count. */
export function FrontsPanel({
  item,
  onChange,
}: {
  item: KitchenItem | null;
  onChange: (patch: Partial<KitchenItem>) => void;
}) {
  if (!item) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-slate-400">
        <MousePointerClick size={22} />
        Click a base or wall cabinet in the 3D view to switch it between doors and drawers.
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
        {CATEGORY_LABELS[item.category]}
      </div>
      <div className="mb-3 font-mono text-xs text-slate-400">
        {item.label ? `${item.label} · ` : ''}
        {fmt(item.width)} × {fmt(item.height)} cm at X {fmt(item.x)}
      </div>
      <span className="label">Fronts</span>
      <Chips
        options={['doors', 'drawers', 'open'] as KitchenItem['frontType'][]}
        value={item.frontType}
        onChange={(frontType) =>
          onChange(
            frontType === 'open' && item.shelfCount === undefined
              ? { frontType, shelfCount: defaultOpenShelves(item.category) }
              : { frontType },
          )
        }
        render={(v) => ({ doors: 'Doors', drawers: 'Drawers', open: 'Open' })[v]}
      />
      {item.frontType === 'drawers' && (
        <div className="mt-3">
          <span className="label">Number of drawers</span>
          <Chips
            options={[1, 2, 3, 4, 5]}
            value={item.drawerCount}
            onChange={(n) => onChange({ drawerCount: n, drawerSplitPcts: equalSplit(n) })}
          />
        </div>
      )}
      {item.frontType !== 'drawers' && (
        <div className="mt-3">
          <span className="label">Shelves inside</span>
          <Chips
            options={[0, 1, 2, 3, 4, 5]}
            value={item.shelfCount ?? 0}
            onChange={(n) => onChange({ shelfCount: n || undefined })}
          />
        </div>
      )}
      <p className="mt-4 text-[11px] text-slate-400">Other properties are edited in the Plan or Elevation view.</p>
    </div>
  );
}
