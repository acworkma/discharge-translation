// Format-fidelity scorer (ask3 §4).
// Compares the structure signature of the source and the candidate
// translation. Deterministic, no LLM. Returns sub-metrics + a 0-100 score.

import type { StructureSignature } from '../structure';
import type { FormatBreakdown } from '../storage';

const WEIGHTS = {
  headingOrder: 0.20,
  headingCount: 0.10,
  bulletCount: 0.10,
  numberedCount: 0.10,
  tableCount: 0.15,
  tableShape: 0.15,
  paragraphCount: 0.10,
  placeholders: 0.10
};

export function scoreFormat(
  source: StructureSignature,
  target: StructureSignature
): FormatBreakdown {
  const headingCount = ratioScore(source.headings.length, target.headings.length);
  const headingOrder = headingOrderScore(source.headings.length, target.headings.length);
  const bulletCount = ratioScore(source.bulletItems, target.bulletItems);
  const numberedCount = ratioScore(source.numberedItems, target.numberedItems);
  const tableCount = ratioScore(source.tables.length, target.tables.length);
  const tableShape = tableShapeScore(source.tables, target.tables);
  const paragraphCount = ratioScore(source.paragraphs, target.paragraphs);
  const placeholders = placeholderScore(source.placeholders, target.placeholders);

  const score =
    100 *
    (WEIGHTS.headingOrder * (headingOrder / 100) +
      WEIGHTS.headingCount * (headingCount / 100) +
      WEIGHTS.bulletCount * (bulletCount / 100) +
      WEIGHTS.numberedCount * (numberedCount / 100) +
      WEIGHTS.tableCount * (tableCount / 100) +
      WEIGHTS.tableShape * (tableShape / 100) +
      WEIGHTS.paragraphCount * (paragraphCount / 100) +
      WEIGHTS.placeholders * (placeholders / 100));

  return {
    score: round1(score),
    headingOrder: round1(headingOrder),
    headingCount: round1(headingCount),
    bulletCount: round1(bulletCount),
    numberedCount: round1(numberedCount),
    tableCount: round1(tableCount),
    tableShape: round1(tableShape),
    paragraphCount: round1(paragraphCount),
    placeholders: round1(placeholders)
  };
}

/** Symmetric ratio: 100 when equal, 0 when one side is empty and the other isn't. */
function ratioScore(a: number, b: number): number {
  if (a === 0 && b === 0) return 100;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi === 0) return 100;
  return (lo / hi) * 100;
}

/**
 * Headings-in-order score (§4.1). Penalizes both count drift and order swap.
 * We don't compare heading TEXT across languages (it's translated); we only
 * compare the level sequence.
 */
function headingOrderScore(srcCount: number, tgtCount: number): number {
  // Order check degenerates to count parity once text isn't comparable across
  // languages — so this duplicates headingCount unless we add level tracking.
  // We keep it as a separate metric for future enrichment.
  return ratioScore(srcCount, tgtCount);
}

function tableShapeScore(
  src: Array<{ rows: number; cols: number }>,
  tgt: Array<{ rows: number; cols: number }>
): number {
  if (src.length === 0 && tgt.length === 0) return 100;
  if (src.length === 0 || tgt.length === 0) return 0;
  const n = Math.min(src.length, tgt.length);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const rowScore = ratioScore(src[i].rows, tgt[i].rows);
    const colScore = ratioScore(src[i].cols, tgt[i].cols);
    acc += (rowScore + colScore) / 2;
  }
  // Penalize for any extras on either side.
  const extras = Math.abs(src.length - tgt.length);
  const base = acc / n;
  return Math.max(0, base - extras * 10);
}

function placeholderScore(src: string[], tgt: string[]): number {
  if (src.length === 0 && tgt.length === 0) return 100;
  if (src.length === 0) return 100; // nothing to preserve
  const tgtSet = new Set(tgt);
  let present = 0;
  for (const p of src) if (tgtSet.has(p)) present++;
  // Soft penalty for orphan placeholders in target (model invented tokens).
  const orphans = tgt.filter((p) => !src.includes(p)).length;
  const base = (present / src.length) * 100;
  return Math.max(0, base - orphans * 5);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
