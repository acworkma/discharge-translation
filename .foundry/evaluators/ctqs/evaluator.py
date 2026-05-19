"""CTQs aggregator — mirrors src/lib/scoring/ctqs.ts.

Composite "critical to quality" score combining format, meaning, safety
into a single 0-100 number, then applying decision thresholds:
  - critical_gate_failed → reject (hard)
  - >= 90               → auto_publish
  - >= 80               → human_review
  - else                → reject

Soft penalties are deducted per critical error before threshold checks:
  high = 15, medium = 7, low = 3.
"""

from __future__ import annotations
from typing import Iterable


_WEIGHTS = {"format": 0.25, "meaning": 0.45, "safety": 0.30}
_SOFT_PENALTY = {"high": 15, "medium": 7, "low": 3}


class CTQsEvaluator:
    """Pure aggregator. Inputs come from upstream evaluator outputs in the
    evaluation suite; nothing networked here."""

    def __call__(
        self,
        *,
        format_fidelity: float,
        meaning_fidelity: float,
        safety_score: float,
        critical_errors: Iterable[dict] | None = None,
        critical_gate_failed: bool = False,
        **_,
    ) -> dict:
        errors = list(critical_errors or [])
        soft = sum(_SOFT_PENALTY.get(e.get("severity", "low"), 0) for e in errors)
        raw = (
            _WEIGHTS["format"] * float(format_fidelity)
            + _WEIGHTS["meaning"] * float(meaning_fidelity)
            + _WEIGHTS["safety"] * float(safety_score)
        )
        ctqs = max(0.0, raw - soft)

        if critical_gate_failed:
            decision = "reject"
            reason = "Critical gate failed (high-severity error)."
        elif ctqs >= 90:
            decision = "auto_publish"
            reason = "Above auto-publish threshold."
        elif ctqs >= 80:
            decision = "human_review"
            reason = "Below auto-publish, above review threshold."
        else:
            decision = "reject"
            reason = "Below review threshold."

        return {
            "ctqs": round(ctqs * 10) / 10,
            "overall": round(ctqs) / 100,
            "soft_penalty": soft,
            "decision": decision,
            "decision_reason": reason,
        }
