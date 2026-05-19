"""Parity contract test: enforces that the Python format-fidelity evaluator
produces the same metric values as the TypeScript scorer in
src/lib/scoring/format-fidelity.ts for a battery of fixed inputs.

This is the *mirror invariant* — if it ever fails, either the TS or the
Python side has drifted and one must be brought back in line.

Usage:
    pytest .foundry/evaluators/format_fidelity/test_parity.py

Requires `npx tsx` on PATH (Node + tsx; already a devDependency of the
parent Next.js project).
"""

from __future__ import annotations
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
from evaluator import FormatFidelityEvaluator  # type: ignore  # noqa: E402

_REPO_ROOT = _HERE.parent.parent.parent
_SHIM = _HERE / "ts_shim.ts"


def _has_npx() -> bool:
    return shutil.which("npx") is not None


def _ts_score(source: str, target: str) -> dict:
    proc = subprocess.run(
        ["npx", "--yes", "tsx", str(_SHIM)],
        input=json.dumps({"sourceMarkdown": source, "targetMarkdown": target}),
        text=True,
        capture_output=True,
        cwd=_REPO_ROOT,
        timeout=120,
        check=True,
    )
    return json.loads(proc.stdout)


_FIXTURES = [
    (
        "identical",
        "# Heading\n\nPara\n\n- a\n- b\n\n1. one\n2. two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
        "# Heading\n\nPara\n\n- a\n- b\n\n1. one\n2. two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    ),
    (
        "translation_typical",
        "# Discharge Summary\n\nTake [[PH1]] 500 mg twice daily.\n\n- Follow up in 7 days\n- Call if fever\n",
        "# Resumen de Alta\n\nTome [[PH1]] 500 mg dos veces al día.\n\n- Seguimiento en 7 días\n- Llame si hay fiebre\n",
    ),
    (
        "missing_table",
        "# H\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
        "# H\n\nNo table here.\n",
    ),
    (
        "orphan_placeholder",
        "Take [[PH1]] daily.\n",
        "Tome [[PH1]] y [[PH2]] diario.\n",
    ),
    ("empty_both", "", ""),
]

# camelCase TS key -> snake_case Python key
_KEY_MAP = {
    "score": "format_fidelity",
    "headingOrder": "heading_order",
    "headingCount": "heading_count",
    "bulletCount": "bullet_count",
    "numberedCount": "numbered_count",
    "tableCount": "table_count",
    "tableShape": "table_shape",
    "paragraphCount": "paragraph_count",
    "placeholders": "placeholders",
}


@pytest.mark.skipif(not _has_npx(), reason="npx not available")
@pytest.mark.parametrize("name,src,tgt", _FIXTURES, ids=[f[0] for f in _FIXTURES])
def test_python_matches_typescript(name: str, src: str, tgt: str):
    py = FormatFidelityEvaluator()(source_markdown=src, target_markdown=tgt)
    ts = _ts_score(src, tgt)
    for ts_key, py_key in _KEY_MAP.items():
        assert py_key in py, f"Python missing key {py_key}"
        assert ts_key in ts, f"TS missing key {ts_key}"
        # both sides round to 1dp — compare with tight tolerance
        assert abs(py[py_key] - ts[ts_key]) < 0.05, (
            f"[{name}] {py_key}: python={py[py_key]} vs ts={ts[ts_key]}"
        )
