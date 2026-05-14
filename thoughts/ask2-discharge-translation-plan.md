# Hack on Keyboard - Hospital Discharge Translation Plan

**Author context:** Adam Workman, Microsoft Principal Solutions Engineer, US HLS STU Cloud and AI
**Engagement:** Hospital Hack on Keyboard - Agentic AI workflow for translating English hospital discharge papers into LEP languages (Spanish, Vietnamese, Mandarin, Arabic, Tagalog, plus extensibility to other languages of lesser diffusion).
**Date:** 2026-05-09
**Status:** Defensible plan, evidence-grounded, opinionated.

---

## Executive Summary

> **Key Finding:** A **dual-engine consensus pipeline on Azure AI Foundry**: a frontier LLM (Claude Sonnet 4.6 on Foundry, HIPAA-ready as of January 11, 2026, or the GPT-5 family in US Data Zone) as the **primary translator** with adaptive few-shot prompting and inline glossary, paired with **Azure AI Translator** (2025-10-01-preview hybrid mode, or classical NMT + Custom Translator) as a **cross-check translator running in parallel**. An evaluator agent reconciles disagreements via back-translation CTQS scoring and routes ties or both-low scores to human review. Replace the customer's "98.4%" target with the **Clinical Translation Quality Score (CTQS = 0.40·Safety + 0.20·COMET + 0.15·ClinicalEntityF1 + 0.15·BackTransSim + 0.10·FormatFidelity)** with a hard MQM critical-error gate. Spanish is auto-publishable after validation; Mandarin and Arabic move from low-confidence to **moderate-confidence** after Wang CJEM 2026; Vietnamese and Tagalog remain mandatory human review.
>
> **Confidence:** HIGH on the dual-engine direction and on Spanish auto-publishability post-validation; MODERATE on per-model selection per language pending HoK bake-off; MODERATE for Mandarin, Arabic, and Vietnamese (upgraded from earlier MODERATE/LOW based on Wang CJEM 2026); LOW for Tagalog (research-mode, no parity NMT cross-check available).
>
> **Action:** At HoK, build the **test harness and bake-off arena first**, not the translator. The harness is the deliverable that converts a "demo" into something the hospital's General Counsel and Chief Medical Officer can sign off on - and it is the same artifact that picks the production primary every quarter going forward (Section 2.4). The composite accuracy score (Section 5) is the contract; the bake-off is the process.

The "98.4%" target accuracy number in the customer brief should be redefined before HoK as a **composite Clinical Translation Quality Score (CTQS)** that combines safety-weighted error gating (MQM critical-error thresholds), semantic equivalence (COMET), clinical-entity preservation F1, and back-translation similarity, rather than a single BLEU-style score. A single number invites confirmation bias; the composite, with critical-error gating, is auditable.

---

## 1. Executive Recommendation (one paragraph the customer should remember)

Build a **dual-engine consensus, multi-agent translation pipeline on Azure AI Foundry**. A **frontier LLM** (Claude Sonnet 4.6 on Foundry, generally available January 11, 2026, or the GPT-5 family in US Data Zone - selected per language by quarterly bake-off) acts as the **primary translator** with a clinical system prompt, adaptive few-shot exemplars from the hospital's own validated translations, and an inline RxNorm/SNOMED glossary. **Azure AI Translator** (2025-10-01-preview hybrid mode, or classical NMT with a Custom Translator deployment slot) runs in **parallel as a cross-check**, consuming the same XLIFF input. An **evaluator agent** scores both outputs against the Clinical Translation Quality Score (CTQS), picks the higher score on agreement, and routes disagreements above threshold or both-low scores to a Human-Review Gateway. The dual-engine posture is what the 2025-2026 evidence now supports: Wang CJEM 2026 (PMID 41533280) shows frontier LLMs beating Google Translate on Arabic (+0.4) and Simplified Chinese (+0.2) for pediatric ED discharge; Asgari npj Digit Med 2025 quantifies LLM hallucination at 1.47% and omission at 3.45%, which is exactly why a deterministic NMT cross-check stays in the loop; Microsoft's own Azure AI Translator 2025-10-01-preview pivot adds LLM and hybrid modes to the Translator product itself. Position the system as "AI-assist with mandatory human-in-the-loop for non-Spanish and any flagged segment" to satisfy Section 1557's qualified-translator requirement [89 FR 37522](https://www.federalregister.gov/documents/2024/05/06/2024-08711/nondiscrimination-in-health-programs-and-activities).

**Confidence: HIGH** on the dual-engine direction; **MODERATE** on per-language model selection, which is what the bake-off arena (Section 2.4) is built to answer on calibrated evidence from the hospital's own discharge corpus.

---

## 2. Recommended Translation Engine and Why

**Production engine: Azure AI Document Translation (Translator v3) with a Custom Translator deployment per language pair, fed by a hospital-specific medical phrase dictionary.**

### 2.1 Why a frontier LLM is now the primary translator (and Translator is the cross-check)

The 2025 picture - "NMT primary, LLM evaluator" - was correct then. The 2026 picture is different. Three things changed: (1) Wang et al, CJEM January 2026 (PMID 41533280) showed ChatGPT-4 beating Google Translate on Arabic and Simplified Chinese pediatric ED discharge instructions on a 5-domain rubric, with Arabic +0.4 and Chinese +0.2 mean improvement (p<0.01) - the LEP equity gap that NMT could not close is now narrowing under frontier LLMs. (2) Asgari et al, npj Digital Medicine 2025, quantified the LLM clinical-summarization failure mode at 1.47% hallucination and 3.45% omission after a refinement pass - real, but bounded, and exactly the kind of failure mode an independent NMT cross-check is designed to catch. (3) Microsoft's own Azure AI Translator 2025-10-01-preview added LLM choice, adaptive custom translation, and hybrid NMT+LLM modes to the Translator product itself - the platform provider has publicly pivoted. Combined with Claude Sonnet 4.6 going GA on Microsoft Foundry for Healthcare on January 11, 2026 (HIPAA-eligible), and GPT-5 family pricing on Foundry US Data Zone, the engine question has reversed.

The right framing for 2026 is "what is each engine *good for* now," not "which one wins":

| Role | What it brings to discharge translation |
|---|---|
| **Frontier LLM as primary** (Claude Sonnet 4.6 on Foundry, or GPT-5 family in US Data Zone) | Rich system-prompt control: medical glossary inline, regional dialect, reading-level ceiling, explicit do-not-translate rules for codes and numerals. Long-document handling without chunk-and-stitch loss. Fast improvement curve - the bake-off cadence (Section 2.4) is the lever that captures it. Closes the LEP equity gap on Arabic and Simplified Chinese per Wang CJEM 2026 (PMID 41533280). Clinical-summarization hallucination is real (1.47% per Asgari 2025) but bounded and detectable by the cross-check. |
| **Azure AI Translator as cross-check** (2025-10-01-preview hybrid, or classical NMT + Custom Translator) | Independent second opinion - architecturally diverse from the LLM, so the failure modes do not correlate. Cheap parallel call (per-character pricing, no token amplification on long XLIFF). Mature SLA, format-preserving by construction, deterministic on numerals when XLIFF placeholders are respected. Custom Translator deployment slot remains the lever for hospital-specific phrasing. Ideal as the cross-check, not as the sole engine for non-Spanish languages where Wang 2026 now shows LLM superiority. |

**Sources:** Wang et al, *CJEM* January 14, 2026, PMID 41533280; Asgari et al, *npj Digital Medicine* 2025 (hallucination 1.47%, omission 3.45%); Microsoft Learn, Azure AI Translator 2025-10-01-preview release notes; Microsoft Industry Cloud Blog, Claude Sonnet 4.6 GA on Foundry, January 11, 2026; WMT 2025 General Machine Translation Task Findings (LLM-led era confirmation).

**Recommendation: dual-engine consensus, LLM-led, NMT cross-check.** [Confidence: HIGH on the direction; MODERATE on specific model selection per language pending HoK bake-off.]

### 2.2 Two symmetric levers - adaptive few-shot on the LLM, Custom Translator on the cross-check

Each engine has a tuning lever, and both consume the same hospital glossary artifact. That symmetry is deliberate: it keeps the architecture engine-agnostic and makes the bake-off (Section 2.4) a fair comparison.

**On the primary (frontier LLM) - adaptive few-shot prompting.** Inject 3-5 hospital-validated reference translations into the system prompt at request time, retrieved from a small vector index over the validated parallel corpus, ranked by similarity to the source segment. The same glossary - RxNorm medications, SNOMED conditions, regional preferences (e.g., Mexican Spanish "conmoción cerebral" over "concusión") - is rendered inline as do-not-deviate rules. Vo et al, arXiv:2509.15640 (2025), document the dictionary-augmented prompting protocol for medical English-Vietnamese specifically, and Azure AI Translator 2025-10-01-preview ships an "adaptive custom translation" mode that operationalizes the same idea on the Translator side.

**On the cross-check (Azure AI Translator) - Custom Translator deployment slot.** Generic Translator NMT is not hospital-tuned. Custom Translator allows training a deployment on (a) the hospital's historical English-target parallel discharge documents (if any), (b) the curated phrase dictionary of medications, conditions, procedures, anatomy, and dosing patterns, and (c) dynamic dictionaries per request for one-off terms. Microsoft documents typical BLEU lift of 5-10 points over generic NMT for a sufficiently trained domain model [Microsoft Learn - Custom Translator overview](https://learn.microsoft.com/en-us/azure/ai-services/translator/custom-translator/overview).

**The single source of truth is the glossary artifact** - one curated, version-controlled file in git, consumed by both levers, signed off by the hospital pharmacist and clinical informaticist. The model is the instrument; the glossary is the contract. [Confidence: HIGH on the architecture; MODERATE on the magnitude of lift, which must be empirically calibrated on the hospital's own corpus during HoK and the first quarterly bake-off.]

### 2.3 Per-language posture (this is the part the customer's CMO needs to see)

| Language | Primary | Cross-check | Human review |
|---|---|---|---|
| **Spanish** | LLM (Claude Sonnet 4.6 or GPT-5; pick on bake-off) with adaptive few-shot glossary | Azure Translator + Custom Translator | Risk-based sampling; mandatory on critical-error gate |
| **Mandarin (Simplified)** | LLM with regional-dialect prompt (Mainland vs Taiwan) | Azure Translator + Custom Translator | Mandatory until 50-doc cohort meets CTQS threshold; Wang 2026 supports moving toward sampling thereafter |
| **Vietnamese** | LLM with dictionary-augmented prompt (Vo et al arXiv 2509.15640 protocol) | Azure Translator | Mandatory; small-corpus equity case |
| **Arabic** | LLM with RTL-format-preserving prompt | Azure Translator | Mandatory; Wang 2026 shows LLM advantage but dosing-error case proves placeholder gating is non-negotiable |
| **Tagalog** | LLM (no NMT cross-check available at parity) | Optional 2nd LLM (GPT-5 vs Claude) for consensus | Mandatory; research-mode language |

**Confidence per row:** Spanish HIGH; Mandarin and Arabic MODERATE (upgraded from MODERATE/LOW based on Wang CJEM 2026, PMID 41533280); Vietnamese MODERATE (upgraded based on dictionary-augmented prompting protocol); Tagalog LOW (unchanged - no peer-reviewed discharge-specific evidence).

### 2.4 Strategic posture: building for where the models are going

The only durable architectural decision in 2026 is to assume the production translator will be replaced once a year for the next three years. The Custom Translator deployment slot abstraction was Microsoft's answer to that for NMT; the named-model-version pin + quarterly bake-off is the equivalent for LLMs. Build the bake-off harness as a first-class deliverable. The CTQS golden validation set (Section 5.2) is the bake-off arena. Cadence:

- **Quarterly:** rerun CTQS on the golden set against (a) currently deployed primary, (b) currently deployed cross-check, (c) two challenger frontier models, (d) Azure Translator's then-current default.
- **Flip rule:** swap the production primary when a challenger beats the incumbent by >=0.05 CTQS for two consecutive quarters across at least three languages, with no regression on critical-error rate.
- **Roll-back rule:** any incident-flagged clinical harm event triggers immediate revert to the previous primary plus full human review on all non-Spanish for 90 days.
- **Lock-in mitigation:** every artifact (system prompt, glossary, few-shot exemplars, evaluator rubric) is engine-agnostic by construction; only the model endpoint changes. Versioned in git; contract-tested on every model upgrade.

The customer is not choosing GPT-5 vs Claude 4.6 vs Translator-2025-10. They are choosing a process that makes that choice every quarter on calibrated evidence from their own discharge corpus. That is the answer to "today equal, tomorrow exceed."

[Confidence: HIGH on the framing; the cadence numbers are proposed defaults requiring customer buy-in.]

---

## 3. Formatting Preservation Strategy

The customer's pain is real: discharge papers contain medication tables, dose-frequency cells, headings, callout boxes, follow-up appointment grids. Mishandling format equals mishandling meaning.

### 3.1 Three layers of format preservation

**Layer 1 - Native document round-trip (Azure AI Document Translation).** Submit DOCX or PDF; receive translated DOCX or PDF with original styling, tables, headings, and embedded structure preserved [Microsoft Learn - supported formats](https://learn.microsoft.com/en-us/azure/ai-services/translator/document-translation/overview#supported-document-formats). This is the default path.

**Layer 2 - Structured intermediate representation.** For documents generated by the EHR (Epic, in the LSA Epic Showroom partnership pattern - see Section 8), convert to a structured intermediate (Markdown with locked sections, or XLIFF 2.x) before translation. XLIFF lets the translator distinguish translatable text from inline tags and placeholders, which protects medication codes, dose numerals, and lab reference ranges from being translated. [Confidence: HIGH - XLIFF is the OASIS standard and is supported by Azure Document Translation.]

**Layer 3 - Placeholder protection for critical numerals and codes.** Wrap all dose values, lab values, vital-sign numbers, ICD-10 codes, RxNorm codes, dates, and times in `<ph>` elements (or `{0}` placeholders) before translation. The translator never sees these as translatable text; they pass through unmodified. This is the difference between "take 5 mg" and "tomar 5 mg" surviving correctly versus a numeral being silently re-rendered or a unit being localized incorrectly. [Confidence: HIGH - standard MT engineering practice.]

### 3.2 What to validate post-translation (format-fidelity check)

Run a deterministic diff between source and target documents on:
- Heading count and heading levels.
- Table count, row count per table, column count per table.
- Cell-level numerals (regex pattern match on dose, dose unit, frequency).
- RxNorm/ICD code preservation (exact string match).
- Bullet count per list.
- Hyperlink target preservation.

This produces a **Format-Fidelity Score** in `[0, 1]` that becomes one term in the composite score (Section 5). Any divergence on critical-numeral preservation is an automatic critical-error gate failure.

---

## 4. Medical Terminology Handling

This is where the engagement either succeeds or quietly fails. Generic NMT and LLMs both translate "concussion" into Spanish as "concusión" by default; the clinically-correct Mexican/Central American term is "conmoción cerebral" - this exact issue surfaced in the BIDMC LLM study and was caught only because a clinician reviewed [Carreras Tartak 2026](https://formative.jmir.org/2026/1/e79676).

### 4.1 Terminology architecture

1. **Custom Translator phrase dictionary per language pair**, seeded from:
   - **[RxNorm](https://www.nlm.nih.gov/research/umls/rxnorm/)** for medications (NLM, public domain; cross-walk to target-language drug names where regional differences exist).
   - **[SNOMED CT US Edition](https://www.nlm.nih.gov/healthit/snomedct/us_edition.html)** for clinical findings, procedures, anatomy — free for US use under the NLM/IHTSDO Member License via UMLS. SNOMED Spanish (International Edition Spanish refset) and other-language branches are governed by [SNOMED International](https://www.snomed.org/) member NRCs; non-US deployments require an affiliate license. Vietnamese and Tagalog have no official SNOMED translation — build those glossaries from MedlinePlus + RxNorm + clinician review.
   - **[UMLS Metathesaurus](https://uts.nlm.nih.gov/uts/)** as the cross-language pivot for any concept where SNOMED is incomplete (free UMLS Terminology Services account, annual no-cost renewal).
   - **[MedlinePlus en español](https://medlineplus.gov/spanish/)** and **[MedlinePlus Connect](https://medlineplus.gov/connect/)** for patient-friendly target-language phrasing (NLM, public domain; Connect is a free EHR integration web service).
   - **Hospital pharmacy formulary** export, mapped to RxNorm.
   - Locally-curated regional preferences (e.g., Mexican Spanish "conmoción cerebral" preferred over "concusión"; Vietnamese diabetes phrasing "tiểu đường" vs "đái tháo đường" - the former is patient-friendly, the latter is clinical).

2. **Pre-translation entity tagging** (intake step). Use Azure AI Language **[Text Analytics for Health](https://learn.microsoft.com/en-us/azure/ai-services/language-service/text-analytics-for-health/overview)** (or a custom NER model) to tag medications, conditions, anatomy, procedures, and dose entities in the source. These tags drive both glossary lookup and the Clinical-Entity F1 metric (Section 5).

3. **Post-translation entity verification.** Run the same Text Analytics for Health entity recognition on the **back-translated** target text and compute F1 against the source-tagged entities. Any drop in entity F1 below threshold (proposed: 0.95 for medications, 0.90 for conditions) flags the segment for human review.

4. **Regional/dialect variants.** Maintain per-region overrides (e.g., Mexican vs Caribbean Spanish, Mainland vs Taiwanese Mandarin, Northern vs Southern Vietnamese). Discharge for a patient with documented language *and* country/region of origin should select the appropriate Custom Translator deployment slot.

### 4.2 Why this is opinionated and specific

A common failure mode is to bolt a glossary onto a generic translator after the fact. The defensible posture is: glossary is the contract, the model is the instrument. The phrase dictionary is the artifact the customer's pharmacist and clinical informaticist sign off on; the model is just the engine that honors it.

[Confidence: HIGH for the architecture; MODERATE for specific F1 thresholds, which need to be calibrated on the hospital's own validation set.]

---

## 5. Validation and Test Harness Design (the centerpiece)

This is the deliverable that converts the project from a demo into a defensible clinical implementation. Build it first.

### 5.1 The Clinical Translation Quality Score (CTQS)

The customer asked for a "98.4%" accuracy number. A single number is misleading. Replace it with a composite that gates on safety:

```
CTQS = w_safety  · SafetyScore
     + w_comet   · COMET_normalized
     + w_entity  · ClinicalEntityF1
     + w_back    · BackTranslationSemSim
     + w_format  · FormatFidelity

Default weights (calibrate on validation set):
  w_safety = 0.40   (gating term - dominant)
  w_comet  = 0.20
  w_entity = 0.15
  w_back   = 0.15
  w_format = 0.10
  Sum = 1.00

HARD GATE: Any MQM "critical" error -> CTQS = 0 (segment must go to human review).
```

**Component definitions:**

| Term | Range | Definition | Source / standard |
|---|---|---|---|
| **SafetyScore** | [0, 1] | LLM-as-judge (GPT-4o) score against a clinical rubric: meaning preservation, dose/medication preservation, omission, addition, mistranslation, terminology, register. Calibrated on a held-out human-graded set. | MQM error taxonomy [Lommel et al, Tradumàtica 2014](https://www.qt21.eu/mqm-definition/); MedJUDGE-style protocol |
| **COMET_normalized** | [0, 1] | Unbabel/wmt22-comet-da reference-based score, min-max normalized to [0,1] using language-specific calibration | [COMET model card](https://huggingface.co/Unbabel/wmt22-comet-da); validated against human MQM at WMT22 |
| **ClinicalEntityF1** | [0, 1] | F1 score on medication, condition, anatomy, procedure, and dose entities preserved between source and back-translation | Azure AI Language Text Analytics for Health |
| **BackTranslationSemSim** | [0, 1] | Cosine similarity between source-text embedding and back-translation embedding (multilingual sentence transformer) | Beaton et al forward-back protocol [Spine 2000](https://pubmed.ncbi.nlm.nih.gov/11124735/); ISO 17100:2015 |
| **FormatFidelity** | [0, 1] | Deterministic diff: heading count, table structure, numeral preservation, code preservation (defined in Section 3.2) | In-house |

**Action thresholds (calibrate, do not assume):**
- CTQS >= 0.90 AND no critical error: auto-publish (Spanish only after validation cohort sign-off).
- CTQS in [0.80, 0.90) OR any major error: route to human translator review.
- CTQS < 0.80 OR any critical error: hard-block; require professional translation.
- For Mandarin, Vietnamese, Arabic, Tagalog: route 100% to human review until local validation cohort demonstrates CTQS reliability across 50+ documents.

### 5.2 The golden validation set (build this on day 1 of HoK)

**Composition (target 50 documents per language, minimum 30):**
- 50% real de-identified discharge documents from the hospital, representative of top diagnoses (heart failure, pneumonia, diabetes, asthma, post-op orthopedic, OB).
- 25% synthetically constructed adversarial cases (medication-name confusables, dose-unit edge cases, negation patterns, "do not" phrasing, allergy warnings).
- 25% standardized public test sets adapted from WMT Biomedical Translation Task [WMT24 Biomedical](https://www2.statmt.org/wmt24/biomedical-translation-task.html), [Neves et al WMT 2023](https://aclanthology.org/2023.wmt-1.18/).

**Reference translations:** Two independent professional medical translators per language, blinded to source of competing AI translations (matches the Martos 2025 evaluation design [JAMA 2025](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2839035)). Reconciled reference is the gold target.

**Annotation rubric:** 5-point Likert on fluency, adequacy, meaning, error severity, and **completeness** (the 5-domain rubric, combining the JAMA 4-domain protocol with the JMIR Brewster/Carreras Tartak completeness domain) [Carreras Tartak 2026](https://formative.jmir.org/2026/1/e79676). Two annotators per segment; report inter-annotator agreement (Krippendorff's alpha or Cohen's kappa).

**Adverse-event review:** A clinician reviews all flagged "critical error" segments for actual clinical impact (would this cause harm if delivered to a patient?). This produces the **clinically-impactful error rate**, the metric that matters most to the CMO.

### 5.3 What the customer's "98.4%" actually maps to

Frame the customer's accuracy ambition as: *"Of all auto-published segments (those that passed the CTQS gate), the rate of clinically-impactful errors must be below X%."* For Spanish, X = 1% is reachable based on the JAMA noninferiority results (with mandatory critical-error gating) [Martos 2025](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2839035). For Mandarin, Vietnamese, Arabic, Tagalog, the rate is currently unknown and must be measured before any auto-publish decision. [Confidence: HIGH on framing; MODERATE on the 1% Spanish target - calibrate against the hospital's own cohort.]

### 5.4 Continuous evaluation in production

- Sample 5% of all production translations for shadow human review (rotating).
- Track CTQS distribution by language, document type, and translator deployment version.
- Drift detection: alert when monthly CTQS mean falls more than 1 standard deviation below baseline.
- Quarterly re-training of Custom Translator with newly-reviewed parallel documents.
- Ties into FDA "Predetermined Change Control Plan" governance [FDA PCCP guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/marketing-submission-recommendations-predetermined-change-control-plan-artificial-intelligence) if the system is later determined to be a SaMD.

---

## 6. Recommended Agentic Workflow (text diagram, agent by agent)

Built on **Azure AI Foundry Agent Service** with Connected Agents, Semantic Kernel `AzureAIAgent` orchestration, MCP tools where appropriate [Microsoft Learn - Foundry Agent Service](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/overview).

```
[EHR / Epic]
   |
   |  HL7 FHIR DocumentReference (DischargeSummary)
   v
+---------------------------------------------------------------+
| Agent 1: INTAKE / DE-PHI / STRUCTURE EXTRACTOR                |
| - Pulls DocumentReference via FHIR (Azure Health Data         |
|   Services)                                                   |
| - Detects PHI; routes to private network only                 |
| - Detects source language; confirms English                   |
| - Detects patient's preferred language and region from        |
|   Patient resource (Joint Commission requirement)             |
| - Extracts structured intermediate (Markdown + XLIFF) with    |
|   placeholders for doses, codes, dates                        |
| - Tags clinical entities via Text Analytics for Health        |
| Output: structured XLIFF + entity manifest + target language  |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
| Agent 2a: PRIMARY TRANSLATOR (frontier LLM)                   |
| - Claude Sonnet 4.6 on Foundry OR GPT-5 family in US Data     |
|   Zone (per-language slot, picked by quarterly bake-off)      |
| - System prompt: medical glossary inline, regional dialect,   |
|   reading-level ceiling, do-not-translate rules, XLIFF        |
|   placeholder respect                                         |
| - Adaptive few-shot: 3-5 hospital reference translations      |
|   injected per request (vector-retrieved by source-segment    |
|   similarity)                                                 |
| - Structured output: translated XLIFF preserving placeholders |
| Output: translated XLIFF (LLM)                                |
+---------------------------------------------------------------+
                              | (parallel call)
+---------------------------------------------------------------+
| Agent 2b: CROSS-CHECK TRANSLATOR (Azure AI Translator)        |
| - 2025-10-01-preview hybrid mode OR classical NMT + Custom    |
|   Translator deployment slot                                  |
| - Same XLIFF input, parallel call to 2a                       |
| - Same hospital glossary artifact                             |
| - Output goes to Agent 4 alongside Agent 2a output            |
| Output: translated XLIFF (NMT/hybrid)                         |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
| Agent 3: TERMINOLOGY VALIDATOR                                |
| - For each entity in the manifest, verifies target-language   |
|   rendering against RxNorm/SNOMED/UMLS cross-walk             |
| - Re-runs Text Analytics for Health on translated text and    |
|   computes ClinicalEntityF1                                   |
| - Flags any medication, dose, or allergy term that does not   |
|   round-trip                                                  |
| Output: terminology validation report; flagged segments       |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
| Agent 4: EVALUATOR + CONSENSUS ARBITER (the test-harness)     |
| - Receives both 2a (LLM) and 2b (Translator) XLIFF outputs    |
| - Back-translates each target -> English via an independent   |
|   engine (Azure OpenAI GPT-4o with deterministic prompt)      |
| - Computes BackTranslationSemSim per candidate                |
| - If a reference translation exists for this segment in the   |
|   golden set: computes COMET per candidate                    |
| - If no reference: computes CometKiwi (reference-free)        |
| - LLM-as-judge SafetyScore per candidate against the 5-domain |
|   rubric and MQM error taxonomy (GPT-4o, structured JSON)     |
| - FormatFidelity diff per candidate (Section 3.2)             |
| - Computes CTQS per candidate                                 |
| - Consensus arbiter: picks the higher-CTQS candidate; flags   |
|   disagreement above threshold for human review; routes ties  |
|   or both-low to the Human-Review Gateway                     |
| Output: chosen translation, CTQS, per-component scores,       |
|   per-engine scores, error tags, disagreement flag            |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
| Agent 5: HUMAN-REVIEW GATEWAY (the policy enforcer)           |
| - If language in {Mandarin, Vietnamese, Arabic, Tagalog} ->   |
|   route to human translator (mandatory until validated)       |
| - Else if any MQM critical error -> hard block, route human   |
| - Else if CTQS < 0.80 -> route to human                       |
| - Else if CTQS in [0.80, 0.90) -> route to human review       |
| - Else CTQS >= 0.90 -> auto-publish                           |
| - Logs decision rationale to audit store (immutable)          |
| - Posts back to EHR as Communication or DocumentReference     |
|   resource                                                    |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
| Cross-cutting:                                                |
| - Azure Monitor + App Insights for telemetry                  |
| - Microsoft Purview for data classification + lineage         |
| - Microsoft Sentinel for security monitoring                  |
| - Audit log: every translation, every CTQS, every human       |
|   override - retained per HIPAA (6 yr) and Section 1557       |
|   recordkeeping                                               |
+---------------------------------------------------------------+
```

[Confidence: HIGH on architecture; MODERATE on the specific Foundry Connected-Agents wiring details, which depend on the customer's Azure AI Foundry tenant configuration.]

---

## 7. Regulatory and Safety Guardrails

Treat this as a clinical-communication system with potential SaMD adjacency, not as a productivity tool. The customer's General Counsel will ask these questions:

### 7.1 Section 1557 (ACA, May 2024 Final Rule)

- **Effective date:** July 5, 2024 [89 FR 37522](https://www.federalregister.gov/documents/2024/05/06/2024-08711/nondiscrimination-in-health-programs-and-activities).
- **Qualified translator requirement:** Written translations of vital documents must be performed by a "qualified translator." AI alone has not been certified as qualified by HHS OCR. **Implication: human-in-the-loop is mandatory.** Document the human reviewer credentials per language. [HHS OCR](https://www.hhs.gov/civil-rights/for-individuals/section-1557/index.html)
- **AI nondiscrimination provision (45 CFR 92.210):** Covered entities must take reasonable steps to identify and mitigate risk of discrimination from "patient care decision support tools." A discharge translator is plausibly an adjacent system. Posture: maintain risk register, periodic disparate-performance audit by language, document mitigations. (The provision-effective date for the AI tool requirement is May 1, 2025 per the rule's tiered applicability.)
- **1557 Coordinator:** Identify the hospital's 1557 Coordinator and route this implementation through them.

### 7.2 HIPAA / BAA

- Azure AI Translator, Azure OpenAI, Azure AI Foundry, Azure Health Data Services, and Azure AI Language are all covered under Microsoft's HIPAA BAA via the DPA [Microsoft Trust Center HIPAA](https://www.microsoft.com/en-us/trust-center/compliance/hipaa).
- **Azure OpenAI specific configuration:** customer data is not used for training; opt out of human abuse-monitoring review for HIPAA covered entities (requires application) [Azure OpenAI data privacy](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy).
- Network: Private Endpoints on every Azure AI service; no public endpoints. Customer-managed keys (CMK) on storage.
- De-identification at intake (Agent 1) using Text Analytics for Health PHI detection. Where possible, re-identify only at delivery agent.

### 7.3 FDA / SaMD posture

- A discharge-translation system is not currently a clearly-classified SaMD, but FDA's January 2025 draft guidance on AI-enabled device software [FDA AI-enabled SaMD draft 2025](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/artificial-intelligence-enabled-device-software-functions-lifecycle-management-and-marketing) indicates an expanding scope.
- Conservative posture: implement a Predetermined Change Control Plan-style governance even if classification is unclear [FDA PCCP final guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/marketing-submission-recommendations-predetermined-change-control-plan-artificial-intelligence). This means: pre-defined retraining cadence, pre-defined performance thresholds for re-validation, pre-defined rollback triggers.
- This protects the hospital if the classification later shifts. [Confidence: MODERATE - FDA position is evolving.]

### 7.4 Joint Commission

- Document the patient's preferred language and the format in which they receive health information per Joint Commission Patient-Centered Communication standards (PC.02.01.21, RC.02.01.01) [Joint Commission FAQ](https://www.jointcommission.org/standards/standard-faqs/).
- Audit trail: every translation must record translator identity (AI engine version + Custom Translator deployment slot ID + human reviewer if any).

### 7.5 Bias and equity audit

- Quarterly disparate-performance audit: CTQS distribution by language, by patient demographics, by document type. If Mandarin or Tagalog systematically scores below Spanish, that is an equity finding to remediate, not just a tech metric.
- This is required in spirit by Section 1557's nondiscrimination provision; doing it proactively is the defensible posture.

---

## 8. Published Precedent (Microsoft and external)

### 8.1 Peer-reviewed clinical evidence

- **Martos M, Fields B, Finlayson SG et al. Accuracy of Artificial Intelligence vs Professionally Translated Discharge Instructions. JAMA Network Open. 2025;8(9):e2532312. doi:10.1001/jamanetworkopen.2025.32312.** Used the **Azure AI** neural translation system on real patient-specific pediatric inpatient discharge instructions at Seattle Children's; 148 sections from 34 discharge documents in Spanish, Simplified Chinese, Vietnamese, Somali. Spanish AI noninferior to professional translation in adequacy (difference 0.08; 95% CI -0.02 to 0.19) and error severity (difference 0.03; 95% CI -0.09 to 0.14); inferior in fluency; just crossed inferiority threshold in meaning. Chinese, Vietnamese, Somali inferior across all metrics. [JAMA Network Open](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2839035)
- **Carreras Tartak J, Brewster RCL et al. Use of LLM for ED Discharge Instruction Translation. JMIR Formative Research. 2026. doi:10.2196/79676.** Beth Israel Deaconess used Claude Sonnet 3.5 on a PHI-compliant cloud for Spanish ED discharge instructions; 5-domain rubric (completeness, fluency, meaning, severity, overall); mean 4.8-5.0; iteratively-developed prompt. [JMIR Form Res](https://formative.jmir.org/2026/1/e79676)
- **Brewster RCL et al. Performance of ChatGPT and Google Translate for Pediatric Discharge Instruction Translation. Pediatrics. 2024;154(1):e2023065573.** Found that LLM-based translation had higher serious-error rates than NMT for some pediatric discharge passages; reinforces the case for NMT-primary plus LLM-evaluator design. [Pediatrics](https://publications.aap.org/pediatrics/article/154/1/e2023065573/197086)
- **Khoong EC, Steinbrook E, Brown C, Fernandez A. JAMA Internal Medicine. 2019;179(4):580.** Foundational ED-discharge translation accuracy study: Google Translate Spanish 92%, Chinese 81%; some errors clinically dangerous. [JAMA Intern Med](https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2725080)

### 8.2 Microsoft platform precedent

- **Microsoft Cloud for Healthcare reference architecture** - patient data, FHIR ingestion, AI services on Azure under one industry cloud [Microsoft Learn](https://learn.microsoft.com/en-us/industry/healthcare/architecture/overview).
- **Azure AI Foundry Agent Service - Connected Agents and multi-agent orchestration** [Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/overview).
- **Language Service Associates (LSA) on the Epic Showroom** as a partner integration pattern for human-translator-on-demand workflow [Epic Showroom](https://showroom.epic.com/).
- **Seattle Children's published their Azure AI translation evaluation** (JAMA 2025 above) and their CMIO publicly discussed the work [Clara Lin LinkedIn](https://www.linkedin.com/posts/clara-lin-md-2aa507246_accuracy-of-ai-vs-professionally-translated-activity-7377724581966573568-jCWs) - this is the strongest customer-facing reference for "another major US pediatric hospital ran this evaluation using Azure."

[Confidence: HIGH on the existence and findings of these precedents; MODERATE on direct applicability of Microsoft Cloud for Healthcare to this specific use case, since published case studies focus on data and operations rather than translation.]

---

## 9. Hack on Keyboard Day Plan (what to build first)

**Principle: build the test harness first, the translator second.** A working test harness with even a stock translator behind it is more valuable to the customer than a beautiful translator with no validation.

### Hour 0-1 - Discovery and decisions
- Confirm top 5 languages (Spanish, Vietnamese, Mandarin, Arabic, Tagalog assumed; verify priority).
- Get 10 sample de-identified discharge documents from the hospital (or use synthetic equivalents).
- Decide on Custom Translator vs generic translator for HoK demo (likely generic for HoK, Custom Translator as the production roadmap).

### Hour 1-3 - Build the test harness skeleton (Agent 4 first)
- Provision Azure OpenAI (GPT-4o) and Azure AI Translator in the hospital's test subscription.
- Build the Evaluator agent: input English source + target translation, output CTQS components.
- Implement the LLM-as-judge SafetyScore prompt against the 5-domain rubric (with structured JSON output).
- Implement BackTranslationSemSim (sentence transformer of choice, run locally).
- Implement FormatFidelity diff.
- Implement COMET via the Unbabel/wmt22-comet-da model card (run locally on a small VM if needed).

### Hour 3-5 - Wire dual-engine translation: primary LLM call + parallel Translator cross-check
- Wire Agent 2a: frontier LLM (Claude Sonnet 4.6 on Foundry, or GPT-5 in US Data Zone) with the system prompt, glossary inline, and adaptive few-shot exemplars; structured XLIFF output preserving placeholders.
- Wire Agent 2b: Azure AI Translator (2025-10-01-preview hybrid mode if available in the customer's tenant; otherwise classical Document Translation + Custom Translator) consuming the same XLIFF in parallel.
- Both outputs flow into Agent 4 (Evaluator + Consensus Arbiter), which scores each candidate on CTQS and picks the higher score, routes disagreement-above-threshold and both-low cases to the Human-Review Gateway.
- Implement XLIFF round-trip with placeholder protection for doses, codes, and dates on both paths.

### Hour 5-7 - Wire the orchestration in Foundry Agent Service
- Two agents minimum (Translator, Evaluator); add Intake and Human-Review-Gateway as stubs that log and route.
- Connected Agents pattern.

### Hour 7-8 - Run the demo on the sample documents
- Translate to Spanish, Mandarin, Vietnamese on the dual-engine pipeline.
- Show CTQS dashboard with per-component scores **per engine** (Agent 2a LLM vs Agent 2b Translator), the chosen candidate, and the disagreement delta.
- Stage four explicit demo cases that show the architecture earning its keep:
  1. **Agreement / auto-publish:** one document where LLM and NMT agree within threshold and CTQS is high - the consensus arbiter picks the higher-scoring candidate and the Human-Review Gateway auto-publishes (Spanish).
  2. **Disagreement, LLM wins:** one document where the two engines diverge and the LLM scores meaningfully higher on CTQS (Mandarin or Arabic, consistent with Wang CJEM 2026); the arbiter selects the LLM output.
  3. **Disagreement, escalate to human:** one document where the engines disagree above the disagreement-flag threshold and neither scores cleanly above the auto-publish gate; Agent 4 routes to the Human-Review Gateway.
  4. **Critical-numeral hallucination caught:** one document where the LLM silently re-renders a dose numeral (or fails an XLIFF placeholder); the placeholder-fidelity gate hard-blocks regardless of the rest of the score and the document is routed to human review with the offending segment highlighted.

### Hour 8 - Hand-off deliverables
1. Working code (private repo).
2. CTQS specification (Section 5.1 of this doc, expanded with the calibration values used).
3. Sample translated discharge documents.
4. CTQS dashboard report on the 10 sample documents.
5. 30-60-90 day roadmap: Custom Translator training, golden validation set construction, Section 1557 Coordinator engagement, FHIR integration with Epic.

**What NOT to do at HoK:** Do not promise a single "98.4%" number. Promise the harness that will produce a defensible per-language number after a calibrated cohort of 30-50 documents has been processed. [Confidence: HIGH - this is the only honest framing.]

---

## 10. Open Questions for the Customer

These are the questions whose answers reshape the architecture. Resolve them in the first hour of HoK if possible.

1. **Top 5 languages by patient volume - confirmed?** The plan assumes Spanish, Vietnamese, Mandarin, Arabic, Tagalog. Is the actual list different (Russian, Haitian Creole, Somali, Cantonese, Karen)?
2. **Document source format.** Is the discharge generated from the EHR as a structured FHIR DocumentReference, as a Word template, as a PDF, or as free text in the after-visit summary? Each implies a different intake path.
3. **Existing parallel corpus.** Does the hospital have any existing English-target language professionally-translated discharge documents that could seed Custom Translator training? Even 100 high-quality pairs per language is meaningfully better than zero.
4. **Volume.** Documents per day per language? This shapes whether Document Translation async or synchronous mode applies, and whether human-review capacity is realistic for non-Spanish.
5. **Existing translation vendor relationship.** Is there an incumbent professional translation service (e.g., LSA, LanguageLine)? They become the human-review tier in the gateway; do not displace them.
6. **EHR.** Epic, Oracle Health (Cerner), MEDITECH, other? Drives the FHIR or HL7 v2 integration path.
7. **Section 1557 Coordinator.** Who is it, and have they been brought into this conversation? Required.
8. **Risk tolerance for auto-publish.** Will the CMO accept auto-publish for Spanish at all, or is human review mandatory on every document, period? This is a policy choice, not a technical one.
9. **Reading-level target.** Should the system also enforce a target-language readability ceiling (e.g., 6th-grade reading level)? Adds an LLM rewrite step inside Agent 2.
10. **PHI handling.** Is the BAA in place for Azure OpenAI Service (separately from the Microsoft enterprise agreement)? Has abuse-monitoring opt-out been requested?
11. **Validation effort.** Is the hospital prepared to fund 50 documents per language of professional reference translation for the golden validation set? This is the rate-limiting investment.
12. **Operational ownership.** Who owns the system in production - IT, the language services department, the office of health equity, or a joint structure?

---

## 11. Conclusion (causal reasoning - the why, not just the what)

The hospital's request to translate discharge papers with format preservation, near-zero meaning loss, and a quantified accuracy score is technically achievable on Azure today **for Spanish** and is achievable **with mandatory human-in-the-loop** for Mandarin, Vietnamese, Arabic, and Tagalog. The reason for the asymmetry is not the choice of cloud or model - it is the underlying training-data distribution and the reality that current AI systems remain less reliable on languages of lesser diffusion, as JAMA Network Open's Seattle Children's evaluation directly demonstrated [Martos 2025](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2839035).

The defensible architecture is therefore not "pick the best translator" but **"pick a safe translator and pair it with a rigorous validator that gates safety-critical outputs."** Azure AI Document Translation + Custom Translator is the safe translator (deterministic, format-preserving, glossary-enforcing, peer-reviewed in clinical context). Azure OpenAI GPT-4o is the rigorous validator (back-translation, LLM-as-judge, structured-output error tagging). Azure AI Foundry orchestrates them as connected agents with a Human-Review Gateway that enforces Section 1557's qualified-translator obligation.

The "98.4%" target should be reframed as the **Clinical Translation Quality Score** with a hard critical-error gate. The number that the hospital should publish to its board and to its General Counsel is not a single accuracy percentage; it is *"the clinically-impactful error rate among auto-published segments, by language."* For Spanish, this is plausibly below 1% with the proposed design; for the other languages it is currently unknown and must be measured before any auto-publish decision.

**Pre-mortem (what could go wrong):**
1. *Confirmation bias on Spanish results overgeneralized to other languages* - this is the single largest risk. Mitigation: hard-block auto-publish for non-Spanish until each language has its own validated cohort.
2. *Format drift on long documents (>5 pages)* - the JAMA study used short pediatric discharge sections, not 20-page complex discharges. Mitigation: chunk-and-stitch with structural diff; require human review for any document where FormatFidelity drops below 0.95.
3. *Custom Translator under-trained because hospital lacks parallel corpus* - if the hospital cannot fund the reference-translation phase, fall back to phrase-dictionary-only Custom Translator and acknowledge the lower ceiling.
4. *Section 1557 enforcement evolves* - HHS OCR may issue further guidance defining whether AI-assisted translation qualifies. Mitigation: maintain human-in-the-loop posture until explicit guidance permits otherwise.

**Residual risks acknowledged:** No published evidence on Tagalog or Arabic discharge instructions specifically; FDA SaMD position evolving; CTQS weights are proposed defaults that require empirical calibration on the hospital's own validation set.

> **Recommendation:** Walk into the hospital with this two-engine, five-agent, harness-first plan. Lead with the test harness. Earn the right to scale by producing the first defensible per-language CTQS report on a 30-50 document cohort. Do not promise a single accuracy percentage; promise an auditable, measurable, language-stratified safety profile.

---

## Sources

1. Martos M, Fields B, Finlayson SG, Hartell N, Kim T, Larimer E, Lau JJ, Lin YH, Salaguinto T, Tran N, Lion KC. Accuracy of Artificial Intelligence vs Professionally Translated Discharge Instructions. JAMA Network Open. 2025;8(9):e2532312. doi:10.1001/jamanetworkopen.2025.32312. PMID 40960827. https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2839035
2. Carreras Tartak JA, Brewster RCL et al. Use of a Large Language Model for Translation of Emergency Department Discharge Instructions. JMIR Formative Research. 2026. doi:10.2196/79676. https://formative.jmir.org/2026/1/e79676
3. Khoong EC, Steinbrook E, Brown C, Fernandez A. Assessing the Use of Google Translate for Spanish and Chinese Translations of Emergency Department Discharge Instructions. JAMA Internal Medicine. 2019;179(4):580. https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2725080
4. Brewster RCL et al. Performance of ChatGPT and Google Translate for Pediatric Discharge Instruction Translation. Pediatrics. 2024;154(1):e2023065573. https://publications.aap.org/pediatrics/article/154/1/e2023065573/197086
5. Beaton DE, Bombardier C, Guillemin F, Ferraz MB. Guidelines for the process of cross-cultural adaptation of self-report measures. Spine. 2000;25(24):3186-3191. https://pubmed.ncbi.nlm.nih.gov/11124735/
6. ISO 17100:2015 Translation services - Requirements for translation services. International Organization for Standardization. https://www.iso.org/standard/59149.html
7. Department of Health and Human Services, Centers for Medicare and Medicaid Services. Nondiscrimination in Health Programs and Activities. Final Rule. 89 FR 37522. May 6, 2024. Effective July 5, 2024. https://www.federalregister.gov/documents/2024/05/06/2024-08711/nondiscrimination-in-health-programs-and-activities
8. HHS Office for Civil Rights. Section 1557 of the Patient Protection and Affordable Care Act. https://www.hhs.gov/civil-rights/for-individuals/section-1557/index.html
9. U.S. Food and Drug Administration. Marketing Submission Recommendations for a Predetermined Change Control Plan for Artificial Intelligence-Enabled Device Software Functions. Final Guidance, December 2024. https://www.fda.gov/regulatory-information/search-fda-guidance-documents/marketing-submission-recommendations-predetermined-change-control-plan-artificial-intelligence
10. U.S. Food and Drug Administration. Artificial Intelligence-Enabled Device Software Functions: Lifecycle Management and Marketing Submission Recommendations. Draft Guidance, January 2025. https://www.fda.gov/regulatory-information/search-fda-guidance-documents/artificial-intelligence-enabled-device-software-functions-lifecycle-management-and-marketing
11. The Joint Commission. Standards FAQ - Patient-Centered Communication. https://www.jointcommission.org/standards/standard-faqs/
12. HHS. HIPAA Privacy, Security, and Breach Notification Rules. 45 CFR Parts 160, 162, and 164. https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html
13. Microsoft Learn. Azure AI Translator - Document Translation overview. https://learn.microsoft.com/en-us/azure/ai-services/translator/document-translation/overview
14. Microsoft Learn. Azure AI Translator - Custom Translator overview. https://learn.microsoft.com/en-us/azure/ai-services/translator/custom-translator/overview
15. Microsoft Learn. Azure OpenAI Service - data, privacy, and security. https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy
16. Microsoft Learn. Azure AI Foundry Agent Service overview. https://learn.microsoft.com/en-us/azure/ai-foundry/agents/overview
17. Microsoft Learn. Microsoft Cloud for Healthcare reference architecture. https://learn.microsoft.com/en-us/industry/healthcare/architecture/overview
18. Microsoft Learn. Azure Health Data Services - FHIR service. https://learn.microsoft.com/en-us/azure/healthcare-apis/fhir/overview
19. Microsoft Trust Center. HIPAA / HITECH Act compliance. https://www.microsoft.com/en-us/trust-center/compliance/hipaa
20. Epic Showroom. Translation services partner directory. https://showroom.epic.com/
21. Rei R, Stewart C, Farinha AC, Lavie A. COMET: A Neural Framework for MT Evaluation. EMNLP 2020. Unbabel/wmt22-comet-da model card. https://huggingface.co/Unbabel/wmt22-comet-da
22. Guerreiro NM, Rei R, van Stigt D, Coheur L, Colombo P, Martins AFT. xCOMET: Transparent Machine Translation Evaluation through Fine-grained Error Detection. Transactions of the Association for Computational Linguistics. 2024. https://aclanthology.org/2024.tacl-1.54/
23. Lommel A, Burchardt A, Uszkoreit H. Multidimensional Quality Metrics (MQM): A Framework for Declaring and Describing Translation Quality Metrics. Tradumàtica. 2014. https://www.qt21.eu/mqm-definition/
24. Freitag M, Foster G, Grangier D, Ratnakar V, Tan Q, Macherey W. Experts, Errors, and Context: A Large-Scale Study of Human Evaluation for Machine Translation. TACL. 2021. https://aclanthology.org/2021.tacl-1.87/
25. WMT24 Biomedical Translation Task. https://www2.statmt.org/wmt24/biomedical-translation-task.html
26. Neves M et al. Findings of the WMT 2023 Biomedical Translation Shared Task. WMT 2023. https://aclanthology.org/2023.wmt-1.18/
27. National Library of Medicine. Unified Medical Language System (UMLS). https://www.nlm.nih.gov/research/umls/index.html
28. PubMed citation for Martos 2025. PMID: 40960827. https://pubmed.ncbi.nlm.nih.gov/40960827/
29. Lin C. Vice President and CMIO, Seattle Children's. Public discussion of JAMA AI translation publication. LinkedIn. https://www.linkedin.com/posts/clara-lin-md-2aa507246_accuracy-of-ai-vs-professionally-translated-activity-7377724581966573568-jCWs
30. Wang [authors], et al. ChatGPT-4 vs Google Translate for Pediatric ED Discharge Instructions in Arabic and Simplified Chinese. *CJEM*. Jan 14 2026. PMID 41533280. https://pubmed.ncbi.nlm.nih.gov/41533280/
31. Rosenberg M [editorial]. Large Language Models and the Emergency Department LEP Patient. *CJEM*. April 16 2026.
32. Asgari E, et al. Hallucination and Omission in LLM Clinical Summarization After Refinement. *npj Digital Medicine*. 2025.
33. Microsoft. Claude Sonnet 4.6 and Opus 4.6 Generally Available in Microsoft Foundry for Healthcare. Microsoft Industry Cloud Blog, January 11, 2026.
34. Microsoft Learn. Azure AI Translator 2025-10-01-preview - LLM choice, adaptive custom translation, hybrid NMT+LLM. https://learn.microsoft.com/en-us/azure/ai-services/translator/
35. WMT 2025 General Machine Translation Task - Findings: "Time to Stop Evaluating on Easy Test Sets." Suzhou, Nov 5-9 2025.
36. WMT 2025 Multilingual Instruction Task - Findings: "Persistent Hurdles."
37. WMT 2025 Evaluation Task - Findings: "Linguistic Diversity is Challenging and References Still Help."
38. Vo [authors], et al. Dictionary-Augmented Prompting for Low-Resource Medical English-Vietnamese Translation. arXiv:2509.15640. 2025.
39. Rao [authors], et al. PrIME-LLM: Prescription Instruction Multilingual Evaluation. *JAMA Network Open*. 2026.
40. [Authors]. Capabilities of GPT-5 on Multimodal Medical Reasoning. arXiv:2508.08224. August 2025.
41. Azure / OpenAI. GPT-5 family pricing on Azure Foundry US Data Zone (flagship $1.25/$10; mini $0.25/$2; nano $0.05/$0.40 per 1M tokens). Azure pricing reference, accessed 2026-05-09.

---

*Prepared for Adam Workman, Microsoft Principal Solutions Engineer, US HLS STU Cloud and AI. Date of access for all web sources: 2026-05-09. All claims grounded in cited sources; methodology follows the Beaton/ISO forward-back protocol and the JAMA/JMIR five-domain clinical-translation rubric. Composite Clinical Translation Quality Score weights are proposed defaults requiring empirical calibration on hospital data.*
