# HoK Red-Team and Pre-Mortem

**Engagement:** US hospital — multilingual discharge translation use case
**Architecture:** Foundry Agent Service + AOAI US Data Zone + dual-engine translation + CTQS validation harness (refs: ask1, ask2, ask3)
**Date prepared:** 2026-05-09
**Author:** Pre-mortem for Adam Workman, Principal SE, US HLS STU

---

## How to use this doc

This is a pre-mortem, not a checklist. The premise: imagine the HoK has already happened and it failed. Why did it fail? Each section below is one of those failure stories, with the mitigation you do **before** arrival and the fallback you execute **on the day** if the mitigation didn't take.

The single most important page is Section 7 — the "smallest deliverable that still wins" floor. If everything else goes wrong, that's the demo you ship.

---

## 1. Pre-arrival blockers (resolve in the next 72 hours)

These are the failures that don't recover on the day. If any of these is unresolved when you walk in the door, the HoK becomes a discovery session, not a build session. Treat the next 72 hours as the real work.

### 1.1 Tenant not Foundry-enabled or AOAI quota not provisioned in US Data Zone
**Likelihood:** HIGH. Most healthcare customers have AOAI in some region but not specifically Data Zone Standard / Provisioned in their preferred US region for the model versions in ask1.
**Impact:** Day-killer. You cannot deploy anything.
**Mitigate now:** 48h before arrival, run `az cognitiveservices account list-models` against their tenant for the target region. Confirm GPT-5.1, GPT-5-mini, and Claude Sonnet 4.6 deployment availability. If gaps exist, either (a) get them to file a quota request now (typically 24–72h), or (b) pivot the model selection to what *is* available and reflect it in ask1 §3a.
**Fallback on the day:** Use a Microsoft demo tenant for the build, hand the customer a deployable bicep/terraform pack at the end. Demo runs; production deploy is a follow-up week.

### 1.2 BAA not in place or abuse-monitoring not opted-out for PHI
**Likelihood:** MEDIUM. EA/MCA/CSP customers get HIPAA BAA automatically under the Microsoft DPA, but the abuse-monitoring opt-out for PHI is a separate Microsoft form (`aka.ms/oai/additionalusecase`) requiring 5–15 business days approval.
**Impact:** Cannot legally process real discharge documents during HoK.
**Mitigate now:** Confirm BAA status with the customer's account team this week. File the abuse-monitoring opt-out form **today** if it isn't already filed. Confirm in writing.
**Fallback on the day:** Use synthetic discharge documents only (you should bring a set regardless — see 1.4). Demo is technically valid; "real PHI" comes after the form approval lands.

### 1.3 Hospital InfoSec stance: "no public PaaS"
**Likelihood:** MEDIUM-HIGH for hospitals. They will accept Azure but demand private endpoints for everything, no public network access, sometimes no Foundry portal access (only API).
**Impact:** Day eaten by networking. Foundry Agent Service portal access requires either public endpoint or Bastion + Private Link.
**Mitigate now:** Ask the customer's network architect this week for: (a) is private endpoint mandated for control plane and data plane, (b) is there an existing AVD/Bastion path you can use, (c) what is the egress policy for outbound calls to model endpoints.
**Fallback on the day:** Build in a Microsoft sandbox subscription with public endpoints for the demo. The architecture in ask1 §3 is already private-endpoint-ready — show the design, deploy to public for the demo, and migrate after the engagement.

### 1.4 Customer can't produce sample discharge documents
**Likelihood:** HIGH. Hospital legal will balk at handing PHI to a vendor. De-identification of even five real discharge documents takes 1–3 days through their compliance process.
**Impact:** Hour 1 stalls. No source documents = no demo.
**Mitigate now:** Build a pack of 10 synthetic discharge documents yourself. Cover: ED discharge with med list, post-op discharge with wound care, OB discharge with newborn instructions, cardiac discharge with red-flag symptoms, behavioral health discharge. Use Synthea-style synthetic data plus realistic formatting. Bring on a USB and have them in a private GitHub repo.
**Fallback on the day:** Use your synthetic pack. If the customer wants to "see it on real data," do a screen-share session with one of their clinicians driving — document never leaves their environment, your pipeline is invoked from a notebook in their tenant.

### 1.5 Wrong people in the room
**Likelihood:** HIGH. The default invite list is "their IT/cloud team plus their AI lead." That builds the platform. It does not give you a production path.
**Impact:** You can build but cannot get sign-off on glossary, critical-error categories, auto-publish thresholds, or per-language posture. Deliverable is "cool demo," not "production roadmap."
**Mitigate now:** Push hard for the following to be in the room (or available by Teams) for at least Hour 0–1 and Hour 7–8: a **clinician** (CMIO or designate), a **clinical informaticist**, the **language access services** lead, **compliance/legal** (Section 1557 specialist if they have one), and the **pharmacist** who will own the formulary glossary. If you cannot get clinical, you cannot finalize the critical-error category list — flag this in writing now.
**Fallback on the day:** Schedule a follow-up clinical workshop within two weeks. Build the technical deliverable; mark all clinical-decision items as "open" with a recommended default and a clinical-signoff line.

### 1.6 Custom Translator provisioning latency
**Likelihood:** MEDIUM. Custom Translator deployment slots can take 1–4 hours to provision and sometimes longer for the first dictionary upload.
**Impact:** Hour 3–5 (translator wiring) blocks waiting for deployment.
**Mitigate now:** Pre-create a dummy Custom Translator workspace and deployment slot in your demo subscription this week. On the day, hot-swap the dictionary; don't deploy from cold.
**Fallback on the day:** Skip Custom Translator for the demo. Use Translator's `2025-10-01-preview` LLM-augmented mode with the glossary injected as adaptive few-shot. Document the Custom Translator setup as a Phase-2 deliverable.

### 1.7 Existing translation vendor in the room
**Likelihood:** MEDIUM. LanguageLine, CyraCom, or Propio is probably their incumbent. Their account exec may show up to defend their book of business.
**Impact:** Politicized demo. They'll argue "AI isn't a qualified translator under Section 1557," which is technically true.
**Mitigate now:** Pre-position the framing with the hospital sponsor: "AI is the human translator amplifier — handles the 80% volume routine cases, frees the human translators for the 20% complex/critical." Not replacement.
**Fallback on the day:** Concede the framing publicly: "Section 1557 is right; that's why every output above the auto-publish threshold goes to your existing qualified translators for sign-off — we're routing volume, not replacing judgment." Win the room by being the most realistic person in it.

---

## 2. Hour-by-hour failure modes

Mapped to the day plan in ask2 §9 and the MVP in ask3 §13.

### 2.1 Hour 0–1 — Discovery and decisions

**Failure A: Customer wants 12 languages on day one.**
*Mitigation:* Drive them to the LEP top-3 in their patient population. Pull the data from their EHR before arrival if possible (most hospitals know this number — it's an HCAHPS metric).
*Fallback:* Spanish + 2 others. Document the others as "Phase 2 pending per-language CTQS validation."

**Failure B: Customer has a competing pilot from Epic / their EHR.**
*Likelihood:* HIGH if they're a large Epic shop. Epic released a translation feature in 2025.
*Mitigation:* Frame the architecture as complementary — Epic translates structured patient-portal messages; this handles the unstructured discharge document with formatting, meaning, and CTQS scoring that Epic's feature does not provide. Ask for the Epic feature's eval methodology — they typically don't have one as rigorous as CTQS.
*Fallback:* Position as the validation harness over both. Their Epic translations can flow through your CTQS pipeline.

**Failure C: Discovery eats 2 hours.**
*Likelihood:* HIGH. It always does.
*Mitigation:* Budget Hour 0–1 as 2 hours mentally. Compress Hour 5–7 (Foundry orchestration) — that's the most compressible block.

### 2.2 Hour 1–3 — Test harness skeleton (ask3 §13 MVP)

**Failure A: COMET model AML endpoint cold-start eats 30+ minutes.**
*Mitigation:* Pre-deploy the COMET endpoint in the demo subscription this week. Verify it's warm before arrival.
*Fallback:* Skip COMET in the MVP harness. Run with back-translation cosine + entity F1 only. Add COMET in Phase 2.

**Failure B: Text Analytics for Health rate-limited or quality drops on synthetic data.**
*Mitigation:* Smoke-test against your synthetic discharge pack this week. Note baseline entity F1 numbers before arrival so you have a reference.
*Fallback:* Substitute a regex-based critical-entity extractor for medications and dosages only. Less general but deterministic and demoable.

**Failure C: HuggingFace model download blocked by hospital network proxy.**
*Mitigation:* Pre-package COMET, embedding model, and any HF dependencies as a single container image in your own ACR. No external pulls during HoK.

### 2.3 Hour 3–5 — Dual-engine translation wiring

**Failure A: LLM rate limits hit (no PTU, PAYG TPM cap).**
*Mitigation:* Pre-provision a Standard deployment with at least 100K TPM in the demo subscription this week. Don't try to provision PTU on the day — that needs telemetry first.
*Fallback:* Throttle the demo to one document at a time. Don't run the parallel-document stress test until Phase 2.

**Failure B: XLIFF placeholder pattern conflicts with the discharge template formatting.**
*Likelihood:* MEDIUM. Hospital-specific discharge templates often use proprietary tokens (`<<MED_NAME>>`, `<<DOSE>>`).
*Mitigation:* Inspect a sample template before arrival. If their token pattern collides with XLIFF, write a pre-translation token-rewriting step into the ingestion layer (ask3 §3).
*Fallback:* Hand-strip placeholders for the demo and document the token-rewriting step as an ingestion-layer deliverable.

**Failure C: Discharge documents have embedded patient PII you didn't expect.**
*Mitigation:* Run Azure AI Language PII detection on every document before it hits an LLM. Pre-build this step in the Hour 1–3 harness skeleton (it's a one-API-call addition).
*Fallback:* Redact manually for the demo; flag the production pipeline must include PII pre-flight (ask1 already specifies this).

### 2.4 Hour 5–7 — Foundry orchestration

**Failure A: Entra Agent ID setup needs admin consent the customer hasn't pre-approved.**
*Likelihood:* MEDIUM-HIGH. Entra Agent ID is new; their identity team may not have processed consent for it yet.
*Mitigation:* Confirm with their Entra admin this week that Agent ID is enabled and that you have rights to register agent identities in their tenant.
*Fallback:* Use a service principal with the same RBAC scope. Document Agent ID migration as Phase 2.

**Failure B: Cosmos DB provisioning takes 15 minutes mid-demo.**
*Mitigation:* Pre-create the Cosmos account, database, and containers in the demo subscription this week. Empty is fine.

**Failure C: Foundry Agent Service tracing not capturing what you need.**
*Mitigation:* Smoke-test tracing in your demo subscription this week against a multi-agent workflow. Confirm spans are visible and that you can show the customer end-to-end traces.

### 2.5 Hour 7–8 — The four-case demo (ask2 §9)

This is the most likely place for a public failure. Each case is a separate risk.

**Demo case 1 (LLM and NMT agree → auto-publish):**
*Risk:* Both engines produce a translation that looks fine but a clinician in the room calls out as wrong (e.g., regional dialect mismatch).
*Mitigation:* Pre-validate the demo doc translation with a bilingual person on your team or via an external check this week. Don't demo a translation you haven't seen.
*Fallback:* Acknowledge it live: "This is exactly why CTQS doesn't claim 100% — and why your clinician just caught what the system would have caught at calibration time. The flip rule in §2.4 is what addresses this."

**Demo case 2 (engines disagree, LLM wins on CTQS):**
*Risk:* Engines actually agree, demo case doesn't fire.
*Mitigation:* Hand-craft a demo input that you've tested produces disagreement. Don't rely on chance.
*Fallback:* Walk through the case verbally with a static example.

**Demo case 3 (engines disagree, route to human):**
*Risk:* Same as case 2.
*Mitigation:* Same — pre-validate the input.

**Demo case 4 (critical-numeral hallucination caught by placeholder-fidelity gate):**
*Risk:* Highest stakes. If this case fails (gate doesn't fire, or fires on a benign doc), it undermines the entire safety story.
*Mitigation:* Build this case in the demo subscription this week and run it ten times. Confirm the gate fires deterministically. This is the case that sells the architecture — do not improvise it.
*Fallback:* If it fails on the day, do not retry live. Show the unit test passing in your IDE: "This case is in our test suite — what you're seeing is a configuration miss in the demo environment, not a design failure."

---

## 3. The questions you will get asked, and the answers ready

### 3.1 "What's the false-negative rate? What's the 1.6%?"
The CMO will ask. Answer ready: "CTQS doesn't claim accuracy — it claims a calibrated quality distribution above a threshold. The 1.6% (or whatever the gap is) maps to the documents that route to human review, not to documents that ship wrong. The auto-publish gate is set so that the residual clinically-impactful error rate on the auto-published cohort is below your tolerance — typically 1%. We measure that in the calibration set."

### 3.2 "Section 1557 says we need a qualified translator. AI isn't qualified."
Answer ready: "Correct. The pipeline routes the volume; qualified human translators sign off on everything above the auto-publish threshold and on every critical-error flag. For Spanish where evidence is strongest, we may move some auto-publish over time with the hospital's sign-off. For Mandarin, Vietnamese, Arabic, Tagalog — human review is the default. The system reduces translator workload on routine documents; it does not replace them. You retain Section 1557 compliance."

### 3.3 "We use [LanguageLine / CyraCom / Propio]. Are you replacing them?"
Answer ready: "No. We're routing the documents that don't need their judgment to a faster/cheaper path so they can spend their time on the ones that do. Their throughput goes up, their cost-per-document goes down, and your patient wait time goes down."

### 3.4 "Why not just use Google Translate Healthcare or AWS Bedrock?"
Answer ready: "You can. The architecture is engine-agnostic at the validation harness layer (ask3 §1.3). Where Azure wins for you specifically: HIPAA BAA is automatic under your existing Microsoft agreement; US Data Zone keeps PHI inside US borders at processing time, not just at rest; Foundry Agent Service gives you the orchestration and observability without you building it; and the dual-engine pattern uses Azure Translator as the cross-check, which is the most mature healthcare-deployed NMT in the industry (Seattle Children's reference). Switching back to single-vendor on Google or AWS sacrifices the dual-engine consensus story."

### 3.5 "What if the model retires? We can't have a clinical workflow break."
Answer ready: "This is exactly what §2.4 of the workflow plan addresses. Every artifact (system prompt, glossary, exemplars, rubric) is engine-agnostic. Model retirement is a contract test that runs in CI. The flip rule says we don't change models on the live workflow without two consecutive quarters of CTQS evidence. You get the upside of model improvements without the brittleness."

### 3.6 "What if Foundry is down?"
Answer ready: "The harness writes every input/output to Cosmos and immutable Blob with retention policy. Translator and AOAI have separate SLAs from Foundry Agent Service. If the orchestration layer is down, you can run the agents directly via API for the duration. Day-of-incident SOP is in the design doc."

### 3.7 "What does this cost per document?"
Approximate answer (verify against current pricing the morning of): "Per discharge document, dual-engine translation is roughly $0.05–0.15 in token costs depending on document length, plus negligible Translator and Cosmos costs. Validation harness adds about $0.02. So $0.07–0.17 per document fully loaded. Compare to your current human-translator cost-per-document — typically $30–80 for a discharge document. Even with full human review on 100% of non-Spanish, you're saving 50–70% on translator hours by removing draft work."

### 3.8 "What about the patients who can't read at a 6th-grade level in their own language?"
Answer ready: "Fair point — translation accuracy doesn't solve health literacy. The LLM-led architecture lets us specify a reading-level ceiling in the prompt (we recommend 6th-grade) and the CTQS includes a SMOG/Flesch readability sub-score in Phase 2 (ask3 §14). This is on the roadmap for the second engagement."

---

## 4. Stakeholder dynamics — who derails this

| Stakeholder | Risk | What they want to hear |
|---|---|---|
| **CMIO / Clinician lead** | "I don't trust AI with my patients." | The dual-engine consensus, the critical-error gate, the human-review default for everything except calibrated Spanish. CTQS as a measurement they own and can audit. |
| **Compliance / Legal** | Section 1557, HIPAA, FDA SaMD. | BAA in place, Section 1557 compliance via human-in-the-loop, FDA SaMD posture is conservative ("clinical decision support — communication aid, not autonomous"). |
| **CIO / IT** | Vendor lock-in, network sec. | Engine-agnostic harness, private endpoints, BYO Cosmos, Entra-integrated identity. |
| **CISO** | PHI exfiltration. | US Data Zone, abuse monitoring opted out, PII pre-flight redaction, immutable audit trail. |
| **CFO / Procurement** | "What does this cost?" | Per-document cost vs. existing translator spend (Section 3.7 above). |
| **Language Access Services lead** | "You're replacing my team." | Amplifier story (Section 3.3). Their team gets harder cases and more capacity. |
| **Existing vendor (LanguageLine etc.)** | Defending book of business. | Concede the qualified-translator role to them; route volume, not judgment (Section 1.7). |
| **Patient advocacy** | Equity, accuracy for underserved languages. | Per-language posture is conservative for Vietnamese/Arabic/Tagalog. CTQS calibrated separately per language — no Spanish-result generalization. |

If any of these stakeholders is hostile and unaddressed, they sink the engagement. **Identify which ones are in the room before Hour 0** and have the right paragraph ready.

---

## 5. Demo failure recovery playbook

If the demo fails live, the recovery rule is: **acknowledge, frame, redirect.** Do not retry live.

- *Acknowledge:* "That didn't fire the way I expected — let me show you why that's actually a feature, not a bug."
- *Frame:* "The reason CTQS exists is exactly because models behave non-deterministically on edge cases. What just happened is what your clinical team would catch in calibration. The architecture is designed around that, not against it."
- *Redirect:* Show a passing unit test in the IDE. Walk through the architecture diagram. Pivot to the §2.4 flip-rule conversation.

The worst response is "let me try it again" — every retry that fails compounds the credibility loss.

---

## 6. Pre-arrival checklist (do these in the next 72 hours)

Tactical, ordered by deadline.

**By end of day today:**
- [ ] Confirm BAA status with customer's account team
- [ ] File abuse-monitoring opt-out form if not already filed
- [ ] Confirm Foundry / AOAI / US Data Zone availability in customer's preferred region (`az cognitiveservices account list-models`)
- [ ] Confirm model deployment availability (GPT-5.1, GPT-5-mini, Claude Sonnet 4.6 if in scope)
- [ ] Confirm Entra Agent ID consent in customer tenant
- [ ] Push for clinical / language-access / compliance attendance Hour 0–1 and Hour 7–8

**By 48h before:**
- [ ] Ten synthetic discharge documents prepared, varied templates
- [ ] Demo subscription pre-provisioned: Foundry, AOAI deployments, Translator + Custom Translator stub, Cosmos, Storage, AML endpoint with COMET, Container App for format scorer
- [ ] Four-case demo inputs hand-validated (Section 2.5)
- [ ] Network access path confirmed (public or private)

**By 24h before:**
- [ ] All demo cases run end-to-end in demo subscription, three times each
- [ ] Bilingual pre-validation of demo doc translations (you don't demo a translation you haven't seen)
- [ ] Pricing numbers refreshed against current Azure pricing
- [ ] Stakeholder list confirmed; question prep (Section 3) reviewed
- [ ] Synthetic discharge pack on a USB drive AND in a private GitHub repo

**Day-of, before walking in:**
- [ ] Demo subscription is warm — run one end-to-end pass
- [ ] You have a printed copy of ask1, ask2, ask3, and this document. Tablets fail.

---

## 7. The smallest deliverable that still wins

If everything else goes wrong — no tenant access, no PHI, half the stakeholders missing — this is the floor. You can deliver this from a laptop with internet access.

1. **A working format-fidelity scorer** (deterministic Python from ask3 §4) running on a synthetic discharge doc and its hand-translated Spanish version, producing a real format-fidelity number.
2. **A working back-translation cosine score** between the same two docs, with the embedding API call live.
3. **One worked example of a critical-error catch** (a hand-crafted "do" → "do not" inversion or a dose change), demonstrating the gate firing.
4. **The CTQS formula on a slide**, with the customer's expected weights and the auto-publish threshold conversation ("calibrate this to your tolerance").
5. **The four documents** (ask1, ask2, ask3, this red-team) handed over as the engagement deliverable, with explicit Phase-2 plan.

That gets you out of the room with the customer saying "this is real" instead of "this was a slideware day." Everything else is upside.

---

## 8. After-action

Schedule a one-hour customer debrief 7 days after the HoK. Items:
- What landed, what didn't
- Decisions still open (the six in ask3 §15 plus any new ones)
- Phase-2 SOW shape
- Calibration plan for the golden set
- Clinical sign-off cadence

The HoK is the start of the work, not the finish.
