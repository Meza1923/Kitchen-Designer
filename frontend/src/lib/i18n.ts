/**
 * Hebrew / English (FEATURES.md #8). Every piece of interface text goes through `t('English text', vars)`: the English
 * is the key, Hebrew comes from lib/i18n.he.ts, and anything missing falls back to English. `{name}` placeholders are
 * filled from `vars`. The language is remembered per browser; Hebrew switches the page to right-to-left (drawings stay
 * left-to-right, see `LTR`).
 */
import { useSyncExternalStore } from 'react';
import { HE } from './i18n.he';

export type Lang = 'en' | 'he';
const KEY = 'kitchen-designer:lang';

function load(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    // Storage blocked: fall through to the browser's language.
  }
  try {
    // First visit: follow the browser's language (review finding R17).
    return navigator.language?.toLowerCase().startsWith('he') ? 'he' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = typeof window === 'undefined' ? 'en' : load();
const listeners = new Set<() => void>();

function applyToDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'he' ? 'rtl' : 'ltr';
}
applyToDocument();

export const getLang = () => current;

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
  applyToDocument();
  listeners.forEach((l) => l());
}

/** The current language; re-renders the component when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => 'en' as Lang,
  );
}

/** Translate `text` (its English form) into the current language and fill in its `{placeholders}`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const s = current === 'he' ? (HE[text] ?? text) : text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Spread on drawing containers so they keep a left-to-right layout in Hebrew. */
export const LTR = { dir: 'ltr' } as const;

/** A run's name for display: default names ("Wall A", "Island 2", "Partition 1 · B") in the current language. */
export function runName(name: string): string {
  let m = /^Wall ([A-Z]+)$/.exec(name);
  if (m) return t('Wall {letter}', { letter: m[1] });
  m = /^Island( \d+)?(?: · (B|Front|Back|Left end|Right end))?$/.exec(name);
  if (m) return t('Island') + (m[1] ?? '') + (m[2] ? ` · ${t(m[2])}` : '');
  m = /^Partition (\d+)( · [AB])?$/.exec(name);
  if (m) return t('Partition {n}', { n: m[1] }) + (m[2] ?? '');
  return name;
}

/** A compass direction label ("North", "East 2") in the current language. */
export const directionName = (label: string) => label.replace(/^(North|East|South|West)/, (m) => t(m));
