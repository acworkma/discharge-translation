# .foundry/evaluators/

Custom evaluator sources for the discharge-translation demo. Each subfolder is
one Foundry custom evaluator, mirroring a scorer in `src/lib/scoring/`.

| Evaluator | Mirrors | Kind | Judge model |
|---|---|---|---|
| `format-fidelity/` | `src/lib/scoring/format-fidelity.ts` + `src/lib/structure.ts` | code (Python) | — (deterministic) |
| `meaning-fidelity/` | `src/lib/scoring/meaning-fidelity.ts` | code + LLM | `gpt-4.1-mini-601090` + `text-embedding-3-large-015418` |
| `safety-judge/` | `src/lib/scoring/safety-judge.ts` | prompt | `gpt-4.1-mini-601090` |
| `critical-errors/` | `src/lib/scoring/critical-errors.ts` | code | — (deterministic) |
| `ctqs/` | `src/lib/scoring/ctqs.ts` + `src/lib/scoring/index.ts` | code | — (aggregator) |

## Parity contract

Each evaluator includes a `test.py` and a fixture pair `fixtures/sample-in.json`
+ `fixtures/sample-out.json`. The TypeScript scorer must produce the same
fixture output for the same input (within tolerance), enforced by a contract
test under `tests/foundry-evaluator-parity.test.ts`.

This is the **mirror invariant** that lets us roll back at runtime: TypeScript
scorers stay authoritative; Foundry evaluators are the eval-time mirror.

## Status (Phase 3)

All five evaluators are implemented under `<name>/evaluator.py` with a
matching `<name>/spec.yaml` declaring metric definitions and data schema.
A shared `_common/structure.py` ports the markdown structure scanner.

The parity test for `format_fidelity` (`test_parity.py`) runs five fixed
fixtures through both the Python evaluator and the TypeScript scorer (via
`npx tsx ts_shim.ts`) and asserts the metrics match within 0.05 — this is
the live mirror invariant for the deterministic format scorer.

```bash
pytest .foundry/evaluators/format_fidelity/test_parity.py -v
```

The remaining evaluators are either networked (`meaning_fidelity`,
`safety_judge`) or pure aggregators (`ctqs`) — parity contracts for those
would require either live Azure calls or are not value-additive, so they
are deliberately skipped. `critical_errors` is fully deterministic and a
future parity test there is a low-risk add.

Live registration of these evaluators into the prj-discharge evaluator
catalog (via `evaluator_catalog_create`) is deferred to Phase 4 — at that
point we bundle each folder as a blob, register, and update
`agent-metadata.yaml` evaluators[] with `catalog_id` alongside `path`.
