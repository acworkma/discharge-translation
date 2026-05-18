// Builds .foundry/datasets/discharge-baseline-v1.jsonl from the checked-in
// samples plus hand-authored regression fixtures.
//
// Each row matches the Foundry evaluation_dataset_batch_eval_create schema
// (query_response data kind): { query, response, ...metadata }. We leave
// `response` empty here — the portal-side bake-off fills it by invoking the
// candidate agent. Local parity harness (scripts/run-parity-check.ts) fills
// `response` by invoking the canonical TypeScript pipeline.
//
// Run: `npx tsx scripts/build-baseline-dataset.ts`

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(REPO_ROOT, ".foundry/datasets/discharge-baseline-v1.jsonl");

type DatasetRow = {
  case_id: string;
  query: string;
  response: string;
  source_lang: string;
  target_lang: string;
  document_type: string;
  patient_region: string;
  fixture_kind: string;
  notes: string;
};

const SAMPLES = {
  clean: readFileSync(resolve(REPO_ROOT, "samples/discharge-clean.md"), "utf8"),
  headingSwap: readFileSync(resolve(REPO_ROOT, "samples/discharge-heading-swap.md"), "utf8"),
  missingTable: readFileSync(resolve(REPO_ROOT, "samples/discharge-missing-table.md"), "utf8")
};

const TARGETS: Array<{ lang: string; region: string }> = [
  { lang: "es-419", region: "Mexico" },
  { lang: "zh-Hans", region: "Mainland-China" },
  { lang: "ar-001", region: "Saudi-Arabia" },
  { lang: "vi-VN", region: "Vietnam" },
  { lang: "fil-PH", region: "Philippines" }
];

const rows: DatasetRow[] = [];

// 1. Three sample fixtures × five target languages = 15 rows.
for (const { lang, region } of TARGETS) {
  rows.push({
    case_id: `clean-${lang}`,
    query: SAMPLES.clean,
    response: "",
    source_lang: "en",
    target_lang: lang,
    document_type: "discharge_summary",
    patient_region: region,
    fixture_kind: "sample-clean",
    notes: "Happy path; baseline."
  });
  rows.push({
    case_id: `heading-swap-${lang}`,
    query: SAMPLES.headingSwap,
    response: "",
    source_lang: "en",
    target_lang: lang,
    document_type: "discharge_summary",
    patient_region: region,
    fixture_kind: "sample-heading-swap",
    notes: "Stresses format-fidelity heading order."
  });
  rows.push({
    case_id: `missing-table-${lang}`,
    query: SAMPLES.missingTable,
    response: "",
    source_lang: "en",
    target_lang: lang,
    document_type: "discharge_summary",
    patient_region: region,
    fixture_kind: "sample-missing-table",
    notes: "Stresses format-fidelity table_count/table_shape + numeric multiset."
  });
}

// 2. Hand-authored regression fixtures designed to exercise each
//    deterministic evaluator rule end-to-end. Kept small (1-3 paragraphs)
//    so they're cheap to translate during the bake-off but expensive to
//    get right.

const REGRESSIONS: Array<{ id: string; query: string; fixture_kind: string; notes: string }> = [
  {
    id: "dose-mg-mcg",
    fixture_kind: "regression-dose-unit-swap",
    notes: "Critical-errors dose_change must fire if mg/mcg get confused.",
    query:
      "# Medication Update\n\n" +
      "Take **levothyroxine 50 mcg** by mouth every morning on an empty stomach.\n\n" +
      "Continue **amlodipine 5 mg** by mouth once daily.\n\n" +
      "Do not combine these two pills in the same hand — the dose units are very different.\n"
  },
  {
    id: "negation-do-not",
    fixture_kind: "regression-negation-drop",
    notes: "Critical-errors negation_drift must fire if the negations vanish.",
    query:
      "# Important Safety Instructions\n\n" +
      "- **Do not** drive while taking this medication.\n" +
      "- **Do not** drink alcohol for the next 48 hours.\n" +
      "- **Never** stop the antibiotic course early, even if you feel better.\n" +
      "- Avoid contact sports until your follow-up appointment.\n"
  },
  {
    id: "decimal-comma",
    fixture_kind: "regression-locale-decimal",
    notes: "Guards against false-positive numeric_mismatch from locale formatting (1.5 mg ↔ 1,5 mg).",
    query:
      "# Pediatric Dosing\n\n" +
      "Acetaminophen suspension **1.5 mL** every 6 hours as needed for fever.\n\n" +
      "Vitamin D drops **0.5 mL** once daily.\n"
  },
  {
    id: "placeholder-orphan",
    fixture_kind: "regression-placeholder-gating",
    notes: "Format-fidelity placeholders score must penalize hallucinated [[PHn]] tokens.",
    query:
      "# Discharge Snapshot\n\n" +
      "Patient: [[PH1]]\nMRN: [[PH2]]\nDischarge date: [[PH3]]\n\n" +
      "Follow up with your primary care provider within 7 days.\n"
  },
  {
    id: "tiny-table",
    fixture_kind: "regression-table-shape",
    notes: "Format-fidelity table_shape must penalize row/column drift.",
    query:
      "# Vital Signs at Discharge\n\n" +
      "| Metric | Value |\n| --- | --- |\n| Blood pressure | 128/82 |\n| Heart rate | 76 bpm |\n| Temperature | 98.4 °F |\n| Oxygen saturation | 97% on room air |\n"
  },
  {
    id: "icd-codes-preserved",
    fixture_kind: "regression-do-not-translate",
    notes: "ICD-10 codes, MRN, and dates must survive translation untouched.",
    query:
      "# Diagnoses\n\n" +
      "- Type 2 diabetes mellitus (ICD-10: E11.9)\n" +
      "- Chronic kidney disease, stage 3a (ICD-10: N18.31)\n" +
      "- Essential hypertension (ICD-10: I10)\n\n" +
      "MRN: 100-200-300. Reviewed on 2026-04-12.\n"
  }
];

for (const { lang, region } of TARGETS) {
  for (const r of REGRESSIONS) {
    rows.push({
      case_id: `${r.id}-${lang}`,
      query: r.query,
      response: "",
      source_lang: "en",
      target_lang: lang,
      document_type: "discharge_excerpt",
      patient_region: region,
      fixture_kind: r.fixture_kind,
      notes: r.notes
    });
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(OUT_PATH, lines, "utf8");

const byLang = rows.reduce<Record<string, number>>((acc, r) => {
  acc[r.target_lang] = (acc[r.target_lang] ?? 0) + 1;
  return acc;
}, {});

console.log(`Wrote ${rows.length} rows to ${OUT_PATH}`);
console.log("By target language:", byLang);
console.log("By fixture_kind:", rows.reduce<Record<string, number>>((acc, r) => {
  acc[r.fixture_kind] = (acc[r.fixture_kind] ?? 0) + 1;
  return acc;
}, {}));
