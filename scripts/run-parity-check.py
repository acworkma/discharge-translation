"""Python counterpart of scripts/run-parity-check.ts. Same dataset, same
candidate-resolution logic, writes parity-py.json next to parity-ts.json.
Then a separate diff step asserts they agree within 0.1.
"""

from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / ".foundry/datasets/discharge-baseline-v1.jsonl"
OUT_DIR = ROOT / ".foundry/results/bakeoff-v1"
OUT_PATH = OUT_DIR / "parity-py.json"

sys.path.insert(0, str(ROOT / ".foundry/evaluators/_common"))

import importlib.util  # noqa: E402


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore
    return mod


_fmt_mod = _load(ROOT / ".foundry/evaluators/format_fidelity/evaluator.py", "format_fidelity_evaluator")
_crit_mod = _load(ROOT / ".foundry/evaluators/critical_errors/evaluator.py", "critical_errors_evaluator")
FormatFidelityEvaluator = _fmt_mod.FormatFidelityEvaluator
CriticalErrorsEvaluator = _crit_mod.CriticalErrorsEvaluator


def _arg(name: str, default: str) -> str:
    for a in sys.argv[1:]:
        if a.startswith(f"--{name}="):
            return a.split("=", 1)[1]
    return default


def main() -> None:
    candidate_mode = _arg("candidate", "identity")
    rows = [json.loads(l) for l in DATASET.read_text(encoding="utf8").splitlines() if l.strip()]

    candidate_map: dict[str, str] | None = None
    if candidate_mode != "identity":
        candidate_map = {}
        path = ROOT / candidate_mode
        for line in path.read_text(encoding="utf8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            candidate_map[r["case_id"]] = r["response"]

    fmt = FormatFidelityEvaluator()
    crit = CriticalErrorsEvaluator()

    out: list[dict] = []
    for row in rows:
        candidate = (
            candidate_map.get(row["case_id"], "")
            if candidate_map is not None
            else (row["query"] if candidate_mode == "identity" else "")
        )
        if not candidate:
            out.append({"case_id": row["case_id"], "skipped": True, "reason": "no candidate"})
            continue
        f = fmt(source_markdown=row["query"], target_markdown=candidate)
        c = crit(
            source_markdown=row["query"],
            target_markdown=candidate,
            source_lang=row["source_lang"],
            target_lang=row["target_lang"],
        )
        out.append({
            "case_id": row["case_id"],
            "fixture_kind": row["fixture_kind"],
            "target_lang": row["target_lang"],
            "format_fidelity": f["format_fidelity"],
            "heading_order": f["heading_order"],
            "table_shape": f["table_shape"],
            "placeholders": f["placeholders"],
            "critical_errors_count": c["critical_errors_count"],
            "critical_errors_high": c["critical_errors_high"],
            "critical_errors_medium": c["critical_errors_medium"],
            "critical_errors_low": c["critical_errors_low"],
            "critical_gate_failed": c["critical_gate_failed"],
            "details": c["details"],
        })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "candidate_mode": candidate_mode,
        "dataset": "discharge-baseline-v1",
        "rows": out,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"Wrote {len(out)} rows to {OUT_PATH}")


if __name__ == "__main__":
    main()
