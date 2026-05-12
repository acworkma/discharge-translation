import type { ScoreSet } from './storage';

// Stub scorer. Replace with real clinical-fidelity scoring later
// (e.g., COMET, BLEURT, terminology dictionary checks, format diff).
export function scoreStub(_source: string, _translation: string): ScoreSet {
  const r = (min = 0.7, max = 0.99) => Math.round((min + Math.random() * (max - min)) * 100) / 100;
  const s = {
    clinicalFidelity: r(),
    terminologyConsistency: r(),
    formattingPreservation: r(),
    readability: r(0.6, 0.95)
  };
  const overall = Math.round(((s.clinicalFidelity + s.terminologyConsistency + s.formattingPreservation + s.readability) / 4) * 100) / 100;
  return { ...s, overall };
}
