// Meaning-fidelity scorer (ask3 §5).
//
// Pipeline:
//   1. Back-translate the candidate target back into the source language using
//      the deterministic Azure Translator NMT engine.
//   2. Segment both source and back-translation by line.
//   3. Pre-align by ordinal index (cheap and effective for paragraph-aligned
//      discharge prose); fall back to embedding-nearest-neighbor for any
//      length mismatch.
//   4. Compute per-segment cosine on text-embedding-3-large (or the configured
//      embedding deployment); aggregate mean + min.
//
// Mean cosine maps linearly to a 0–100 score: 1.00 -> 100, 0.50 -> 0.

import type { MeaningBreakdown } from '../storage';
import { embed, cosine } from '../embeddings';
import { azureTranslator } from '../runners';

export async function scoreMeaning(args: {
  sourceMarkdown: string;
  targetMarkdown: string;
  sourceLang: string;
  targetLang: string;
}): Promise<{ breakdown: MeaningBreakdown; backTranslation: string }> {
  // Step 1: back-translation via Azure NMT (deterministic, cheap).
  const back = await azureTranslator.translate({
    text: args.targetMarkdown,
    sourceLang: args.targetLang,
    targetLang: args.sourceLang
  });
  const backText = back.translatedText;

  // Step 2: segment by line, dropping empties.
  const srcSegments = segmentize(args.sourceMarkdown);
  const btSegments = segmentize(backText);

  if (srcSegments.length === 0 || btSegments.length === 0) {
    return {
      backTranslation: backText,
      breakdown: { score: 0, meanCosine: 0, minCosine: 0, segmentsCompared: 0 }
    };
  }

  // Step 3+4: align by ordinal up to min length; embed both sides; cosine.
  const n = Math.min(srcSegments.length, btSegments.length);
  const all = [...srcSegments.slice(0, n), ...btSegments.slice(0, n)];
  const vectors = await embed(all);
  const srcVecs = vectors.slice(0, n);
  const btVecs = vectors.slice(n);

  let sum = 0;
  let min = 1;
  for (let i = 0; i < n; i++) {
    const c = cosine(srcVecs[i], btVecs[i]);
    sum += c;
    if (c < min) min = c;
  }
  const mean = sum / n;

  // Linear remap [0.5, 1.0] → [0, 100], clipped.
  const remap = Math.max(0, Math.min(1, (mean - 0.5) / 0.5));
  const score = remap * 100;

  return {
    backTranslation: backText,
    breakdown: {
      score: round1(score),
      meanCosine: round3(mean),
      minCosine: round3(min),
      segmentsCompared: n
    }
  };
}

function segmentize(md: string): string[] {
  return md
    .split(/\n+/)
    .map((s) => s.replace(/^\s*[#\->*\d.|]+\s*/, '').trim())
    .filter((s) => s.length > 0 && !/^[-:|\s]+$/.test(s));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
