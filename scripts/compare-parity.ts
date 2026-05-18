// Compares parity-ts.json vs parity-py.json — Phase 4 mirror invariant.
// Exits non-zero if any numeric metric drifts by more than 0.1.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../.foundry/results/bakeoff-v1");
const ts = JSON.parse(readFileSync(resolve(DIR, "parity-ts.json"), "utf8"));
const py = JSON.parse(readFileSync(resolve(DIR, "parity-py.json"), "utf8"));

const tsByCase = new Map<string, any>(ts.rows.map((r: any) => [r.case_id, r]));
const pyByCase = new Map<string, any>(py.rows.map((r: any) => [r.case_id, r]));

const METRICS = [
  "format_fidelity",
  "heading_order",
  "table_shape",
  "placeholders",
  "critical_errors_count",
  "critical_errors_high",
  "critical_errors_medium",
  "critical_errors_low"
];
const TOLERANCE = 0.1;
let failures = 0;
let checked = 0;
const drifts: string[] = [];

for (const [caseId, tsRow] of tsByCase) {
  const pyRow = pyByCase.get(caseId);
  if (!pyRow || tsRow.skipped || pyRow.skipped) continue;
  for (const m of METRICS) {
    const a = tsRow[m];
    const b = pyRow[m];
    if (typeof a !== "number" || typeof b !== "number") continue;
    checked++;
    if (Math.abs(a - b) > TOLERANCE) {
      failures++;
      drifts.push(`  ${caseId} ${m}: ts=${a} py=${b} Δ=${(a - b).toFixed(2)}`);
    }
  }
}

console.log(`Compared ${checked} metric cells across ${tsByCase.size} cases.`);
if (failures) {
  console.error(`MIRROR INVARIANT FAILED: ${failures} drift(s) over ${TOLERANCE}:`);
  drifts.slice(0, 25).forEach((d) => console.error(d));
  if (drifts.length > 25) console.error(`  ... and ${drifts.length - 25} more`);
  process.exit(1);
}
console.log(`PASS: TS ↔ Python parity holds within ±${TOLERANCE} for all ${tsByCase.size} dataset rows.`);
