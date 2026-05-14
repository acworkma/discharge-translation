// Critical-error gate — rule subset (ask3 §6 / §13 Day-1 scope).
// Three rules: numeric_mismatch, dose_change, negation_drift.
//
// Operates on protected source/target markdown PLUS the unprotected raw
// markdown so we can sanity-check that protected placeholders survived.
// Dose / numeric checks here are intentionally redundant with placeholder
// protection: belt and suspenders.

import type { CriticalError } from '../storage';

const DOSE_RE =
  /\b(\d+(?:\.\d+)?)\s?(mg|mcg|μg|ug|ml|mL|l|L|g|kg|iu|IU|units?|tablets?|caps?|tab|drops?|sprays?|puffs?|%)\b/gi;
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
  const srcNums = (args.sourceMarkdown.match(NUMBER_RE) || []).map((n) => n).sort();
  const tgtNums = (args.targetMarkdown.match(NUMBER_RE) || []).map((n) => n).sort();
  const diff = symmetricMultisetDiff(srcNums, tgtNums);
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    errors.push({
      kind: 'numeric_mismatch',
      severity: diff.missing.length + diff.extra.length > 2 ? 'high' : 'medium',
      detail: `Numeric set drift: missing=[${diff.missing.slice(0, 5).join(', ')}] extra=[${diff.extra.slice(0, 5).join(', ')}]`
    });
  }

  // ----- dose_change -----
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
  unit: string;
}

function extractDoses(s: string): Dose[] {
  const out: Dose[] = [];
  for (const m of s.matchAll(DOSE_RE)) {
    out.push({ value: parseFloat(m[1]), unit: m[2].toLowerCase() });
  }
  return out.sort((a, b) => a.value - b.value || a.unit.localeCompare(b.unit));
}

function compareDoses(src: Dose[], tgt: Dose[]): string[] {
  const issues: string[] = [];
  // Match in sorted order; report value drifts > 0% and unit changes.
  const n = Math.min(src.length, tgt.length);
  for (let i = 0; i < n; i++) {
    if (src[i].unit !== tgt[i].unit) {
      issues.push(`Dose unit changed: ${src[i].value}${src[i].unit} → ${tgt[i].value}${tgt[i].unit}`);
    } else if (Math.abs(src[i].value - tgt[i].value) / Math.max(1, src[i].value) > 0.001) {
      issues.push(`Dose value changed: ${src[i].value}${src[i].unit} → ${tgt[i].value}${tgt[i].unit}`);
    }
  }
  if (src.length !== tgt.length) {
    issues.push(`Dose count drift: source=${src.length} target=${tgt.length}`);
  }
  return issues;
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
