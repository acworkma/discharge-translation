# Translation Validation Harness — Engineering Design

**Customer:** US hospital (HLS STU)
**Engagement:** Hack on Keyboard, on-site
**Author context:** Adam Workman, Microsoft Principal Solutions Engineer
**Companion docs:** `ask1-architecture-plan.md` (platform), `ask2-discharge-translation-plan.md` (workflow + CTQS sketch in §5)
**Audience:** Adam + the customer's engineering team. This is a build spec, not a research summary.
**Date:** 2026-05-09
**Status:** Build-ready. Open decisions called out in §15.

---

## 1. Purpose and Scope

### 1.1 What this harness does

The translation validation harness ("the harness") takes a **source document** (English) and a **translated document** (target language) produced by *any* upstream translation pipeline, and emits:

1. A **composite confidence score** (0–100) — the Clinical Translation Quality Score (CTQS), per ask2 §5.1.
2. **Per-dimension subscores** for format fidelity, semantic fidelity (COMET), clinical-entity preservation, back-translation similarity, and a calibrated LLM-judge SafetyScore.
3. **Per-segment scores** so downstream tooling can highlight which paragraph, table cell, or list item is unreliable.
4. A **critical-error list** (MQM-aligned), e.g., medication-name change, dose-unit drift, instruction inversion.
5. A **route decision**: `auto-publish` / `human-review` / `reject`.
6. An **audit record ID** referencing an immutable record in Cosmos DB + Blob (HIPAA-eligible retention).

### 1.2 What this harness does NOT do

- It does **not** translate. The translation engine (NMT, LLM, or hybrid — see ask2) is a *peer* component, not a child.
- It does **not** replace a qualified human translator. Section 1557 still applies; the harness *routes* to a human, it does not certify in lieu of one ([HHS OCR §1557 Final Rule](https://www.federalregister.gov/documents/2024/05/06/2024-08711/nondiscrimination-in-health-programs-and-activities)).
- It does **not** decide auto-publish thresholds unilaterally. Thresholds are a clinical-policy decision (see §15).
- It is **not** an A/B test of translation engines. It is a single-document validator. Engine comparison is layered on top by re-running the harness with two engine outputs.

### 1.3 Engine-agnostic posture

The harness MUST work whether the upstream engine is Azure AI Document Translation + Custom Translator, GPT-5.1 finalization, Mistral Large 3, or a hybrid pipeline. The contract is: *give me two documents in the same logical format, tell me the language pair, and I will score them.* This decoupling is load-bearing — the parallel ask2 update may shift engine choice; this design must absorb that change with zero refactor.

---

## 2. Inputs and Outputs

### 2.1 Inputs

| Field | Type | Required | Notes |
|---|---|---|---|
| `source_doc` | DOCX / PDF / HTML / Markdown / XLIFF | Yes | English. Submitted as a Blob URL with SAS, or inline base64 for documents <4 MB. |
| `target_doc` | Same format as source where possible | Yes | Translated output. |
| `language_pair` | `{source: "en", target: "es-MX"}` | Yes | BCP-47 with optional region subtag. |
| `document_type` | enum | Yes | `discharge_instructions` (default), `medication_list`, `after_visit_summary`, `consent_form`. Drives weighting. |
| `glossary_version` | string | No | Pin to a Custom Translator glossary version for reproducibility. |
| `patient_region` | string | No | Used to select region-aware terminology overrides (e.g., Mexican vs Caribbean Spanish). |
| `engine_metadata` | object | No | Free-form: engine name, model versions, prompt hash. Echoed into the audit record. |

### 2.2 Outputs — JSON schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ValidationResult",
  "type": "object",
  "required": ["validation_id", "ctqs", "decision", "subscores",
               "segments", "critical_errors", "audit_ref"],
  "properties": {
    "validation_id": { "type": "string", "format": "uuid" },
    "validated_at": { "type": "string", "format": "date-time" },
    "language_pair": {
      "type": "object",
      "properties": {
        "source": { "type": "string" },
        "target": { "type": "string" }
      }
    },
    "document_type": { "type": "string" },
    "ctqs": {
      "type": "number", "minimum": 0, "maximum": 100,
      "description": "Composite Clinical Translation Quality Score, 0-100."
    },
    "decision": {
      "type": "string",
      "enum": ["auto_publish", "human_review", "reject"]
    },
    "decision_rationale": { "type": "string" },
    "subscores": {
      "type": "object",
      "required": ["safety", "comet", "entity_f1", "back_trans_sim", "format_fidelity"],
      "properties": {
        "safety":          { "type": "number", "minimum": 0, "maximum": 1 },
        "comet":           { "type": "number", "minimum": 0, "maximum": 1 },
        "entity_f1":       { "type": "number", "minimum": 0, "maximum": 1 },
        "back_trans_sim":  { "type": "number", "minimum": 0, "maximum": 1 },
        "format_fidelity": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "segments": {
      "type": "array",
      "items": { "$ref": "#/definitions/SegmentScore" }
    },
    "critical_errors": {
      "type": "array",
      "items": { "$ref": "#/definitions/CriticalError" }
    },
    "format_diagnostics": {
      "type": "object",
      "properties": {
        "headings_delta":   { "type": "integer" },
        "tables_delta":     { "type": "integer" },
        "lists_delta":      { "type": "integer" },
        "page_count_delta": { "type": "integer" }
      }
    },
    "audit_ref": {
      "type": "object",
      "properties": {
        "cosmos_id": { "type": "string" },
        "source_blob_url": { "type": "string" },
        "target_blob_url": { "type": "string" },
        "retention_until": { "type": "string", "format": "date" }
      }
    },
    "engine_metadata": { "type": "object" },
    "harness_version": { "type": "string" }
  },
  "definitions": {
    "SegmentScore": {
      "type": "object",
      "properties": {
        "segment_id": { "type": "string" },
        "type": { "type": "string",
                  "enum": ["heading","paragraph","list_item",
                          "table_cell","callout","figure_caption"] },
        "criticality": { "type": "string",
                         "enum": ["red_flag","medication","dose","instruction","standard"] },
        "source_text": { "type": "string" },
        "target_text": { "type": "string" },
        "back_translation": { "type": "string" },
        "subscores": { "$ref": "#/properties/subscores" },
        "ctqs": { "type": "number" },
        "flags": { "type": "array", "items": { "type": "string" } }
      }
    },
    "CriticalError": {
      "type": "object",
      "properties": {
        "category": {
          "type": "string",
          "enum": ["medication_change","dose_change","instruction_inversion",
                   "redflag_omission","numeric_mismatch","allergy_mismatch",
                   "negation_drift","unit_change"]
        },
        "segment_id": { "type": "string" },
        "detail": { "type": "string" },
        "detector": {
          "type": "string",
          "enum": ["rule","llm_judge","both"]
        },
        "confidence": { "type": "number" }
      }
    }
  }
}
```

The schema is the contract. Any future change to subscores or critical-error categories ships as a `harness_version` bump.

---

## 3. System Architecture

### 3.1 Component diagram (textual)

```
                     +-----------------------+
  POST /validate --->|  API Frontend         |   Container Apps,
                     |  (FastAPI, mTLS)      |   Entra Agent ID
                     +-----------+-----------+
                                 |
                                 v
                  +--------------+--------------+
                  | Foundry Agent Service       |   Orchestrator agent
                  | "validation-orchestrator"   |   (Connected Agents)
                  +--+--------+--------+--------+
                     |        |        |
                     v        v        v
        +----------------+ +-------------+ +-----------------+
        | Ingestion &    | | Format      | | Meaning         |
        | Alignment      | | Fidelity    | | Fidelity        |
        | (Container App)| | Scorer (CA) | | Scorer (CA +    |
        |                | | deterministic| | AML endpoints)  |
        +-------+--------+ +------+------+ +--------+--------+
                |                 |                 |
                v                 v                 v
        +-----------------------------------------------+
        | Critical-Error Gate (rules + LLM-judge)       |
        +-----------------------+-----------------------+
                                |
                                v
                +------------------------------+
                | Score Aggregator + Decision  |  Container App,
                | Engine                       |  pure Python
                +-------------+----------------+
                              |
                              v
        +-----------------------------------------------+
        | Audit Store: Cosmos DB (record) + Blob        |
        | (immutable doc copies) + App Insights (trace) |
        +-----------------------------------------------+
```

### 3.2 Technology choices and rationale

| Component | Tech | Why |
|---|---|---|
| **API frontend** | Container Apps + FastAPI behind App Gateway/WAF (ask1 §3.2) | Stateless, scales to zero; private endpoints to all dependencies; mTLS for service-to-service. Functions are also viable but the harness has multi-second latency (COMET inference) so a long-lived container is cheaper than per-invocation cold starts. |
| **Orchestrator** | Foundry Agent Service, "validation-orchestrator" Connected Agent | Inherits Entra Agent ID, Foundry tracing → App Insights, Foundry Evaluations. Critically, it gets *the same* identity model as the translation agent in ask2 §6, so audit records cross-link cleanly. |
| **Deterministic scorers** (format fidelity, alignment, F1, similarity) | Python Container Apps, **not** agents | These are deterministic, no LLM, no prompt engineering. An agent abstraction adds latency and cost without value. Run them as plain HTTP services. |
| **COMET / xCOMET inference** | Azure Machine Learning **managed online endpoint**, GPU SKU (A10 or T4) | Unbabel COMET-DA-XXL (~10.5B params) and xCOMET-XL/XXL need GPU. AML managed endpoints are the supported HIPAA-eligible path; container deployment on Container Apps GPU SKU is a fallback. |
| **LLM-judge** | Azure OpenAI deployment (GPT-5.1 default; engine-agnostic — see §15) called from Foundry Agent | Already in scope per ask1 §3a.5. Use Data Zone Standard. **Use a different model family from the translation engine** to avoid evaluator bias (e.g., if translation finalizer is GPT-5.1, prefer Mistral Large 3 or Grok 4-Fast as judge — ask1 §3a.5 already calls this out). |
| **Clinical entity extraction** | Azure AI Language **Text Analytics for Health** | First-party, HIPAA-eligible, structured RxNorm/SNOMED/UMLS linking out of the box ([Microsoft Learn](https://learn.microsoft.com/azure/ai-services/language-service/text-analytics-for-health/overview)). |
| **Back-translation** | Same engine choice is policy: route through a *different* engine than the one being validated, to avoid the engine "marking its own homework". Default: Azure Translator (NMT) when validating an LLM, or GPT-5.1 when validating NMT. |
| **Embeddings** | `text-embedding-3-large` (English↔English back-trans similarity) per ask1 §3a.5; **BGE-M3** as a multilingual fallback for direct cross-lingual cosine when back-translation is not available | 3-large is sufficient because back-translation similarity is computed over English. BGE-M3 (open weights, 8K context, multilingual) is the right tool only if the customer chooses to skip back-translation later. |
| **Audit store** | Cosmos DB for NoSQL (record), Azure Blob with immutability policy (document copies), App Insights (telemetry) | Already in the BYO standard-agent-setup footprint (ask1 §3.4). No new resources. |
| **CI gating** | Foundry Evaluations + GitHub Actions | Foundry Evaluations runs the harness against the golden set on every translation-pipeline change (ask1 §3.6). |

### 3.3 Normalized segment-aligned structure

The intermediate representation that all downstream scorers consume:

```python
@dataclass
class Segment:
    id: str                       # stable hash of (source_text, position)
    type: Literal["heading","paragraph","list_item","table_cell",
                  "callout","figure_caption"]
    level: int                    # heading depth (1..6); 0 if N/A
    parent_id: Optional[str]      # for nested lists / table rows
    order: int                    # global order in document
    source_text: str
    target_text: Optional[str]    # populated after alignment
    criticality: Literal["red_flag","medication","dose","instruction","standard"]
    placeholders: List[Placeholder]   # protected dose/code/date spans
    style: Dict[str, Any]         # bold, italic, link target, list_kind
```

Both source and target documents are parsed into `List[Segment]` with the same IDs for aligned segments. **Alignment failure is itself a meaning-failure signal** (see §5.1).

---

## 4. Format-Fidelity Scoring

Format fidelity is a deterministic, no-LLM scorer. It is the simplest part of the harness, and (per §13) the right thing to build first.

### 4.1 Sub-metrics

| Sub-metric | Symbol | Weight | Computation |
|---|---|---|---|
| Heading hierarchy | `H` | 0.20 | `1 − ( |Δheading_count| / max(n_src, 1) ) − 0.10·LCS_disorder` where `LCS_disorder = 1 − LCS(level_seq_src, level_seq_tgt) / max(n_src, n_tgt)` |
| Table structure | `T` | 0.25 | Per-table: `t_i = mean(row_parity, col_parity, header_parity, cell_count_parity)` where each `_parity ∈ {0,1}` per axis (1.0 if equal, scaled if within tolerance). Aggregate `T = mean(t_i)`. |
| List structure | `L` | 0.15 | `mean(item_count_parity, ordered_kind_parity, nesting_depth_parity)` per list, then averaged. |
| Inline structure | `I` | 0.10 | `mean(bold_parity, italic_parity, link_count_parity, callout_parity)` |
| Figure / image refs | `F` | 0.10 | `1 − |refs_dropped| / max(n_refs_src, 1)` |
| Page count delta | `P` | 0.10 | `1` if `|Δpages|/max(pages_src,1) ≤ 0.15`, linearly scaled to `0` at `Δ ≥ 0.5`. |
| Numeric / code preservation | `N` | 0.10 | Regex-extract dose values, units, frequencies, ICD-10, RxNorm, dates, times, lab values. `N = exact_match(src_set, tgt_set)`. **Any `N < 1.0` triggers a critical-error candidate** (see §6). |

```
FormatFidelity = 0.20·H + 0.25·T + 0.15·L + 0.10·I + 0.10·F + 0.10·P + 0.10·N
```

### 4.2 Worked example — a discharge with 3 headings, 2 tables, 1 medication list

**Perfect translation.** All counts and ordering preserved, all numerals round-trip:

```
H = 1.00, T = 1.00, L = 1.00, I = 1.00, F = 1.00, P = 1.00, N = 1.00
FormatFidelity = 0.20 + 0.25 + 0.15 + 0.10 + 0.10 + 0.10 + 0.10 = 1.00
```

**Translation with a missing table** (1 of 2 tables dropped):

```
T = mean(t_1=1.0, t_2=0.0) = 0.50  (the missing table contributes a hard 0)
All others = 1.00
FormatFidelity = 0.20 + 0.25·0.50 + 0.15 + 0.10 + 0.10 + 0.10 + 0.10 = 0.875
```

A 12.5-point hit. But the missing table likely contained medication entries — the **clinical-entity F1** scorer (§5) and the **critical-error gate** (§6) will both fire, taking the *composite* CTQS down much further.

**Translation with swapped heading order** (3 headings present but reordered: H1↔H2):

```
|Δheading_count| = 0
LCS_disorder for [1,2,3] vs [2,1,3] -> LCS = [1,3], length 2; disorder = 1 - 2/3 = 0.333
H = 1 - 0 - 0.10·0.333 = 0.967
All others = 1.00
FormatFidelity = 0.20·0.967 + 0.25 + 0.15 + 0.10 + 0.10 + 0.10 + 0.10 = 0.993
```

Heading reorder is small in format space — by design. If the *meaning* of the swap matters (say "After Discharge" vs "Before Discharge"), the meaning-fidelity scorer catches it. Format fidelity is a structural check, not a semantic one.

### 4.3 Implementation notes

- DOCX: `python-docx`; PDF: `pypdf` + `pdfplumber` for tables; HTML/Markdown: `BeautifulSoup` + `markdown-it-py`.
- For PDFs, treat **Mistral Document AI 25.12** (per ask1 §3a.5) as the structural ground truth — feed both source and target through it and compare its JSON output, rather than two separate native PDF parses.
- All parsers emit the `Segment` structure of §3.3. Any parse-error on either document → format fidelity = 0 and decision = `human_review` (don't reject; the document may still be translated correctly, but we can't verify without parsing).

---

## 5. Meaning-Fidelity Scoring

Four sub-scorers, each independently computable, aggregated per segment then weighted by criticality.

### 5.1 Segment alignment

Before scoring meaning, source and target segments must be aligned 1:1, 1:n, or n:1 (translation can split or merge sentences).

**Algorithm:**

1. **Structural pre-alignment**: match segments by `(type, parent_id, order)` from §3.3. Most heading/table-cell/list-item segments align trivially this way.
2. **Embedding alignment for paragraphs**: for unaligned paragraphs, compute multilingual embeddings (BGE-M3 or `text-embedding-3-large` after back-translation) and run a Hungarian assignment with a similarity floor of 0.65.
3. **Splits/merges**: if a source paragraph aligns with two target segments above floor, mark as 1:n; reverse for n:1.
4. **Failure**: any source segment with no target above the floor → `alignment_failure` flag. **Alignment failure is a hard signal of meaning loss**, not just a technical inconvenience. It contributes a critical-error candidate of category `redflag_omission` if the unaligned segment is `criticality ∈ {red_flag, medication, dose, instruction}`.

### 5.2 COMET / xCOMET (semantic equivalence)

- **Reference-based** (only when a golden reference exists): `Unbabel/wmt22-comet-da` ([HuggingFace](https://huggingface.co/Unbabel/wmt22-comet-da)). Used for golden-set runs, not production traffic.
- **Reference-free** (production default): `Unbabel/wmt22-cometkiwi-da-xxl` ([HuggingFace](https://huggingface.co/Unbabel/wmt22-cometkiwi-da)). Outputs a quality score in roughly `[0,1]`; we min-max normalize using language-pair–specific calibration on the golden set (§8) so a value of `1.0` means "equivalent to a top-quartile professional translation".
- **Fine-grained** (optional, phase 2): `Unbabel/XCOMET-XL` or `XCOMET-XXL` ([Guerreiro et al., TACL 2024](https://aclanthology.org/2024.tacl-1.54/)) for span-level error highlighting in the per-segment payload.

**Hosting on Azure:** AML managed online endpoint, A10 GPU (xCOMET-XXL needs ~24 GB VRAM). Container image based on `pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime` + `unbabel-comet`. Private endpoint, system-assigned managed identity, scale-to-1 minimum to keep latency bounded. Alternative: Container Apps GPU SKU — comparable, slightly cheaper, less polished MLOps story.

### 5.3 Back-translation similarity

1. Run target → source through a **different engine** than the one being validated.
2. Embed source and back-translation with `text-embedding-3-large`.
3. Compute cosine similarity per aligned segment.
4. Aggregate: weighted mean by segment length (tokens).

**Threshold derivation (do not hard-code):**

- Run the harness against the golden set (§8). For each language pair, compute the empirical distribution of cosine similarity for human-judged "acceptable" translations.
- The **5th percentile** of acceptable translations is the lower bound for the production threshold. For Spanish on Martos-2025-style discharge sections, expect this to land around 0.83–0.88 — confirm empirically; do not hard-code.

### 5.4 Clinical-entity F1

1. Run **Text Analytics for Health** on the **source** (English).
2. Run Text Analytics for Health on the **back-translation** (English).
3. Compute per-type F1 over entity sets.

**Entity types and per-type thresholds (initial defaults, calibrate against the golden set):**

| Type | Source mapping | Default F1 floor |
|---|---|---|
| `MedicationName` | RxNorm CUI | **0.98** — any miss is a critical-error candidate |
| `Dosage` | numeric + unit | **0.98** |
| `MedicationFrequency` | normalized frequency | 0.95 |
| `MedicationRoute` | route enum | 0.95 |
| `Diagnosis` / `SymptomOrSign` | SNOMED / UMLS CUI | 0.90 |
| `BodyStructure` | SNOMED CUI | 0.85 |
| `ExaminationName` / `TreatmentName` | SNOMED CUI | 0.85 |
| `MedicationStatus` (active / discontinued / held) | enum | **1.00** — change of status is a critical error |

Aggregate Clinical-Entity F1 = weighted mean of per-type F1, weighted by clinical impact (medications and statuses dominate).

### 5.5 LLM-as-judge (rubric-based SafetyScore)

**Rubric** — five domains, 5-point Likert, modeled on the Carreras Tartak / Brewster JMIR 2026 protocol ([JMIR Form Res 2026, doi:10.2196/79676](https://formative.jmir.org/2026/1/e79676)):

1. **Completeness** (no clinical content omitted)
2. **Fluency** (target language reads naturally to a patient)
3. **Meaning preservation** (no shift in clinical content)
4. **Severity preservation** (warnings and red flags retain urgency)
5. **Overall safety** (would this be safe to give to a patient?)

**Prompt template** (system + user; structured outputs JSON mode):

```
SYSTEM:
You are a bilingual {target_language} clinical reviewer (RN-level, 10y ED experience).
Evaluate one segment of a hospital discharge document translated from English to {target_language}.
For each domain, assign 1 (unsafe) to 5 (excellent). Then list any critical errors using
the MQM-aligned categories provided. Return JSON only.

USER:
SOURCE (English):
"""{source_text}"""

TRANSLATION ({target_language}):
"""{target_text}"""

BACK-TRANSLATION (English, by an independent engine):
"""{back_translation}"""

CLINICAL ENTITIES IDENTIFIED IN SOURCE:
{entities_json}

REGION CONTEXT: {patient_region or "general"}
DOCUMENT TYPE: {document_type}

CRITICAL-ERROR CATEGORIES:
medication_change, dose_change, instruction_inversion, redflag_omission,
numeric_mismatch, allergy_mismatch, negation_drift, unit_change

OUTPUT JSON SCHEMA:
{ "completeness": int 1..5, "fluency": int 1..5, "meaning": int 1..5,
  "severity": int 1..5, "overall": int 1..5,
  "rationale": str (<=80 words),
  "critical_errors": [ { "category": <enum>, "detail": str, "confidence": float 0..1 } ] }
```

**SafetyScore computation:**
```
raw_safety = mean(completeness, fluency, meaning, severity, overall) / 5.0
SafetyScore = raw_safety  if no critical_errors, else 0.0
```

Note: the LLM-judge can also emit critical errors, which feed §6.

**Calibration procedure** (run against the golden set, §8):

1. Have the LLM-judge score every golden segment.
2. Have two clinician reviewers also score every golden segment on the same rubric.
3. Compute **Krippendorff's α** (or Cohen's κ) for each pairing: judge-vs-clinicianA, judge-vs-clinicianB, clinicianA-vs-clinicianB.
4. Acceptance: judge-vs-clinician α ≥ 0.70 ([Krippendorff 2011](https://repository.upenn.edu/asc_papers/43/) — α ≥ 0.667 is the conventional floor for tentative conclusions; we use 0.70).
5. If α < 0.70: revise the prompt (often: add few-shot examples from the golden set), or swap judge model. Re-calibrate.
6. Repeat quarterly and on any judge model upgrade.

**Inter-rater reliability check** is not optional. It is the artifact you show to the CMO when defending the SafetyScore weight.

### 5.6 Aggregation across segments

Per-segment CTQS contribution is weighted by **criticality**:

| Criticality | Weight |
|---|---|
| `red_flag` (return-to-ED triggers, allergy warnings) | 3.0 |
| `medication` (drug names, allergies, RxNorm-tagged) | 2.5 |
| `dose` (numerics + units in medication context) | 2.5 |
| `instruction` (do/don't, follow-up, activity restrictions) | 2.0 |
| `standard` (everything else) | 1.0 |

```
DocumentSubscore_X = Σ (segment_subscore_X · weight) / Σ weight
```

This applies to COMET, EntityF1, BackTransSim, SafetyScore. FormatFidelity is computed at document level only.

---

## 6. Critical-Error Gate (MQM-Aligned)

Critical errors **bypass the composite score**. Any one critical error → `decision = reject` (or `human_review` for languages where the customer's policy is "always human-review"; see §15).

### 6.1 Categories and detection logic

| # | Category | Detector | Logic |
|---|---|---|---|
| 1 | `medication_change` | Rule + LLM-judge | Source `MedicationName` set ⊄ back-translation set, OR Levenshtein-similar drug name (e.g., "metformin" → "metoprolol"). RxNorm CUI mismatch is hard fail. |
| 2 | `dose_change` | Rule | Numeric extraction: dose value or unit differs between source and back-translation within a medication context window. Includes unit changes (mg → mcg). |
| 3 | `instruction_inversion` | Rule + LLM-judge | Negation polarity flip detected: source has `do not`/`avoid`/`stop` and target's back-translation lacks negation in the aligned segment, or vice versa. Deterministic detector: compare set of negation tokens (English `{not, no, never, don't, do not, avoid, stop}`) per segment. |
| 4 | `redflag_omission` | Rule + alignment | Any source segment with `criticality = red_flag` that has `alignment_failure` or back-translation cosine < 0.50. |
| 5 | `numeric_mismatch` | Rule | Any numeric / dose / lab / date / time present in source missing or altered in target (the §4.1 `N` sub-metric < 1.0 within `criticality ∈ {medication, dose, instruction}` segments). |
| 6 | `allergy_mismatch` | Rule + Text Analytics for Health | Allergen entity dropped or changed across source ↔ back-translation. |
| 7 | `negation_drift` | LLM-judge | LLM-judge detects subtle negation drift the rule-based detector missed (e.g., "you may take this with food" vs "you should take this with food"). |
| 8 | `unit_change` | Rule | Dose unit changed (mg → g, mL → tsp). Subset of `dose_change` but tracked separately for analytics. |

### 6.2 Behavior

- Any critical error from a **rule** detector is hard. No appeal in the auto path.
- Any critical error from the **LLM-judge** with `confidence ≥ 0.80` is hard.
- LLM-judge critical errors with confidence in `[0.50, 0.80)` are **soft**: route to `human_review`, do not reject.
- If both rule and LLM-judge agree (`detector = "both"`), confidence is implicitly 1.0.

### 6.3 Why this gate exists

Composite scores hide tail risk. A document can score CTQS 92 with one medication-name swap that kills the patient. The MQM critical-error gate is the safety layer that the CMO defends in front of the board, not the average score ([Lommel et al., MQM 2014](https://www.qt21.eu/mqm-definition/); [Freitag et al., TACL 2021](https://aclanthology.org/2021.tacl-1.87/)).

---

## 7. Composite Confidence Score (CTQS)

### 7.1 Formula (recap from ask2 §5.1)

```
CTQS_raw = 0.40·SafetyScore + 0.20·COMETnorm + 0.15·ClinicalEntityF1
         + 0.15·BackTransSim + 0.10·FormatFidelity

CTQS = round(100 · CTQS_raw, 1)              # 0.0..100.0

if any critical_error:
    CTQS = 0
    decision = "reject"
```

### 7.2 Weight rationale

| Term | Weight | Rationale |
|---|---|---|
| Safety (LLM-judge) | 0.40 | Clinically interpretable, captures domains COMET cannot (severity, completeness). The dominant term because it is calibrated against clinician judgment ([Carreras Tartak JMIR 2026](https://formative.jmir.org/2026/1/e79676)). |
| COMET | 0.20 | Best-evidence semantic-equivalence metric. Validated against human MQM at WMT22 ([Rei et al., EMNLP 2020](https://aclanthology.org/2020.emnlp-main.213/); [WMT22 Metrics findings](https://aclanthology.org/2022.wmt-1.2/)). |
| Clinical-Entity F1 | 0.15 | Hard, auditable, RxNorm/SNOMED-anchored. Lower weight than safety because high-recall tools like Text Analytics for Health miss subtle clinical paraphrases. |
| Back-translation similarity | 0.15 | Easy to compute, useful as a triangulation signal, but well-known to be confounded by the back-translator (which is why we route through a *different* engine). |
| Format fidelity | 0.10 | Mostly catches structural drops; numerals/codes are already enforced by the §6 critical-error gate, so format gets a smaller share. |

These weights are **defaults**, calibrated empirically. The design guarantees the calibration mechanism (§7.4) — the customer can shift these if their golden-set evidence justifies it.

### 7.3 Threshold tiers

| Tier | Range | Behavior |
|---|---|---|
| `auto_publish` | CTQS ≥ 90 AND no critical error AND language is on the auto-publish list | Publish without human review. Sample 5% for shadow review. |
| `human_review` | 80 ≤ CTQS < 90, OR any soft critical-error flag, OR language not auto-publish-eligible | Route to qualified human translator. Their decision overrides. |
| `reject` | CTQS < 80, OR any hard critical error | Block. Force re-translation or full human translation. |

The exact 90 / 80 cutoffs are **calibration parameters**, not laws of nature. They are chosen so that the auto-publish bucket has < 1% clinically-impactful error rate on the golden set (per ask2 §5.3). **The customer's CMO sets the auto-publish error tolerance; engineering picks thresholds to meet it.**

### 7.4 Recalibration against the golden set

Implemented as the `POST /calibrate` endpoint (§9). Procedure:

1. Run the harness against every document in the golden set; collect `(CTQS, clinician_verdict)` pairs where verdict ∈ {`acceptable`, `needs_revision`, `unsafe`}.
2. Sweep the auto-publish threshold from 80 to 99; compute the **empirical clinically-impactful error rate** above each threshold.
3. The auto-publish threshold is the lowest CTQS where the upper 95% Wilson confidence bound on error rate ≤ the customer's tolerance (e.g., 1%).
4. Output: a `calibration_delta` showing recommended threshold change, plus per-language splits.

### 7.5 Disclosure language for the CMO

> *"X% of {language} discharge translations evaluated against our golden set in {month} achieved a Clinical Translation Quality Score of {threshold} or higher with zero MQM-critical errors. CTQS is a composite of clinician-rubric safety (weight 0.40), COMET semantic equivalence (0.20), clinical-entity preservation F1 (0.15), back-translation cosine similarity (0.15), and structural format fidelity (0.10). Of those {auto-published count}, the post-hoc shadow-review clinically-impactful error rate is Y%, with 95% confidence interval [Y_lo, Y_hi]. All other translations are routed to a qualified human translator per Section 1557."*

This is the sentence the customer hands to their General Counsel. It has provenance, denominators, and a confidence interval. It is not "98.4% accurate." It is *defensible*.

---

## 8. The Golden Validation Set

### 8.1 Composition

Per ask2 §5.2 (kept here for completeness, with sample-size math made explicit):

- 50% real de-identified hospital discharges, top diagnoses (heart failure, pneumonia, diabetes, asthma, post-op orthopedic, OB).
- 25% adversarial cases: medication confusables, dose-unit edges, negation patterns, allergy warnings.
- 25% public test corpora ([WMT24 Biomedical Translation Task](https://www2.statmt.org/wmt24/biomedical-translation-task.html); [Neves et al., WMT 2023](https://aclanthology.org/2023.wmt-1.18/)).

**Reference translations:** two independent professional medical translators per language, blinded; reconciled gold per the [Beaton et al. Spine 2000](https://pubmed.ncbi.nlm.nih.gov/11124735/) forward-back protocol and ISO 17100:2015.

### 8.2 Sample-size rationale

For a noninferiority claim of "{engine} is noninferior to professional translation" at α=0.05 (two-sided), 80% power, assuming both arms have acceptability rate ~0.95 with noninferiority margin Δ=0.05:

```
n ≈ 2 · (z_{α/2} + z_{β})² · p(1-p) / Δ²
  ≈ 2 · (1.96 + 0.84)² · 0.95 · 0.05 / (0.05)²
  ≈ 2 · 7.84 · 0.0475 / 0.0025
  ≈ 297 segments per language
```

**Recommendation:**
- **HoK pilot floor: 30–50 documents per language** (~150–250 segments). This matches the Martos 2025 Seattle Children's design (148 sections from 34 documents) ([JAMA Network Open 2025](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2839035)) — it's not enough for tight noninferiority but is enough to bound CTQS reliability and detect calibration regressions.
- **Production claim floor: ~300 segments per language** (~60–80 documents) for a defensible noninferiority claim.
- **For Mandarin/Vietnamese/Arabic/Tagalog:** start at 50 documents, plan to grow to 100 once the customer has processed a quarter of production traffic and re-anchored the rubric.

### 8.3 Refresh cadence

- **Quarterly:** add 10 new real documents per language (rotating diagnosis mix), retire any that drift into staleness (e.g., new medication formulations).
- **Triggered:** whenever the translation engine, judge model, or COMET model version changes. Re-calibrate before re-cutting auto-publish thresholds.

---

## 9. API Surface

All endpoints are mTLS-only behind App Gateway, Entra-authenticated with Agent ID, and rate-limited per Foundry AI Gateway.

### 9.1 `POST /validate`

Submit a translation for scoring.

**Request:**
```json
{
  "source_doc_url": "https://blob.../source.docx?sv=...",
  "target_doc_url": "https://blob.../target.docx?sv=...",
  "language_pair": { "source": "en", "target": "es-MX" },
  "document_type": "discharge_instructions",
  "glossary_version": "ct-spanish-2026.04",
  "patient_region": "MX",
  "engine_metadata": {
    "engine": "azure-doc-translation+custom-translator",
    "engine_version": "v3.2",
    "model": "n/a",
    "prompt_hash": null
  }
}
```

**Response:** the full `ValidationResult` JSON from §2.2. Synchronous for documents up to ~50 segments (~5 pages); for larger documents, returns `202 Accepted` with a `validation_id` and a `Location` header pointing at `/validation/{id}`.

Latency targets in §12.

### 9.2 `GET /validation/{id}`

Retrieve a prior validation result. Cosmos lookup by `id` (partition key = `language_pair.target` for clean per-language analytics). Includes pre-signed Blob URLs for source and target documents (read-only, 1-hour expiry).

### 9.3 `POST /calibrate`

Run the harness against the customer's golden set and return calibration deltas.

**Request:**
```json
{
  "golden_set_id": "golden-2026Q2",
  "language_pair": { "source": "en", "target": "es-MX" },
  "tolerance": { "clinical_impact_error_rate": 0.01 },
  "compare_to": "production"   // or a specific harness_version
}
```

**Response:**
```json
{
  "calibration_id": "...",
  "n_documents": 47, "n_segments": 213,
  "current_thresholds": { "auto_publish": 90, "human_review": 80 },
  "recommended_thresholds": { "auto_publish": 91, "human_review": 80 },
  "empirical_metrics": {
    "auto_publish_error_rate": 0.008,
    "wilson_95_ci": [0.001, 0.024],
    "human_review_error_rate": 0.06,
    "judge_clinician_alpha": 0.78
  },
  "weight_sensitivity": {
    "safety": 0.41, "comet": 0.19, "entity_f1": 0.16,
    "back_trans_sim": 0.14, "format_fidelity": 0.10
  },
  "delta_summary": "Auto-publish threshold up 1pt; weights stable; judge α improved 0.04 vs Q1."
}
```

### 9.4 `GET /metrics`

Operational metrics for SRE: P50/P95/P99 latency by document size, throughput, error rate by stage, COMET endpoint health, judge token spend, decision distribution. Exposes Prometheus format and pushes the same to App Insights.

---

## 10. Storage and Audit Trail

### 10.1 Cosmos DB document model

Container: `validation_records`, partition key `/language_pair/target`, RU/s autoscale (start at 4000 max).

```json
{
  "id": "<validation_id uuid>",
  "language_pair": { "source": "en", "target": "es-MX" },
  "document_type": "discharge_instructions",
  "validated_at": "2026-05-09T13:42:11Z",
  "harness_version": "1.0.0",
  "engine_metadata": { ... },
  "ctqs": 92.4,
  "decision": "auto_publish",
  "decision_rationale": "...",
  "subscores": { ... },
  "format_diagnostics": { ... },
  "critical_errors": [],
  "segments": [ <SegmentScore>, ... ],
  "audit_ref": {
    "source_blob_url": "...",
    "target_blob_url": "...",
    "back_translation_blob_url": "...",
    "retention_until": "2032-05-09"
  },
  "calibration_pointer": { "calibration_id": "cal-2026Q2", "thresholds": { "auto_publish": 90, "human_review": 80 } },
  "_etag": "...", "_ts": 1715260931
}
```

### 10.2 Blob storage

- Container `validation-docs`, **immutability policy** with time-based retention of 6 years (HIPAA, 45 CFR 164.530(j)) plus 1 year buffer = **7 years** ([HHS HIPAA documentation retention](https://www.hhs.gov/hipaa/for-professionals/faq/2010/how-long-must-a-covered-entity-retain/index.html)).
- Customer-managed keys via Key Vault Premium / Managed HSM (ask1 §3.4).
- Blobs are versioned; legal hold can be applied via the Section 1557 documentation workflow (45 CFR §92.10 record-keeping is largely silent on length, so HIPAA's 6 years governs as the binding retention floor).
- Blob types stored: `source/`, `target/`, `back_translation/`, `golden_reference/` (for golden-set runs).

### 10.3 App Insights

OpenTelemetry-native via Foundry tracing (ask1 §3.6). Custom dimensions: `harness_version`, `language_target`, `document_type`, `decision`, `ctqs_bucket` (10-point buckets), `judge_model`, `comet_endpoint_version`. Drives the §11 drift detector and the `/metrics` endpoint.

### 10.4 Retention compliance summary

| Regulation | Requirement | Implementation |
|---|---|---|
| HIPAA, 45 CFR 164.530(j) | 6 years from creation or last effective date | 7-year immutable retention on all validation Blobs and Cosmos records |
| Section 1557 (45 CFR Part 92) | Reasonable record-keeping of language-access activities; no fixed retention period in the rule itself | Audit trail captured with translator credentials (engine + glossary version + judge model + harness version); retention follows HIPAA's 6 years as the binding floor ([§1557 Final Rule, 89 FR 37522](https://www.federalregister.gov/documents/2024/05/06/2024-08711/nondiscrimination-in-health-programs-and-activities)) |
| State-level (e.g., CA) | Some require 7+ years | Default is 7 years; configurable per facility |

---

## 11. CI/CD Integration

### 11.1 Pipeline gating

The harness is a **release gate** in the translation pipeline. Any change to:

- the translation engine version or model,
- a Custom Translator deployment slot,
- a Custom Translator phrase dictionary,
- the LLM-judge prompt or model,
- the COMET endpoint version,
- the harness itself,

triggers a Foundry Evaluations run against the golden set ([Foundry Evaluations docs](https://learn.microsoft.com/azure/ai-foundry/concepts/evaluation-approach-gen-ai)). The release blocks unless:

1. Judge-vs-clinician Krippendorff α ≥ 0.70 holds,
2. Auto-publish bucket clinical-impact error rate ≤ tolerance (95% upper Wilson bound),
3. CTQS distribution mean has not regressed > 0.5 standard deviations vs the previous baseline.

GitHub Actions workflow file: `.github/workflows/translation-release-gate.yml`.

### 11.2 Drift detection

Two detectors, both backed by App Insights queries:

- **Score drift**: rolling 7-day mean CTQS by language; alert if it falls > 1 σ below the 28-day baseline.
- **Distribution drift**: PSI (Population Stability Index) on the histogram of CTQS scores between current 7-day window and the 28-day baseline. PSI > 0.20 → alert; > 0.30 → block auto-publish for that language pending re-calibration.

Alerts route to Microsoft Sentinel + the customer's clinical AI governance committee (ask2 §7.4).

### 11.3 Nightly regression

A Foundry Evaluations job runs the full golden set every night at 02:00 local. Failures page the on-call. Successes update the operational dashboard.

---

## 12. Operational SLOs

| Metric | Target | Measurement |
|---|---|---|
| **Latency P95**, single-page discharge (≤ 5 segments) | ≤ 8 s end-to-end | App Insights, `/validate` synchronous path |
| **Latency P95**, multi-page (5–20 segments) | ≤ 25 s | Async, polled via `/validation/{id}` |
| **Latency P99**, multi-page | ≤ 45 s | Same |
| **Throughput** | ≥ 200 validations/hour sustained per Container Apps replica | Load test |
| **Cost / validation** (single-page Spanish baseline) | ≤ $0.45 | Itemized below |
| **Availability** | 99.5% monthly (allows for AML endpoint maintenance) | App Insights synthetic monitor every 5 min |

**Cost itemization (single-page Spanish, indicative):**

| Component | Estimated cost |
|---|---|
| Document parse (Container App CPU) | $0.001 |
| Format fidelity (CPU) | $0.001 |
| Text Analytics for Health (S tier) | $0.005 |
| Back-translation (Azure Translator NMT, ~1500 chars) | $0.015 |
| Embeddings (text-embedding-3-large, ~6 segments × ~150 tokens) | $0.001 |
| COMET endpoint (AML A10, amortized per call) | $0.10 |
| LLM-judge (GPT-5.1, ~5K input + 1K output across all segments) | $0.025 |
| Cosmos + Blob writes | $0.002 |
| Foundry Agent orchestration overhead | $0.005 |
| Margin / autoscale | $0.30 |
| **Total** | **~$0.45** |

The COMET endpoint and the AML GPU minimum are the dominant cost. Phase 2 (§14) explores quantized COMET on CPU; that drops the floor to ~$0.20.

---

## 13. HoK Day-1 Minimum Viable Harness

What Adam stands up in **8 hours on-site** that demonstrates the design and has measurable output.

### 13.1 Scope cuts

| Component | Day-1 status |
|---|---|
| Format-fidelity scorer | **Build**: full spec from §4, deterministic Python, no LLM. Fastest signal-to-build ratio. |
| Back-translation similarity (one segment-level meaning sub-metric) | **Build**: Azure Translator for back-translation, `text-embedding-3-large` for cosine. Highest signal per hour. |
| COMET / xCOMET | **Stub**: returns `null` with a `not_yet_calibrated` flag. AML endpoint provisioning is async; do it in parallel but don't block on it. |
| Clinical-entity F1 | **Stub**: Text Analytics for Health is a 30-minute wire-up — include if time, otherwise stub. |
| LLM-judge SafetyScore | **Stub** with a single prompt call returning a 1–5 overall + rationale. Do **not** run inter-rater calibration on Day 1 — that's a clinician sit-down, days not hours. |
| Critical-error gate | **Build (rule subset)**: numeric_mismatch, dose_change, negation_drift (rule version). Skip allergy_mismatch and LLM-judge errors on Day 1. |
| Score aggregator + decision | **Build**: with fixed thresholds (90 / 80), labeled `pre-calibration`. |
| Audit store | **Build (Cosmos write only)**: Blob immutability policy can wait; writes go to Blob without immutability for the day-of demo. |
| API surface | **Build (`POST /validate` + `GET /validation/{id}` only)**: skip `/calibrate` and `/metrics`. |
| Foundry orchestrator | **Build (single agent, not Connected Agents)**: keep it minimal. |
| Golden set | **One Spanish discharge document** (de-identified). One reference translation. Demonstrates the calibration concept; statistical claims explicitly deferred. |

### 13.2 Day-1 checklist

- [ ] **Hour 0–1: Provisioning.** Foundry project (or reuse the ask2 project), AOAI deployment of judge model, Azure Translator, Text Analytics for Health, Cosmos container `validation_records`, Blob container `validation-docs` (no immutability yet), Container Apps environment, App Insights.
- [ ] **Hour 1–3: Format-fidelity scorer.** Python service, DOCX + Markdown parsers, full §4 sub-metrics, unit tests on three synthetic discharges (perfect / missing-table / heading-swap from §4.2).
- [ ] **Hour 3–4: Back-translation + cosine.** Wire Azure Translator and `text-embedding-3-large`, segment alignment via order+type pre-alignment with embedding fallback.
- [ ] **Hour 4–5: Critical-error rules.** `numeric_mismatch`, `dose_change`, `negation_drift` regex/token detectors. Hard-fail wiring.
- [ ] **Hour 5–6: Aggregator + API.** FastAPI service exposing `POST /validate`, returns the full `ValidationResult` schema with `comet=null`, `entity_f1=null`, `safety=` LLM-judge stub.
- [ ] **Hour 6–7: Foundry orchestrator wiring.** Single agent calling parser → format → meaning → critical → aggregator. Trace to App Insights.
- [ ] **Hour 7–8: Demo + hand-off.**
  - Demo 1: perfect Spanish translation → CTQS ~95, `auto_publish`.
  - Demo 2: deliberate dose change → critical-error fire, CTQS=0, `reject`.
  - Demo 3: heading reorder → small format hit, still `auto_publish`.
  - Hand-off doc: this design doc + the actual config used + `.env.example` + the three demo inputs.

### 13.3 Hand-off doc

A 2-pager Adam leaves with the customer engineering team:

1. Repo URL + branch.
2. The three working demos and their inputs.
3. The list of stubs and their stub responses.
4. Top-3 follow-on tasks (in §14 order).
5. Open-decisions checklist (§15).
6. The escalation path: Adam's contact + the Foundry FastTrack queue.

---

## 14. Phase 2 Enhancements (post-HoK, ROI-ordered)

| Order | Enhancement | Rationale | Effort |
|---|---|---|---|
| 1 | **Stand up the AML COMET / xCOMET endpoint and replace the stub** | Brings the largest gap-to-design closure; the customer's "98.4%" disclosure language depends on COMET being real | 3–5 days |
| 2 | **Build the golden validation set (50 docs Spanish, then Mandarin/Vietnamese)** | Without the golden set, calibration is theoretical. This is the rate-limiting investment; budget hospital interpreter time. | 4–8 weeks elapsed |
| 3 | **LLM-judge calibration** (clinician inter-rater study) | Earns the right to apply the 0.40 weight on SafetyScore | 2–3 weeks |
| 4 | **Clinical-entity F1 with full per-type thresholds** | Highest auditability per dollar; uses Text Analytics for Health out of the box | 1 week |
| 5 | **Critical-error gate v2** (allergy, instruction inversion, LLM-judge agreement) | Closes the safety side of the harness | 1 week |
| 6 | **`/calibrate` endpoint and weight sensitivity analysis** | Makes the harness defensible to the CMO | 1 week |
| 7 | **Drift detection + Sentinel integration** | Production hygiene | 1 week |
| 8 | **xCOMET span-level errors surfaced in `segments[]`** | UX win — interpreters see exactly where the translation drifts | 1–2 weeks |
| 9 | **Per-region / per-dialect calibration slots** (Mexican vs Caribbean Spanish, Mainland vs Taiwanese Mandarin) | Equity — addresses the §11.3 disparate-performance audit | 2 weeks per pair |
| 10 | **Quantized COMET on CPU** (cost optimization) | Drops cost floor ~50% | 1 week |
| 11 | **Active-learning loop**: human-review decisions feed back into LLM-judge prompt examples | Slow improvement curve over time | ongoing |

---

## 15. Open Design Decisions (Customer Sign-off Required)

Each of these is a clinical-policy or commercial decision, not an engineering one. Engineering will implement whatever the customer chooses.

1. **LLM-judge model.** Default GPT-5.1 (ask1 §3a.5). Alternatives: Mistral Large 3, Grok 4-Fast. Per ask1, the judge should differ in family from the production translator to avoid evaluator bias. **Final choice will be informed by the parallel ask2 update on translation engine.**
2. **Auto-publish threshold (CTQS cutoff).** Default 90; calibrated to ≤ 1% clinically-impactful error rate on Spanish. The CMO sets the tolerance, engineering picks the threshold. For non-Spanish languages, the default is **no auto-publish until the per-language golden set has been processed and the threshold has been calibrated** (per ask2 §2.3).
3. **Critical-error category list.** Eight categories proposed (§6.1). Clinical sign-off required, especially on `instruction_inversion` and `negation_drift`, where the rule-based detector boundaries are a clinical judgment.
4. **Glossary version-pinning policy.** Two options: (a) every validation pins to a specific Custom Translator deployment slot (reproducible, audit-clean, requires explicit upgrade ceremonies); (b) latest-glossary at validation time (auto-improving, harder to audit). Recommend (a). Customer's clinical informatics + IT security teams sign off.
5. **Back-translation engine.** Should the back-translator be a *different vendor* from the production translator, or just a different Azure model? Different vendor is the strongest decoupling but adds a partner-BAA. Recommend "different model on Azure direct" (e.g., back-translate with GPT-5.1 if the production engine is Azure NMT + Custom Translator).
6. **Languages eligible for auto-publish ever.** Spanish is plausible (Martos 2025 noninferiority). For Mandarin / Vietnamese / Arabic / Tagalog, auto-publish may be off the table indefinitely as a clinical-policy stance. Confirm with the CMO.
7. **Retention period.** Default 7 years. State or facility policy may require 10. Confirm.
8. **Shadow review sample rate.** Default 5% of auto-published. Some customers want 10% for their first six months in production. Confirm.

---

## 16. References

### Translation evaluation literature

1. Rei R, Stewart C, Farinha AC, Lavie A. **COMET: A Neural Framework for MT Evaluation.** EMNLP 2020. [aclanthology.org](https://aclanthology.org/2020.emnlp-main.213/)
2. Unbabel. **wmt22-comet-da** model card. [HuggingFace](https://huggingface.co/Unbabel/wmt22-comet-da)
3. Unbabel. **wmt22-cometkiwi-da** model card. [HuggingFace](https://huggingface.co/Unbabel/wmt22-cometkiwi-da)
4. Guerreiro NM, Rei R, van Stigt D, Coheur L, Colombo P, Martins AFT. **xCOMET: Transparent Machine Translation Evaluation through Fine-grained Error Detection.** TACL 2024. [aclanthology.org](https://aclanthology.org/2024.tacl-1.54/)
5. Freitag M, Foster G, Grangier D, Ratnakar V, Tan Q, Macherey W. **Experts, Errors, and Context: A Large-Scale Study of Human Evaluation for Machine Translation.** TACL 2021. [aclanthology.org](https://aclanthology.org/2021.tacl-1.87/)
6. Lommel A, Burchardt A, Uszkoreit H. **Multidimensional Quality Metrics (MQM): A Framework for Declaring and Describing Translation Quality Metrics.** Tradumàtica 2014. [qt21.eu](https://www.qt21.eu/mqm-definition/)
7. **WMT24 Biomedical Translation Task.** [statmt.org](https://www2.statmt.org/wmt24/biomedical-translation-task.html)
8. Neves M et al. **Findings of the WMT 2023 Biomedical Translation Shared Task.** [aclanthology.org](https://aclanthology.org/2023.wmt-1.18/)
9. **Findings of the WMT 2022 Metrics Shared Task.** [aclanthology.org](https://aclanthology.org/2022.wmt-1.2/)

### Clinical translation evidence

10. Carreras Tartak JA, Brewster RCL et al. **Use of a Large Language Model for Translation of Emergency Department Discharge Instructions.** JMIR Form Res 2026. [doi:10.2196/79676](https://formative.jmir.org/2026/1/e79676)
11. Martos M, Fields B, Finlayson SG et al. **Accuracy of Artificial Intelligence vs Professionally Translated Discharge Instructions.** JAMA Netw Open 2025;8(9):e2532312. [JAMA Network Open](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2839035)
12. Brewster RCL et al. **Performance of ChatGPT and Google Translate for Pediatric Discharge Instruction Translation.** Pediatrics 2024;154(1):e2023065573. [AAP](https://publications.aap.org/pediatrics/article/154/1/e2023065573/197086)
13. Beaton DE, Bombardier C, Guillemin F, Ferraz MB. **Guidelines for the process of cross-cultural adaptation of self-report measures.** Spine 2000. [PubMed](https://pubmed.ncbi.nlm.nih.gov/11124735/)

### Inter-rater reliability

14. Krippendorff K. **Computing Krippendorff's Alpha-Reliability.** University of Pennsylvania, 2011. [repository.upenn.edu](https://repository.upenn.edu/asc_papers/43/)

### Microsoft platform

15. Microsoft Learn. **Azure AI Foundry Agent Service overview.** [learn.microsoft.com](https://learn.microsoft.com/azure/ai-foundry/agents/overview)
16. Microsoft Learn. **Foundry Evaluations / evaluation approach for generative AI.** [learn.microsoft.com](https://learn.microsoft.com/azure/ai-foundry/concepts/evaluation-approach-gen-ai)
17. Microsoft Learn. **Foundry observability and tracing.** [learn.microsoft.com](https://learn.microsoft.com/azure/ai-foundry/concepts/observability)
18. Microsoft Learn. **Azure AI Translator — Document Translation overview.** [learn.microsoft.com](https://learn.microsoft.com/azure/ai-services/translator/document-translation/overview)
19. Microsoft Learn. **Azure AI Language — Text Analytics for Health.** [learn.microsoft.com](https://learn.microsoft.com/azure/ai-services/language-service/text-analytics-for-health/overview)
20. Microsoft Learn. **Azure Machine Learning managed online endpoints.** [learn.microsoft.com](https://learn.microsoft.com/azure/machine-learning/concept-endpoints-online)
21. Microsoft Learn. **Azure OpenAI Service — data, privacy, and security.** [learn.microsoft.com](https://learn.microsoft.com/azure/ai-services/openai/how-to/data-privacy)
22. Microsoft Trust Center. **HIPAA / HITECH Act compliance.** [microsoft.com](https://www.microsoft.com/trust-center/compliance/hipaa)

### Regulatory

23. HHS. **Section 1557 Final Rule.** 89 FR 37522, May 6, 2024. [federalregister.gov](https://www.federalregister.gov/documents/2024/05/06/2024-08711/nondiscrimination-in-health-programs-and-activities)
24. HHS OCR. **Section 1557 of the Patient Protection and Affordable Care Act.** [hhs.gov](https://www.hhs.gov/civil-rights/for-individuals/section-1557/index.html)
25. HHS. **HIPAA documentation retention requirements (45 CFR 164.530(j)).** [hhs.gov](https://www.hhs.gov/hipaa/for-professionals/faq/2010/how-long-must-a-covered-entity-retain/index.html)
26. ISO. **17100:2015 — Translation services — Requirements.** [iso.org](https://www.iso.org/standard/59149.html)

### Companion docs

27. **`ask1-architecture-plan.md`** — platform architecture: Foundry Agent Service, US Data Zone AOAI, Entra Agent ID, private endpoints, model portfolio, BAA inheritance.
28. **`ask2-discharge-translation-plan.md`** — workflow plan: five-agent pipeline, CTQS sketch (§5), per-language posture, Section 1557 compliance.

### Harness-architecture precedent (acknowledged, not load-bearing)

29. Microsoft. **Azure ML evaluation framework.** [learn.microsoft.com](https://learn.microsoft.com/azure/machine-learning/concept-evaluation)
30. **MLflow Evaluate.** [mlflow.org](https://mlflow.org/docs/latest/llms/llm-evaluate/index.html)
31. **TruEra / Truera evaluation patterns.** [truera.com](https://truera.com/) (background reading on production LLM evaluation gates)
32. **Arize AI / Phoenix.** [arize.com](https://arize.com/) (drift-detection patterns)
33. **LangFair (LangChain fairness).** [github.com/cvs-health/langfair](https://github.com/cvs-health/langfair) (evaluation harness scaffolding patterns)

---

*Prepared for Adam Workman, Microsoft Principal Solutions Engineer, US HLS STU Cloud and AI. Companion to `ask1-architecture-plan.md` and `ask2-discharge-translation-plan.md`. Engine-agnostic by design — absorbs the parallel ask2 engine update without refactor. All claims grounded in cited sources; CTQS weights and threshold defaults require empirical calibration on the customer's golden set per §7.4.*
