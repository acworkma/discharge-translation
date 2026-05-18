# Bake-off v1 — Phase 4

This folder is the home for the discharge-translation bake-off artifacts.

| File | What it is | When it's produced |
|---|---|---|
| `parity-ts.json` | TS scorers' output over the 45-row dataset, identity-translation candidate. | `npx tsx scripts/run-parity-check.ts` |
| `parity-py.json` | Python evaluators' output over the same. | `python3 scripts/run-parity-check.py` |
| `portal-runs/<agent>.json` | Portal evaluation run results, one per candidate agent. | Manually exported from the portal after the bake-off (or via `evaluation_get` MCP). |
| `bakeoff-summary.json` | Composite leaderboard with offline `ctqs` per (agent, language). | `npx tsx scripts/compute-ctqs.ts` after `portal-runs/*` is populated. |

## Bake-off flow

The four prompt agents (`translator-gpt52`, `translator-mistral-large`,
`translator-llama`, `translator-deepseek`) score against the four
catalog-registered evaluators (`format-fidelity`, `meaning-fidelity`,
`safety-judge`, `critical-errors`) on the 45-row
`discharge-baseline-v1` dataset. CTQS is computed offline from the
per-row metrics.

### Catalog IDs (registered Phase 4 via `evaluator_catalog_create`)

| Evaluator | Catalog ID | Form | Metric | Direction |
|---|---|---|---|---|
| format-fidelity | `.../evaluators/format-fidelity/versions/1` | code | `format_fidelity` (0–100) | increase |
| critical-errors | `.../evaluators/critical-errors/versions/1` | code | `critical_errors_high` (0–10) | decrease |
| safety-judge | `.../evaluators/safety-judge/versions/1` | prompt | `safety_likert` (1–5) | increase |
| meaning-fidelity | `.../evaluators/meaning-fidelity/versions/1` | prompt | `meaning_fidelity` (1–5) | increase |

The two prompt-based evaluators run against the frozen judge model
`gpt-4.1-mini-601090`, never one of the candidate translation models.

### Running the bake-off (portal-driven)

For each candidate agent:

1. Foundry portal → `prj-discharge` → **Evaluations** → New evaluation.
2. Dataset: upload `.foundry/datasets/discharge-baseline-v1.jsonl` (or
   reuse the registered dataset if you've uploaded it through the
   portal already — naming convention `discharge-baseline` version `1`).
3. Target: pick the candidate agent (e.g. `translator-gpt52`).
4. Evaluators: select all four — `format-fidelity`, `meaning-fidelity`,
   `safety-judge`, `critical-errors`. Set judge deployment to
   `gpt-4.1-mini-601090`.
5. Run. Export the result JSON when it completes into
   `portal-runs/<agent>.json`.

Repeat for all four candidates. Expect ~15 minutes total wall time
across all agents (parallelizable in the portal).

### Computing the leaderboard

Once `portal-runs/*.json` is populated:

```bash
npx tsx scripts/compute-ctqs.ts
```

This produces `bakeoff-summary.json` with the per-(agent, language)
CTQS, soft penalties, and decision distribution. The composite mirrors
[`src/lib/scoring/ctqs.ts`](../../../src/lib/scoring/ctqs.ts) weights
(0.25 format + 0.45 meaning + 0.30 safety).

## Mirror invariant (Phase 4)

`scripts/compare-parity.ts` proves TS scorers ≡ Python evaluators
within ±0.1 across **all 45 dataset rows × 8 metrics = 360 cells**.
Re-run on every PR that touches scoring code.
