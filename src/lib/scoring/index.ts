// Scoring harness orchestrator (ask3 §13 Day-1 MVP).
//
// Inputs: the source's structured markdown + signature, the candidate
// translation's markdown, and language pair. Runs the four scorers in
// parallel (format-fidelity is sync; meaning/safety are async; critical-error
// gate is sync once back-translation lands) and aggregates via CTQS.

import { signatureOf, type StructureSignature } from '../structure';
import { scoreFormat } from './format-fidelity';
import { scoreMeaning } from './meaning-fidelity';
import { scoreSafety } from './safety-judge';
import { detectCriticalErrors } from './critical-errors';
import { aggregate } from './ctqs';
import type { ScoreSet } from '../storage';

export async function runScoring(args: {
  sourceMarkdown: string;
  sourceSignature: StructureSignature;
  targetMarkdown: string;
  sourceLang: string;
  targetLang: string;
}): Promise<ScoreSet> {
  const targetSignature = signatureOf(args.targetMarkdown);
  const format = scoreFormat(args.sourceSignature, targetSignature);

  // Run meaning + safety in parallel. Safety doesn't need back-translation;
  // meaning produces it as a side effect.
  const [meaningResult, safety] = await Promise.all([
    scoreMeaning({
      sourceMarkdown: args.sourceMarkdown,
      targetMarkdown: args.targetMarkdown,
      sourceLang: args.sourceLang,
      targetLang: args.targetLang
    }).catch((err) => ({
      backTranslation: '',
      breakdown: {
        score: 0,
        meanCosine: 0,
        minCosine: 0,
        segmentsCompared: 0
      },
      error: err instanceof Error ? err.message : String(err)
    })),
    scoreSafety({
      sourceMarkdown: args.sourceMarkdown,
      targetMarkdown: args.targetMarkdown,
      sourceLang: args.sourceLang,
      targetLang: args.targetLang
    }).catch((err) => ({
      score: 60,
      raw: 3,
      rationale: `Safety scorer failed: ${err instanceof Error ? err.message : String(err)}`
    }))
  ]);

  const criticalErrors = detectCriticalErrors({
    sourceMarkdown: args.sourceMarkdown,
    targetMarkdown: args.targetMarkdown,
    backTranslationMarkdown: meaningResult.backTranslation || undefined,
    sourceLang: args.sourceLang,
    targetLang: args.targetLang
  });

  return aggregate({
    format,
    meaning: meaningResult.breakdown,
    safety,
    criticalErrors
  });
}
