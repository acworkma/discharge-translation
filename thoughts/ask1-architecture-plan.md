# Hack on Keyboard — Reference Architecture & Decision Plan
**Customer:** US healthcare / hospital system
**First use case:** Multilingual hospital discharge instructions translation
**Author context:** Adam Workman, Microsoft Principal SE, US HLS STU Cloud & AI
**Date:** 2026-05-09

---

## 1. Executive Recommendation

**Build the customer's first agent on Microsoft Foundry Agent Service (standard / BYO setup) with Azure OpenAI deployments pinned to the US Data Zone, fronted by Azure App Gateway + WAF on a private-endpoint-only network footprint. Skip a customer-owned APIM tier for the HoK day-of build — Foundry already gives you the gateway controls you need at this scale, and Microsoft is folding APIM into Foundry as the embedded "AI Gateway." Use native Azure OpenAI PTU spillover (not an APIM-driven failover pattern) the moment they buy any provisioned throughput. Lean on Microsoft Entra Agent ID today and plan an Agent 365 rollout for governance maturity once E7 licensing is in place. The entire footprint is HIPAA-eligible under the Microsoft DPA's BAA terms — but de-identify PHI at the edge with Azure AI Language PII detection before it hits the model, regardless of BAA coverage.** [Confidence: HIGH]

The opinion in one sentence: **Foundry Agent Service + US Data Zone AOAI + private networking + native PTU spillover is the 2026 default for US healthcare; APIM and Agent 365 are deferable enhancements, not gating dependencies.**

---

## 2. Decision Matrix

| # | Question | Recommendation | Confidence | One-line rationale |
|---|----------|----------------|------------|--------------------|
| 1 | Foundry as platform? | **Yes — Foundry Agent Service, standard (BYO) setup** | HIGH | GA since Build 2025; gives agent state, MCP/A2A, evaluations, tracing, Entra Agent ID for free. Raw AOAI throws all of that on the floor. |
| 2 | LLMs + US Data Zone? | **Yes — Data Zone Standard + Data Zone Provisioned in a US region; GPT-5.1 as primary translation finalizer (longest GA life — retires 2027-05-15), GPT-5-mini for bulk, GPT-5-nano for interactive UI, GPT-5.2 (or successor o-series) for reasoning escalations, Mistral Document AI 25.12 for layout-aware ingestion of scanned/PDF discharges. See Section 3a for full rationale.** | HIGH | Data Zone keeps data at rest *and* in flight inside the US zone; every named model is HIPAA-eligible via Microsoft DPA's BAA; the four models in the original v1 (GPT-4.1 family, GPT-4o-mini, o4-mini) all retire October 2026 and are not viable for a 2026-launching production workload. |
| 3 | APIM in front of Foundry? | **No for HoK day-of. Yes later if multi-team / cross-region / need semantic cache or token-rate fairness across consumers** | MODERATE | Foundry's embedded AI Gateway (preview) absorbs most APIM AI value; reserve a separate APIM tier for true platform/multi-tenant scenarios. |
| 4 | PTU auto-failback to PAYG? | **Use native AOAI spillover (not APIM)** | HIGH | GA, Foundry-portal toggle, no code change, headers tell you when spillover fired. Same AOAI resource, same model, PTU + Standard side by side. |
| 5 | Agent365 / Entra Agent ID? | **Entra Agent ID now (free, auto-provisioned). Plan Agent 365 for after May 2026 GA once they license E7 Frontier ($15/user/mo)** | MODERATE | Entra Agent ID is the primitive; Agent 365 is the governance plane on top. Don't block HoK on it. |
| 6 | Reference architecture? | **App Gateway+WAF → App Service → Foundry private endpoint → Foundry Agent Service (standard) → BYO Cosmos / AI Search / Storage / Key Vault, all private endpoints, Defender for Cloud + Purview + Content Safety + AI Language PII pre-flight** | HIGH | Mirrors the Azure Architecture Center "baseline Foundry chat" reference, hardened for HIPAA. |

---

## 3. Recommended Reference Architecture (Component by Component)

### 3.1 Identity & access
- **Microsoft Entra ID** for users (clinicians, app admins). Conditional Access with phishing-resistant MFA on any role that can read PHI.
- **Microsoft Entra Agent ID** — automatically provisioned for every agent created in Foundry Agent Service. Use it as a first-class principal for downstream RBAC ([Microsoft Entra Agent ID overview](https://learn.microsoft.com/entra/identity/agent-id/overview)).
- **Managed Identity** on App Service / Container Apps for calls into AOAI, AI Search, Cosmos, Storage, Key Vault — no API keys, ever.

**Why:** Entra Agent ID gives you per-agent attribution in audit logs from day one; Agent 365 will register these same identities into its catalog when you turn it on later.

### 3.2 Edge & gateway
- **Azure Front Door Premium** *or* **Application Gateway v2 with WAF** in front of App Service; OWASP + bot rules; private link to origin.
- **Foundry "AI Gateway" (preview)** for token policies and content-safety enforcement — native, no APIM resource needed for the first use case.
- **Customer-owned APIM:** *defer*. Add it when one of these is true: (a) >=3 consuming apps share AOAI quota, (b) you need cross-region failover beyond AOAI spillover, (c) you must enforce Content Safety on a non-Foundry endpoint, (d) you need MCP/A2A federation across multiple Foundry projects, (e) finance demands a single chargeback chokepoint. The capabilities are real and powerful — `llm-token-limit`, `llm-semantic-cache-store/lookup` (Azure Managed Redis backend), `llm-content-safety`, backend load balancer with circuit breaker — but they are deferable for a single-team pilot ([APIM AI Gateway capabilities](https://learn.microsoft.com/azure/api-management/genai-gateway-capabilities)).

**Opinion to defend on-site:** Most "we need APIM in front of AOAI" architectures from 2024 were built before Foundry consolidated the gateway story. In 2026, lead with Foundry; pull APIM in when the org actually has more than one consumer.

### 3.3 Microsoft Foundry plane
- **Foundry hub + project** — one project per use case (start with `discharge-translation`).
- **Foundry Agent Service, standard agent setup** — you bring Cosmos DB (thread/run state, ≥3000 RU/s aggregate across three system containers), Storage (file uploads, transcripts), Azure AI Search (clinical knowledge index), Key Vault. All behind private endpoints, all in the customer's subscription/region ([Standard agent setup](https://learn.microsoft.com/azure/ai-foundry/agents/concepts/standard-agent-setup)).
- **Models (US Data Zone deployments — May 2026 catalog, lifecycle-aware; full analysis in Section 3a):**
  - **GPT-5.1** ([Data Zone Standard + DZ Provisioned](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)) — primary clinical translation finalization. 200K context, $1.25/$10 per 1M tokens, retires no earlier than 2027-05-15 (longest declared life among GA frontier models). Drop-in upgrade path to GPT-5.2 / 5.5 as they reach the customer's preferred region.
  - **GPT-5-mini** — bulk translation and summarization. $0.25/$2 per 1M; same retirement window as GPT-5 family (2027-02-06).
  - **GPT-5-nano** — interactive / UI calls. $0.05/$0.40 per 1M (cheapest OpenAI model on Azure direct).
  - **GPT-5.2** — reasoning escalations (e.g., reconciling conflicting medication instructions before translation, ambiguous orders). Replaces the original v1 plan's o4-mini and o3, both of which retire 2026-10-16 with no announced o-series successor on the same lifecycle window.
  - **Mistral Document AI 25.12** ([Direct from Azure](https://ai.azure.com/catalog/models/mistral-document-ai-2512)) — first-stage ingestion of scanned/PDF discharges. 99%+ OCR accuracy across 25+ languages; preserves tables, layout, handwriting; outputs Markdown/JSON. $3/1K pages. Inherits Microsoft DPA / BAA terms because it is Direct-from-Azure (single MS license, MS support, no third-party data plane). Critical for discharges that arrive as faxed PDFs from the EHR.
  - **text-embedding-3-large** — RAG over hospital's drug/condition glossary and approved patient education content. Retires NET 2026-10-30; plan a follow-up to text-embedding-4 / GPT-5 embedding successor when announced.
- **Foundry Tools** (formerly standalone Azure AI services), invoked as MCP-style tools:
  - **Azure Translator** — hybrid NMT + LLM for the translation use case. NMT is deterministic and rapid for boilerplate; LLM cleans up clinical terminology and tone. Available in Foundry Tools `2025-10-01-preview`.
  - **Azure AI Language — PII detection (HCC PHI category)** — pre-flight redaction before any prompt leaves Foundry. Even with a BAA, you reduce blast radius.
  - **Azure AI Content Safety** — default in AOAI; tune `severity` thresholds; add custom blocklists for facility-specific terms.

### 3.4 Data layer
- **Azure Cosmos DB for NoSQL** — Foundry-managed agent state (system containers); customer can also use it for prompt history if needed.
- **Azure AI Search** — clinical knowledge index (medication leaflets, post-procedure instructions, hospital-approved patient ed content). Use semantic ranker. Private endpoint.
- **Azure Storage (Blob, ADLS Gen2)** — discharge document originals + translated outputs + audit trail. Customer-managed keys (CMK) via Key Vault.
- **Azure Key Vault (Premium / HSM)** — CMK material; Managed HSM if regulatory ask is FIPS 140-2 Level 3.

### 3.5 Throughput & resilience
- **Provision PTU (Data Zone Provisioned) on the primary model.** Right-size with the AOAI capacity calculator; don't over-provision before you have telemetry.
- **Enable native AOAI spillover** in Foundry portal: when PTU 429s, calls auto-route to a Standard (PayGo) deployment of the *same model in the same AOAI resource*. Headers `x-ms-spillover-from-deployment`, `x-ms-deployment-name`, `x-ms-spillover-error` give you observability ([Spillover traffic management](https://learn.microsoft.com/azure/ai-services/openai/how-to/spillover-traffic-management)).
- **No APIM-driven failover for v1.** It worked in 2024; in 2026 it's mostly redundant for single-region deployments and adds latency.

### 3.6 Observability
- **Foundry tracing** — OpenTelemetry-native; sends spans to **Application Insights** + **Log Analytics**. Captures prompt, completion, tool calls, token counts, latency, content-safety verdicts ([Foundry observability](https://learn.microsoft.com/azure/ai-foundry/concepts/observability)).
- **Foundry evaluations** — automated quality runs in CI/CD against a curated golden set. For translation: BLEU + COMET + a clinical Likert rubric (completeness, fluency, meaning, severity preservation, overall) modeled on the JMIR 2026 ED-discharge evaluation framework ([Carreras Tartak et al., JMIR Form Res 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12835839/)).
- **Microsoft Defender for Cloud (AI threat protection)** — runtime detection of prompt-injection, data-exfil, and abuse signals.
- **Microsoft Purview** — DLP, sensitivity labels on agent outputs, e-discovery for agent interactions.
- **Microsoft Agent 365 Visualization** — phase-2 add-on; once licensed, it gives the cross-agent topology and posture views.

### 3.7 Networking
- **VNet injection** into Foundry Agent Service where supported, otherwise private endpoints on every PaaS dependency.
- **Azure Firewall Premium** for explicit egress allowlist (TLS inspection optional but valuable for PHI audit).
- **Private DNS zones** for `*.cognitiveservices.azure.com`, `*.openai.azure.com`, `*.search.windows.net`, `*.documents.azure.com`, `*.blob.core.windows.net`.
- **No public endpoints on data plane resources.** Period.

### 3.8 Responsible AI / safety
- Content Safety enabled with `severity >= 4` blocking for hate/sexual/violence/self-harm; healthcare-specific blocklist for medication-name look-alikes.
- Prompt Shields on for jailbreak / indirect prompt injection.
- AI Language PII detection in the **HCC** (Health & Clinical / PHI) category as a pre-flight redactor before any text leaves the customer's VNet.
- Human-in-the-loop gate before any translated discharge is shown to a patient — a clinician or interpreter accepts/rejects. The HoK should ship this gate as a UI checkbox on day one.
- Abuse-monitoring opt-out request submitted for the AOAI resource that handles PHI ([Azure OpenAI data, privacy, and security](https://learn.microsoft.com/azure/ai-services/openai/how-to/data-privacy)).
- HIPAA BAA is automatic via the Microsoft Products and Services Data Protection Addendum for EA/MCA/CSP customers — no separate signature needed ([MS DPA](https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA)).

---

## 3a. Model Selection — Azure Direct Catalog Analysis

**Why this section exists:** the v1 of this report named GPT-4.1, GPT-4.1-mini, GPT-4o-mini, and o4-mini without justifying those choices against the May 2026 Azure Foundry catalog. **Every one of those four models retires by October 2026** — within ~5 months of the HoK day. Standing up a production clinical workload on a deprecating model is the kind of unforced error customers remember. This section corrects the record, evaluates the realistic alternatives (Mistral, Grok, Phi-4, embeddings), and produces a defensible portfolio.

### 3a.1 "Direct from Azure" — what the curated portfolio actually means

Microsoft Foundry distinguishes two model paths. **Direct from Azure** ("Models Sold Directly by Azure") models are bought, billed, supported, and governed by Microsoft on a single license — they inherit the Microsoft Products and Services DPA (which contains the BAA), the Foundry "AI Gateway" controls, the Azure AI Content Safety wrapper, PTU portability, and Microsoft customer support. **Marketplace / partner** models are billed and supported by the partner, with the partner's own legal terms layered on top. For a HIPAA-bound clinical workload, Direct from Azure is strongly preferred — it's the only path where the BAA inheritance, Defender for Cloud telemetry, and Purview governance flow without a separate paper trail ([Mistral Document AI catalog page — "Direct from Azure" definition](https://ai.azure.com/catalog/models/mistral-document-ai-2512)).

The Direct portfolio in May 2026 spans: the full **Azure OpenAI** family (GPT-5 / 5.1 / 5.2 / 5.4 / 5.5, GPT-4.1 family, GPT-4o, o-series, embeddings), **Mistral** (Document AI, Large 3, Medium, Small, Ministral, Codestral), **xAI Grok** (3, 3-Mini, 4, 4-Fast, 4.1-Fast), **Microsoft Phi-4** family (text and multimodal — open-weight MIT but offered as MaaS), and select **Black Forest FLUX**, **Stability**, **Cohere Embed/Command**, **Meta Llama**, **DeepSeek** entries. For this customer, only the first three families plus Phi-4 are materially relevant; the rest are out-of-scope for a discharge translation pipeline.

### 3a.2 Lifecycle — what dies and when

| Model | GA | Retires | Replacement | Note |
|---|---|---|---|---|
| **gpt-4.1 / gpt-4.1-mini / gpt-4.1-nano** | 2025-04-14 | **2026-10-14** | gpt-5 / gpt-5-mini / gpt-5-nano | original v1 primary — retiring 5 mo. post-HoK |
| **gpt-4o (Std)** | 2024-11-20 | **2026-06-05** | gpt-5 family | only 1 month after HoK |
| gpt-4o (other deployment types) | — | 2026-10-01 | gpt-5 family | |
| **gpt-4o-mini (Std)** | 2024 | **already past 2026-03-31** | gpt-5-nano | already deprecated |
| gpt-4o-mini (other types) | — | 2026-10-01 | gpt-5-nano | |
| **o4-mini, o3** | 2025 | **2026-10-16** | (no o-successor announced; use gpt-5.2) | original v1 reasoning model |
| o3-mini | 2025 | 2026-08-02 | (use o4-mini, which itself retires) | cascade hazard |
| o1 | 2024 | 2026-07-15 | o3 (which is also retiring) | |
| **gpt-5** | 2025-08-07 | **2027-02-06** | gpt-5.2+ | safe through Feb 2027 |
| **gpt-5-mini / gpt-5-nano** | 2025 | **2027-02-06** | — | |
| **gpt-5.1** | 2025-11-13 | **2027-05-15** | — | **longest GA life — recommended primary** |
| **gpt-5.2** | 2025-12-11 | ~mid-2027 | — | recommended for reasoning escalation |
| **gpt-5.4** | 2026 Q1 | TBD | — | "reliable production" tier; pricier |
| **gpt-5.5** | 2026-04-24 | TBD | — | 1.05M context; ~18mo runway |
| **text-embedding-3-large/small** | 2023 | NET 2026-10-30 | embedding-4 (forthcoming) | plan refresh in HoK+6 |

(Sources: [Foundry retirement notifications](https://jinlee794.github.io/foundry-model-availability-notifications/), [Azure OpenAI model retirements](https://learn.microsoft.com/azure/ai-services/openai/concepts/model-retirements).)

**Conclusion:** the long-life anchor in May 2026 is **GPT-5.1** (retires 2027-05-15). GPT-5.2 / 5.4 / 5.5 are valid drop-in upgrades but have shorter declared runways and uneven Data Zone region coverage. The entire GPT-4 family is non-viable for a 2026-launching workload.

### 3a.3 Cost matrix — Global Standard, per 1M tokens (Data Zone +~10%)

| Model | Input | Cached In | Output | Context | Intel Index | Role candidate |
|---|---|---|---|---|---|---|
| GPT-5.5 | $5.00 | — | $30.00 | 1.05M | 60.2 | premium primary if budget allows |
| GPT-5.4 | $2.50 | $0.25 | $15.00 | 272K+ | 57.0 | reliable production tier |
| GPT-5.2 | $1.75 | $0.18 | $14.00 | 200K | 51.3 | **reasoning escalation** |
| **GPT-5.1** | **$1.25** | $0.13 | **$10.00** | 200K | 47.7 | **primary translation finalizer** |
| GPT-5 | $1.25 | $0.13 | $10.00 | 200K | 44.6 | fallback if 5.1 not regional |
| **GPT-5-mini** | **$0.25** | $0.025 | **$2.00** | 128K | 41.2 | **bulk translation** |
| **GPT-5-nano** | **$0.05** | $0.005 | **$0.40** | 128K | 26.8 | **interactive UI** |
| Grok 4 | $3.00 | — | $15.00 | 256K | — | rejected as primary (see 3a.4) |
| Grok 4-Fast / 4.1-Fast | $0.20 | — | $0.50 | 256K | — | optional LLM-as-judge / non-PHI |
| Grok 3-Mini | $0.25 | — | $1.27 | 128K | — | not preferred (older) |
| Mistral Large 3 (25.12) | ~$2 | — | ~$6 | 128K | ~mid-40s | second-opinion / non-OAI judge |
| Mistral Medium / Small | <$1 | — | <$3 | 128K | — | bulk fallback |
| **Mistral Document AI 25.12** | **$3 / 1K pages** | — | — | n/a | n/a | **layout-aware ingestion** |
| Phi-4-multimodal-instruct | $0.08 | — | $0.32 | 131K | ~25 | edge / on-device sandbox; not primary |
| text-embedding-3-large | $0.13 | — | n/a | 8K | n/a | RAG embeddings (refresh due) |

(Sources: [Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/), [Azure AI Foundry — Grok pricing](https://azure.microsoft.com/pricing/details/ai-foundry-models/grok/), [Mistral Document AI catalog](https://ai.azure.com/catalog/models/mistral-document-ai-2512), [Phi-4 catalog](https://ai.azure.com/catalog/models/Phi-4-multimodal-instruct), Intelligence Index from [MarginDash compilation](https://margindash.com/azure-openai-pricing-calculator).)

### 3a.4 Verifying the customer's three pushbacks

| Pushback | Verdict | Evidence |
|---|---|---|
| **(a)** "GPT-4 family has rapidly approaching EOL" | **VERIFIED.** All four models from v1 retire by 2026-10-16. Standing them up at HoK is malpractice. | [Foundry retirement notifications](https://jinlee794.github.io/foundry-model-availability-notifications/) |
| **(b)** "Mistral is popular for document workloads" | **VERIFIED.** Mistral Document AI 25.12 is Direct-from-Azure, 99%+ OCR accuracy across 25+ languages, layout/tables/handwriting, Markdown/JSON output. Materially better than GPT-5 family for raw scanned/PDF discharge ingestion. | [Mistral Document AI catalog](https://ai.azure.com/catalog/models/mistral-document-ai-2512) |
| **(c)** "Grok is significantly cheaper" | **VERIFIED on price; PARTIALLY REJECTED on suitability for clinical PHI as primary.** Grok 4-Fast at $0.20/$0.50 is genuinely cheap. But: no published clinical translation evaluation on Azure-direct Grok; xAI's consumer tier (X.com) trains on user data (Azure-direct severs that via MS DPA but reputational risk lingers); Irish DPC GDPR investigation (Apr 2025) and consumer-tier deepfake CSAM concerns (Jan 2026) make Grok an unwise primary for clinician-facing PHI workloads. **Use case:** non-PHI bulk paths and LLM-as-judge (deliberately different family from the OpenAI primary), gated by an evaluation harness. | [Foundry Grok pricing](https://azure.microsoft.com/pricing/details/ai-foundry-models/grok/), [Hoag Law xAI/Grok privacy analysis](https://hoaglaw.ai/grok) |

### 3a.5 Recommended Model Portfolio (with explicit role assignments)

| Role | Model | Rationale |
|---|---|---|
| **Document ingestion (scanned PDFs, faxed discharges, layout/tables/handwriting)** | **Mistral Document AI 25.12** (Direct from Azure) | Purpose-built; 25+ languages incl. Spanish, Mandarin, Vietnamese, Arabic; preserves layout for downstream rendering; $3/1K pages predictable. GPT-5 vision is generalist and ~10x more expensive per page-equivalent. |
| **Primary clinical translation finalization** | **GPT-5.1** (Data Zone Standard / DZ Provisioned) | Best balance of quality (Intelligence Index 47.7) and lifecycle runway (retires 2027-05-15 — longest among GA frontier). $1.25/$10 per 1M. 200K context fits multi-page discharges. Drop-in upgrade to GPT-5.2 / 5.5 once available in-region. |
| **Bulk translation / summarization** | **GPT-5-mini** | $0.25/$2 per 1M, same family / same eval harness as primary, retires 2027-02-06. Replaces v1's GPT-4.1-mini one-for-one. |
| **Interactive UI / "instant" calls** | **GPT-5-nano** | $0.05/$0.40 per 1M — cheapest OpenAI on Azure direct. Replaces v1's GPT-4o-mini. |
| **Reasoning escalation** (medication-list reconciliation, conflicting orders) | **GPT-5.2** | Replaces v1's o4-mini and o3 (both retire 2026-10-16 with no o-successor). 51.3 Intelligence Index, $1.75/$14 per 1M, deep reasoning + 200K context. |
| **LLM-as-judge / second-opinion (eval harness only)** | **Grok 4-Fast** ($0.20/$0.50) **OR Mistral Large 3** | Deliberately different model family from the OpenAI primary to avoid evaluator/generator family bias in the JMIR-2026 Likert pipeline. Cheap enough to run on every translation. Not exposed to clinicians. |
| **Embeddings / RAG over hospital glossary and patient-ed library** | **text-embedding-3-large** (now) → **embedding-4 / GPT-5 embedding** (HoK + 6 mo) | Current model retires NET 2026-10-30. Plan a re-embed cycle in the same backlog window as the GPT-5.1 → 5.2 upgrade. |
| **Edge / on-device sandbox (low-priority experiment)** | **Phi-4-multimodal-instruct** | MIT license, 131K context, text+vision+audio, $0.08/$0.32 per 1M. Useful for on-prem or edge experiments; **not** for primary clinical path — open-weights / smaller model needs custom safety wrap. |

### 3a.6 Explicit rejections (and why)

- **GPT-4.1 family / GPT-4o / GPT-4o-mini / o3 / o3-mini / o4-mini / o1**: all retire by October 2026 — non-viable for a workload going live mid-to-late 2026.
- **Grok-4 as primary clinical translator**: BAA-eligible via MS DPA when Direct-from-Azure, but no published clinical evaluation, weaker governance maturity, and reputational drag from the consumer X.com tier. Permitted as judge / non-PHI bulk only.
- **Phi-4-multimodal as primary**: SLM, MIT-licensed open weights, smaller eval surface, no JMIR-grade clinical translation evidence. Keep for edge experiments.
- **Marketplace-tier Llama / DeepSeek / Cohere**: viable in principle, but partner-billed paths add a separate BAA / DPA layer. Not worth the legal cycle for a single-team HoK.
- **GPT-5 Pro / GPT-5.5 Pro / o3 Pro**: overpowered and budget-hostile ($15-$30 input, $120-$180 output per 1M) for a translation workload. Save for a future complex-reasoning use case.
- **GPT-5.5** (1.05M context) **as primary today**: tempting but lifecycle and Data Zone region coverage still maturing. Recommend as upgrade path, not v1 anchor.

### 3a.7 Confidence

- **HIGH confidence**: lifecycle dates, AOAI Global Standard pricing, Mistral Document AI Direct-from-Azure status, Grok pricing on Azure direct, the verdict that the original v1 model list is non-viable.
- **MODERATE confidence**: exact Data Zone availability of GPT-5.1 / 5.2 / 5.5 in the customer's preferred US region (verify at kickoff via `az cognitiveservices account list-models`); exact MaaS pricing for Mistral Large 3 on Azure direct (varies by region/SKU); the o-series successor identity (none announced as of 2026-05-09).
- **LOW confidence**: clinical translation quality of Grok 4 / Mistral Large 3 specifically vs GPT-5.1 — limited published peer-reviewed evidence beyond OpenAI family models. Mitigation: build the JMIR-2026 Likert + COMET evaluation harness on Day 1 and let it decide, not a vendor blog.

---

## 4. HoK Day-of Build vs. Plan-for-Later

### Build during the HoK (day-of, scoped to the discharge translation use case)

1. **Foundry project + standard agent setup** — provision in a US region with Data Zone deployment SKUs. ~30 min if subscription is pre-prepped.
2. **AOAI deployments**: GPT-5.1 (Data Zone Standard) + GPT-5-mini (Data Zone Standard) + GPT-5-nano (Data Zone Standard); plus **Mistral Document AI 25.12** (Direct from Azure, serverless). Skip PTU on day one — start PayGo, layer PTU after telemetry. Do **not** stand up GPT-4.1 / GPT-4o-mini / o4-mini even if the customer asks — all three retire October 2026 (see Section 3a lifecycle table).
3. **Translation agent** with three tools wired:
   - Azure Translator (Foundry tool) for NMT first pass.
   - Azure AI Language PII detector for redaction.
   - **GPT-5.1** finalization step with a clinical-translation system prompt anchored on the JMIR 2026 prompt + Likert rubric. (If the customer's region/quota does not yet have GPT-5.1 in Data Zone, fall back to GPT-5; do not fall back to GPT-4.1.)
4. **Private endpoints + VNet** for Foundry, AOAI, Cosmos, Storage, AI Search, Key Vault.
5. **Application Gateway + WAF** on a simple Container App or App Service host serving a minimal staff-facing UI.
6. **Foundry tracing → App Insights** + a starter evaluation run (10–20 redacted sample discharges, 2 reviewers).
7. **Entra Agent ID** confirmed in the Entra portal for the new agent; Managed Identity on the host app.
8. **Defender for Cloud / AI threat protection** turned on for the subscription.

### Plan for later (post-HoK, 30–90 days)

1. **PTU + native spillover** on the primary model once you have ~2 weeks of usage telemetry.
2. **APIM tier** if/when a second consuming app shows up, or finance/security want a chokepoint.
3. **Agent 365 enrollment** once E7 Frontier licensing is in place (post May 2026 GA, $15/user/mo).
4. **Multi-language expansion** beyond Spanish — add Vietnamese, Mandarin, Tagalog, Haitian Creole, Arabic, Russian one at a time, each gated by an evaluation pass.
5. **Purview** policies, e-discovery for agent transcripts, sensitivity-label propagation onto translated outputs.
6. **Agent 365 Visualization, Registry, Access Control, Interoperability, Security** capabilities once licensed.
7. **Microsoft Agent Framework** SDK adoption if/when they need code-first orchestration beyond Foundry portal-defined agents.
8. **Disaster recovery / multi-region active-active** — not for v1; revisit when they have a second use case in production.

---

## 5. Open Questions for the Customer

1. Which **US Azure region** do they prefer and is **Data Zone Standard / Provisioned** enabled there for **GPT-5.1** (and ideally GPT-5.2 / GPT-5.5)? Also confirm Direct-from-Azure availability of **Mistral Document AI 25.12** in-region. (Confirm at kickoff via `az cognitiveservices account list-models` and the Foundry catalog filter for "Direct from Azure".)
2. Do they have an existing **Microsoft Products and Services DPA / BAA** in their EA/MCA? (Verify with account team — should be automatic but worth a check.)
3. Have they submitted (or are they willing to submit) the **abuse-monitoring opt-out** request for AOAI on PHI workloads?
4. What **languages** are required at GA, prioritized? Population data + interpreter utilization data drives the order.
5. What is the **clinician acceptance / interpreter review workflow** today, and how does the AI gate plug into it? Is this opt-in or opt-out for the patient?
6. **Source-of-truth EHR**: Epic, Oracle Health, Meditech? Which integration pattern (Logic App, FHIR API, MCP server)?
7. Existing **APIM, Front Door, Firewall, Key Vault** estate? Reuse vs. greenfield.
8. **E7 Frontier Suite licensing** — current status with the account team; gates Agent 365 timing.
9. Tolerance for **model auto-update** vs. version-pinning. For PHI workloads I default to pinning until you have an eval pipeline.
10. **Evaluation owner** — who internally signs off translation quality? Clinician + interpreter pair recommended, mirroring JMIR 2026 study design.
11. Do they want **on-prem / edge inference** (Foundry Local) for any reason (latency, sovereignty)? Default answer is no for translation, but ask.
12. **Cost ceiling** for the pilot and chargeback model — drives PTU vs. PayGo split.

---

## 6. Confidence & Limitations

- **HIGH confidence** items in this report are anchored on Microsoft Learn primary documentation and Azure Architecture Center reference architectures, cross-checked against TechCommunity announcements from Build 2025 and Ignite 2025.
- **MODERATE confidence**: APIM-in-Foundry preview availability in customer tenant (verify at HoK kickoff); exact Agent 365 capability boundaries on day one of GA; non-Spanish translation quality (limited published evidence beyond Spanish).
- **Residual risk** (per the pre-mortem): if the customer's region lacks Data Zone SKUs for the chosen model, fall back to Regional deployments — still HIPAA-eligible. If they have firm "no public PaaS" stance even for control planes, the architecture above already runs all data plane on private endpoints; control plane access goes through Azure Bastion + Privileged Identity Management.

---

## 7. Sources

1. [What is Azure AI Foundry Agent Service](https://learn.microsoft.com/azure/ai-foundry/agents/overview) — Microsoft Learn
2. [Foundry Agent Service GA announcement (Build 2025)](https://techcommunity.microsoft.com/blog/aiplatformblog/foundry-agent-service-ga/) — Microsoft TechCommunity
3. [Standard agent setup (BYO Cosmos / Storage / Search / Key Vault)](https://learn.microsoft.com/azure/ai-foundry/agents/concepts/standard-agent-setup) — Microsoft Learn
4. [Azure OpenAI deployment types and Data Zones](https://learn.microsoft.com/azure/ai-services/openai/how-to/deployment-types) — Microsoft Learn
5. [Azure OpenAI data, privacy, and security (HIPAA, abuse monitoring opt-out)](https://learn.microsoft.com/azure/ai-services/openai/how-to/data-privacy) — Microsoft Learn
6. [Microsoft Products and Services Data Protection Addendum (DPA / BAA)](https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA) — Microsoft Legal
7. [PTU spillover traffic management](https://learn.microsoft.com/azure/ai-services/openai/how-to/spillover-traffic-management) — Microsoft Learn
8. [APIM AI Gateway capabilities overview](https://learn.microsoft.com/azure/api-management/genai-gateway-capabilities) — Microsoft Learn
9. [APIM `llm-token-limit` policy](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy) — Microsoft Learn
10. [APIM `llm-semantic-cache-store` / `llm-semantic-cache-lookup` policies](https://learn.microsoft.com/azure/api-management/llm-semantic-cache-store-policy) — Microsoft Learn
11. [APIM `llm-content-safety` policy](https://learn.microsoft.com/azure/api-management/llm-content-safety-policy) — Microsoft Learn
12. [Baseline Microsoft Foundry chat reference architecture](https://learn.microsoft.com/azure/architecture/ai-ml/architecture/baseline-azure-ai-foundry-chat) — Azure Architecture Center
13. [Azure-Samples/openai-end-to-end-baseline](https://github.com/Azure-Samples/openai-end-to-end-baseline) — GitHub (Microsoft)
14. [AI Hub Gateway Solution Accelerator](https://github.com/Azure-Samples/ai-hub-gateway-solution-accelerator) — GitHub (Microsoft)
15. [Microsoft Agent 365 (Frontier Suite, May 2026 GA)](https://www.microsoft.com/microsoft-365/blog/?p=agent-365) — Microsoft 365 Blog
16. [Microsoft Entra Agent ID overview](https://learn.microsoft.com/entra/identity/agent-id/overview) — Microsoft Learn
17. [Azure AI Content Safety overview](https://learn.microsoft.com/azure/ai-services/content-safety/overview) — Microsoft Learn
18. [Azure AI Search private endpoint configuration](https://learn.microsoft.com/azure/search/service-create-private-endpoint) — Microsoft Learn
19. [Azure Translator in Foundry Tools (NMT + LLM hybrid)](https://learn.microsoft.com/azure/ai-services/translator/translator-overview) — Microsoft Learn
20. [Azure AI Language — PII detection (HCC / PHI categories)](https://learn.microsoft.com/azure/ai-services/language-service/personally-identifiable-information/overview) — Microsoft Learn
21. [Azure OpenAI abuse monitoring](https://learn.microsoft.com/azure/ai-services/openai/concepts/abuse-monitoring) — Microsoft Learn
22. [Microsoft Defender for Cloud — AI threat protection](https://learn.microsoft.com/azure/defender-for-cloud/ai-threat-protection) — Microsoft Learn
23. [Microsoft Purview for AI / agents](https://learn.microsoft.com/purview/ai-microsoft-purview) — Microsoft Learn
24. [Foundry observability and tracing](https://learn.microsoft.com/azure/ai-foundry/concepts/observability) — Microsoft Learn
25. [Healthcare on Azure landing](https://learn.microsoft.com/industry/healthcare/) — Microsoft Learn
26. [Carreras Tartak JA, et al. *Evaluating Spanish Translations of Emergency Department Discharge Instructions by a Large Language Model: Tool Validation and Reliability Study*. JMIR Form Res 2026;10:e79676](https://pmc.ncbi.nlm.nih.gov/articles/PMC12835839/) — peer-reviewed (Likert rubric inspiration; relevant prior art for the use case)
27. [Microsoft Foundry Models retirement schedule (jinlee794 mirror)](https://jinlee794.github.io/foundry-model-availability-notifications/) — mirrors first-party MS Learn retirement notifications
28. [Azure OpenAI Service pricing (May 2026)](https://azure.microsoft.com/en-us/pricing/details/azure-openai/) — Microsoft pricing
29. [Azure AI Foundry — Grok (xAI) pricing](https://azure.microsoft.com/pricing/details/ai-foundry-models/grok/) — Microsoft pricing (Direct from Azure rate card)
30. [Mistral Document AI 25.12 — Foundry catalog (Direct from Azure)](https://ai.azure.com/catalog/models/mistral-document-ai-2512) — Microsoft Foundry catalog
31. [Phi-4-multimodal-instruct — Foundry catalog](https://ai.azure.com/catalog/models/Phi-4-multimodal-instruct) — Microsoft Foundry catalog
32. [Azure OpenAI model retirements (Microsoft Learn)](https://learn.microsoft.com/azure/ai-services/openai/concepts/model-retirements) — Microsoft Learn (primary lifecycle source)
33. [Price Per Token — Azure OpenAI pricing across all models & 38 regions](https://pricepertoken.com/endpoints/azure) — independent aggregator (Data Zone vs Global cross-check)
34. [APICents — Azure OpenAI API pricing 2026](https://apicents.com/provider/azure-openai) — independent aggregator (verified Mar 11 2026)
35. [CloudZero — Azure OpenAI pricing 2026](https://www.cloudzero.com/blog/azure-openai-pricing/) — vendor blog (FinOps)
36. [MarginDash — Azure OpenAI pricing calculator + Intelligence Index](https://margindash.com/azure-openai-pricing-calculator) — independent aggregator (model intelligence scoring)
37. [Hoag Law — xAI / Grok privacy and BAA analysis](https://hoaglaw.ai/grok) — independent legal analysis (consumer-tier training-on-data caveat)
