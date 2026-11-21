import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, FRIDGE_TYPE_LABELS, TALL_ZONE_LABELS } from './defaults';
import { HE } from './i18n.he';
import { setLang, t } from './i18n';

// Every source file (tests and the dictionary itself excluded), as text.
const SOURCES = import.meta.glob(
  ['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/i18n*', '!../generated/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

/** Every English text the interface can show: t('…') literals (both sides of a ternary inside t()), labels and
 * titles the shared components translate, rule badges, and the lookup tables shown through t(). */
function englishTexts(): Set<string> {
  const out = new Set<string>();
  const lit = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  for (const [f, src] of Object.entries(SOURCES)) {
    // t(…) calls, up to the first comma at depth 0 or the closing parenthesis: take every string literal in there.
    for (const m of src.matchAll(/\bt(?:r)?\(/g)) {
      let i = m.index! + m[0].length;
      let depth = 0;
      let arg = '';
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === "'" || c === '"') {
          const end = src.indexOf(c, i + 1);
          let j = i + 1;
          while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
          arg += src.slice(i, j + 1);
          i = j;
          void end;
          continue;
        }
        if (c === '(' || c === '{' || c === '[') depth++;
        if (c === ')' || c === '}' || c === ']') {
          if (depth === 0) break;
          depth--;
        }
        if (c === ',' && depth === 0) break;
        arg += c;
      }
      for (const s of arg.matchAll(lit)) out.add((s[1] ?? s[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
    }
    if (/components\/(Inspector|WallBar|ProblemsList)\.tsx$/.test(f))
      for (const s of src.matchAll(/(?:label|title)="([^"]+)"/g)) out.add(s[1]);
    if (/rules\//.test(f)) for (const s of src.matchAll(/'([A-Z][A-Z0-9 -]{2,})'/g)) out.add(s[1]); // badges
    if (/components\/(Palette|ItemShape|PlanDrawing)\.tsx$/.test(f))
      for (const s of src.matchAll(/(?:title|label): '([^']+)'/g)) out.add(s[1]);
    if (/components\/ItemShape\.tsx$/.test(f))
      for (const s of src.matchAll(/^\s+([A-Z][A-Z ]+)$/gm)) out.add(s[1].trim());
  }
  for (const table of [CATEGORY_LABELS, TALL_ZONE_LABELS, FRIDGE_TYPE_LABELS])
    Object.values(table).forEach((v) => out.add(v));
  return out;
}

describe('Hebrew / English (#8)', () => {
  it('has a Hebrew text for everything the interface shows', () => {
    // Code values that end up inside t(…) arguments (ternary conditions, lookups), not text.
    const code = new Set(['start', 'end', 'in', 'out', 'side_by_side', 'visible']);
    const texts = englishTexts();
    expect(texts.size).toBeGreaterThan(300); // the scan found the source files
    const missing = [...texts].filter((s) => /[A-Za-z]{2,}/.test(s) && !code.has(s) && !(s in HE)).sort();
    expect(missing).toEqual([]);
  });

  it('fills placeholders and falls back to English', () => {
    setLang('he');
    expect(t('Wall {letter}', { letter: 'A' })).toBe('קיר A');
    expect(t('Not in the dictionary {x}', { x: 1 })).toBe('Not in the dictionary 1');
    setLang('en');
    expect(t('Wall {letter}', { letter: 'A' })).toBe('Wall A');
  });

  it('keeps every placeholder of the English text in the Hebrew one', () => {
    const bad = Object.entries(HE).filter(([en, he]) => {
      const names = (s: string) =>
        [...s.matchAll(/\{(\w+)\}/g)]
          .map((m) => m[1])
          .sort()
          .join();
      return names(en) !== names(he);
    });
    expect(bad).toEqual([]);
  });
});
