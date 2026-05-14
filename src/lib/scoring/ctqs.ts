// Composite Translation Quality Score aggregator (ask3 §7).
// Fixed thresholds (Day-1 pre-calibration, ask3 §13.1): 90 → auto_publish,
// 80 → human_review, else → reject. A high-severity critical-error gate is
// hard-overrides to reject regardless of subscores.

import type {
  CriticalError,
  CtqsDecision,
  FormatBreakdown,
  MeaningBreakdown,
  SafetyBreakdown,
  ScoreSet
} from '../storage';

// Weights chosen to roughly match ask3 §7 emphasis on meaning over format,
// with safety/critical adding compounding penalties.
const WEIGHTS = { format: 0.25, meaning: 0.45, safety: 0.30 };

export function aggregate(args: {
  format: FormatBreakdown;
  meaning: MeaningBreakdown;
  safety: SafetyBreakdown;
  criticalErrors: CriticalError[];
}): ScoreSet {
  const criticalGateFailed = args.criticalErrors.some((e) => e.severity === 'high');

  const base =
    WEIGHTS.format * args.format.score +
    WEIGHTS.meaning * args.meaning.score +
    WEIGHTS.safety * args.safety.score;

  // Soft penalty per critical error (capped). Hard gate handled in decision.
  const softPenalty = args.criticalErrors.reduce((acc, e) => {
    return acc + (e.severity === 'high' ? 15 : e.severity === 'medium' ? 7 : 3);
  }, 0);

  const ctqs = Math.max(0, Math.min(100, base - softPenalty));
  let decision: CtqsDecision;
  if (criticalGateFailed) decision = 'reject';
  else if (ctqs >= 90) decision = 'auto_publish';
  else if (ctqs >= 80) decision = 'human_review';
  else decision = 'reject';

  const rounded = Math.round(ctqs * 10) / 10;
  return {
    ctqs: rounded,
    decision,
    format: args.format,
    meaning: args.meaning,
    safety: args.safety,
    criticalErrors: args.criticalErrors,
    criticalGateFailed,
    overall: rounded / 100
  };
}
