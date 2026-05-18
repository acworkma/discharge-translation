// Critical-error gate — rule subset (ask3 §6 / §13 Day-1 scope).
// Three rules: numeric_mismatch, dose_change, negation_drift.
//
// Operates on protected source/target markdown PLUS the unprotected raw
// markdown so we can sanity-check that protected placeholders survived.
// Dose / numeric checks here are intentionally redundant with placeholder
// protection: belt and suspenders.

import type { CriticalError } from '../storage';

// Translated dose-unit synonyms (day-1 target languages). Each entry maps a
// surface form to a canonical English unit so target-language doses can be
// matched against the source. Keep flat — performance is not interesting.
//
// Sources: drug-label conventions in es/vi/zh-Hans/ar/tl. Coverage is
// pragmatic: enough to neutralize false positives on common discharge med
// tables. The LLM-judge SafetyScore catches the long tail.
const UNIT_SYNONYMS: Array<[RegExp, string]> = [
  // English (canonical) — accept both singular/plural and case-insensitive.
  [/^mg$/i, 'mg'],
  [/^(mcg|μg|ug)$/i, 'mcg'],
  [/^(ml|mL)$/i, 'ml'],
  [/^(l|L|lt|lts|liters?|litres?|litros?)$/i, 'l'],
  [/^(g|gramos?|grams?)$/i, 'g'],
  [/^kg$/i, 'kg'],
  [/^(iu|IU|unidad(?:es)?|units?|đơn vị|单位|وحدات?|yunit)$/i, 'unit'],
  [/^(tablets?|tabs?|comprimidos?|tabletas?|viên|片|قرص|أقراص|tableta)$/i, 'tablet'],
  [/^(caps?|cápsulas?|capsulas?|capsules?|viên nang|胶囊|كبسولات?|kapsula)$/i, 'capsule'],
  [/^(drops?|gotas?|giọt|滴|قطرات?|patak)$/i, 'drop'],
  [/^(sprays?|aerosol(?:es)?|pulverizaciones?|xịt|喷|بخة|بخات|spray)$/i, 'spray'],
  [/^(puffs?|caladas?|inhalaciones?|nhát xịt|nhát hít|喷雾|بختة|hithit)$/i, 'puff'],
  [/^%$/, '%']
];

// All unit surface forms collapsed into one alternation. Built once.
const UNIT_PATTERN = (() => {
  // Extract literal alternatives from each RegExp source (strip ^$ and group wrappers).
  const alts: string[] = [];
  for (const [re] of UNIT_SYNONYMS) {
    let src = re.source.replace(/^\^/, '').replace(/\$$/, '');
    // Strip a single outer non-capturing or capturing group if present.
    if (src.startsWith('(') && src.endsWith(')')) src = src.slice(1, -1);
    alts.push(src);
  }
  // Join + assemble. Note: `puffs?|caladas?|...` style sub-alternations remain intact.
  return alts.join('|');
})();

// Dose regex over the union of unit synonyms. Number form accepts `.` or `,`
// as the decimal separator so non-English locales survive.
const DOSE_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])(\d+(?:[.,]\d+)?)\s*(` + UNIT_PATTERN + `)(?![A-Za-z0-9])`,
  'giu'
);
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;

interface NegationVocab {
  source: string[];
  target: string[];
}

// Minimal negation vocab for the five day-1 languages + English source.
// Coverage is intentionally small; the LLM-judge SafetyScore catches the long
// tail. Add to config later (see /memories/session/plan.md, further considerations §1).
const NEGATION: Record<string, NegationVocab> = {
  en: {
    source: ['not', 'no', 'never', 'cannot', "can't", "don't", 'avoid', 'without', 'stop', 'discontinue'],
    target: []
  },
  es: {
    source: [],
    target: ['no', 'nunca', 'jamás', 'sin', 'evite', 'evitar', 'deje', 'suspender', 'tampoco']
  },
  vi: {
    source: [],
    target: ['không', 'chưa', 'tránh', 'ngừng', 'đừng', 'chớ']
  },
  'zh-Hans': {
    source: [],
    target: ['不', '没', '没有', '别', '请勿', '禁止', '停止', '避免']
  },
  ar: {
    source: [],
    target: ['لا', 'ليس', 'ممنوع', 'تجنب', 'توقف', 'بدون', 'دون']
  },
  tl: {
    source: [],
    target: ['hindi', 'huwag', 'wala', 'iwasan', 'itigil', 'tigilan', 'walang']
  }
};

export function detectCriticalErrors(args: {
  sourceMarkdown: string;
  targetMarkdown: string;
  /** Back-translation of the target into the source language; used only for
   * negation drift (target-language negation tokens are hard to match
   * positionally). */
  backTranslationMarkdown?: string;
  sourceLang: string;
  targetLang: string;
}): CriticalError[] {
  const errors: CriticalError[] = [];

  // ----- numeric_mismatch -----
  // Normalize the target's decimal separator (comma → dot) so non-English
  // locales (es/vi/ar/tl all use `,` as decimal sep) don't fragment `38,3`
  // into two tokens. Source stays as-is — it's English by contract.
  const tgtForNumbers = normalizeDecimalCommas(args.targetMarkdown);
  const srcNums = (args.sourceMarkdown.match(NUMBER_RE) || []).map((n) => n).sort();
  const tgtNums = (tgtForNumbers.match(NUMBER_RE) || []).map((n) => n).sort();
  const diff = symmetricMultisetDiff(srcNums, tgtNums);
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    errors.push({
      kind: 'numeric_mismatch',
      severity: diff.missing.length + diff.extra.length > 2 ? 'high' : 'medium',
      detail: `Numeric set drift: missing=[${diff.missing.slice(0, 5).join(', ')}] extra=[${diff.extra.slice(0, 5).join(', ')}]`
    });
  }

  // ----- dose_change -----
  // Match doses as a multiset of (value, canonical-unit) rather than by
  // sorted positional pairing. Positional pairing cascaded N+1 spurious
  // findings when a single dose dropped (e.g. `2 puffs` not matched because
  // the target rendered it as `2 caladas` — now handled via UNIT_SYNONYMS).
  const srcDoses = extractDoses(args.sourceMarkdown);
  const tgtDoses = extractDoses(args.targetMarkdown);
  const doseIssues = compareDoses(srcDoses, tgtDoses);
  for (const issue of doseIssues) {
    errors.push({ kind: 'dose_change', severity: 'high', detail: issue });
  }

  // ----- negation_drift -----
  // Compare negation density on source vs target. If source has negations and
  // back-translation drops them all (or vice versa), flag drift.
  const srcLang = (args.sourceLang || 'en').split('-')[0];
  const srcVocab = NEGATION[srcLang]?.source || NEGATION.en.source;
  const srcNegCount = countTokens(args.sourceMarkdown, srcVocab);

  const tgtKey = matchLangKey(args.targetLang);
  const tgtVocab = NEGATION[tgtKey]?.target || [];
  const tgtNegCount = tgtVocab.length ? countTokens(args.targetMarkdown, tgtVocab) : -1;

  const btNegCount = args.backTranslationMarkdown
    ? countTokens(args.backTranslationMarkdown, srcVocab)
    : -1;

  // Source has negations but back-translation has zero: model probably dropped a negation.
  if (srcNegCount > 0 && btNegCount === 0 && args.backTranslationMarkdown) {
    errors.push({
      kind: 'negation_drift',
      severity: 'high',
      detail: `Source has ${srcNegCount} negation tokens but back-translation has 0 — possible negation drop.`
    });
  }
  // Target has zero target-language negation tokens despite source having them.
  if (srcNegCount > 0 && tgtNegCount === 0) {
    errors.push({
      kind: 'negation_drift',
      severity: 'medium',
      detail: `Source has ${srcNegCount} negation tokens but target language detected 0 (${tgtKey}).`
    });
  }

  return errors;
}

interface Dose {
  value: number;
  /** Canonical unit (mg, mcg, ml, l, g, kg, unit, tablet, capsule, drop, spray, puff, %). */
  unit: string;
}

function canonicalUnit(raw: string): string {
  for (const [re, canon] of UNIT_SYNONYMS) {
    if (re.test(raw)) return canon;
  }
  return raw.toLowerCase();
}

function extractDoses(s: string): Dose[] {
  const out: Dose[] = [];
  // Normalize decimal commas so values parse uniformly. Apply only at the
  // captured number, not globally, to avoid touching unrelated commas.
  for (const m of s.matchAll(DOSE_RE)) {
    const numStr = m[1].replace(',', '.');
    out.push({ value: parseFloat(numStr), unit: canonicalUnit(m[2]) });
  }
  return out;
}

/** Compare doses as a multiset of (value, canonical-unit). Doses present in
 * source AND target with identical value+unit cancel out; the remainders are
 * the real drift. This avoids the positional-pairing cascade where one
 * dropped dose produced N+1 spurious findings. */
function compareDoses(src: Dose[], tgt: Dose[]): string[] {
  const key = (d: Dose) => `${d.value}|${d.unit}`;
  const srcMap = new Map<string, number>();
  const tgtMap = new Map<string, number>();
  for (const d of src) srcMap.set(key(d), (srcMap.get(key(d)) || 0) + 1);
  for (const d of tgt) tgtMap.set(key(d), (tgtMap.get(key(d)) || 0) + 1);

  const missing: Dose[] = [];
  const extra: Dose[] = [];
  for (const d of src) {
    const k = key(d);
    if ((srcMap.get(k) || 0) > (tgtMap.get(k) || 0)) {
      missing.push(d);
      srcMap.set(k, (srcMap.get(k) || 0) - 1);
    }
  }
  for (const d of tgt) {
    const k = key(d);
    if ((tgtMap.get(k) || 0) > (srcMap.get(k) || 0)) {
      extra.push(d);
      tgtMap.set(k, (tgtMap.get(k) || 0) - 1);
    }
  }

  const issues: string[] = [];
  // Pair missing↔extra greedily by closest value within the same unit so we
  // can report unit-vs-value drift distinctly. Anything left over is reported
  // as a drop or addition.
  for (const m of missing.slice()) {
    const idx = extra.findIndex((e) => e.unit === m.unit);
    if (idx >= 0) {
      const e = extra.splice(idx, 1)[0];
      issues.push(`Dose value changed: ${m.value}${m.unit} → ${e.value}${e.unit}`);
      missing.splice(missing.indexOf(m), 1);
    }
  }
  for (const m of missing.slice()) {
    if (extra.length > 0) {
      const e = extra.shift()!;
      issues.push(`Dose unit changed: ${m.value}${m.unit} → ${e.value}${e.unit}`);
      missing.splice(missing.indexOf(m), 1);
    }
  }
  for (const m of missing) issues.push(`Dose dropped: ${m.value}${m.unit}`);
  for (const e of extra) issues.push(`Dose added: ${e.value}${e.unit}`);
  return issues;
}

function normalizeDecimalCommas(s: string): string {
  // Replace `<digit>,<digit>` with `<digit>.<digit>` so locale-formatted
  // decimals (es/vi/ar/tl) tokenize as a single number. Avoids touching
  // thousands separators (`1,000`) by requiring exactly one digit on the
  // right OR by only converting when followed by 1–3 digits NOT followed by
  // another digit — to be safe, just rewrite `,\d{1,3}(?!\d)` to `.…`.
  return s.replace(/(\d),(\d{1,3})(?!\d)/g, '$1.$2');
}

function symmetricMultisetDiff(a: string[], b: string[]) {
  const aMap = new Map<string, number>();
  const bMap = new Map<string, number>();
  for (const x of a) aMap.set(x, (aMap.get(x) || 0) + 1);
  for (const x of b) bMap.set(x, (bMap.get(x) || 0) + 1);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [k, v] of aMap) {
    const d = v - (bMap.get(k) || 0);
    for (let i = 0; i < d; i++) missing.push(k);
  }
  for (const [k, v] of bMap) {
    const d = v - (aMap.get(k) || 0);
    for (let i = 0; i < d; i++) extra.push(k);
  }
  return { missing, extra };
}

function countTokens(s: string, vocab: string[]): number {
  if (vocab.length === 0) return 0;
  const lower = ' ' + s.toLowerCase() + ' ';
  let c = 0;
  for (const w of vocab) {
    // word boundary fallback: surround with spaces. CJK won't have word
    // boundaries; just count substring occurrences.
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isAscii = /^[\x00-\x7f]+$/.test(w);
    const re = isAscii ? new RegExp(`\\b${escaped}\\b`, 'gi') : new RegExp(escaped, 'g');
    c += (lower.match(re) || []).length;
  }
  return c;
}

function matchLangKey(lang: string): string {
  const l = lang.toLowerCase();
  if (l.startsWith('zh')) return 'zh-Hans';
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('vi')) return 'vi';
  if (l.startsWith('ar')) return 'ar';
  if (l.startsWith('tl') || l.startsWith('fil')) return 'tl';
  return l;
}
