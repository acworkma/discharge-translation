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
