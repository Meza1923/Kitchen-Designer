import { AlertTriangle, Info, OctagonAlert, Wrench } from 'lucide-react';
import type { Violation } from '../lib/rules';

const STYLE = {
  error: { icon: OctagonAlert, text: 'text-red-700', box: 'border-red-200 bg-red-50' },
  warning: { icon: AlertTriangle, text: 'text-amber-700', box: 'border-amber-200 bg-amber-50' },
  info: { icon: Info, text: 'text-slate-600', box: 'border-slate-200 bg-slate-50' },
};

/** Rule violations as a list; clicking one selects its first element. */
export function ProblemsList({
  violations,
  onSelect,
  onFix,
  onFixAll,
  title = 'Problems',
}: {
  violations: Violation[];
  onSelect?: (runId: string, itemId: string) => void;
  /** Apply one problem's fix; the fix button is shown only when given. */
  onFix?: (v: Violation) => void;
  /** Apply every available fix; shown when given and at least one problem has a fix. */
  onFixAll?: () => void;
  title?: string;
}) {
  if (!violations.length) return null;
  const counts = (['error', 'warning', 'info'] as const)
    .map((s) => [s, violations.filter((v) => v.severity === s).length] as const)
    .filter(([, n]) => n > 0);
  return (
    <div className="mb-3">
      <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">
        {title}
        {counts.map(([s, n]) => (
          <span key={s} className={`rounded px-1.5 py-px text-[10px] ${STYLE[s].box} ${STYLE[s].text}`}>
            {n}
          </span>
        ))}
      </h3>
      {onFixAll && violations.some((v) => v.fix) && (
        <button type="button" className="btn mb-1.5 w-full justify-center text-xs" onClick={onFixAll}>
          <Wrench size={13} /> Add all needed fillers
        </button>
      )}
      <div className="space-y-1">
        {violations.map((v, i) => {
          const { icon: Icon, text, box } = STYLE[v.severity];
          const target = v.items[0];
          return (
            <div key={i} className={`rounded border text-xs ${box} ${text}`}>
              <button
                type="button"
                disabled={!target || !onSelect}
                onClick={() => target && onSelect?.(target.runId, target.itemId)}
                className="flex w-full gap-1.5 p-1.5 text-left enabled:hover:brightness-95"
              >
                <Icon size={13} className="mt-px shrink-0" />
                <span>{v.message}</span>
              </button>
              {v.fix && onFix && (
                <button
                  type="button"
                  onClick={() => onFix(v)}
                  className="mb-1.5 ml-6 flex items-center gap-1 rounded border border-current bg-white px-1.5 py-0.5 font-semibold hover:bg-slate-50"
                >
                  <Wrench size={11} /> {v.fix.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
