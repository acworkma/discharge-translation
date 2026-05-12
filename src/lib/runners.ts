// Real translation runners.
//   - Azure AI Translator (Text Translation REST API)
//   - Azure AI Foundry models via the Azure AI Inference REST SDK
//
// Both default to AAD auth (DefaultAzureCredential / Managed Identity).
// API-key fallback is supported for local development only.

import ModelClient, { isUnexpected } from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
import { credential, config, COGNITIVE_SERVICES_SCOPE } from './azure';

export interface RunnerInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  modelId?: string;
}

export interface RunnerOutput {
  translatedText: string;
}

export interface Runner {
  id: string;
  displayName: string;
  translate(input: RunnerInput): Promise<RunnerOutput>;
}

// ---------------------------------------------------------------------------
// Azure AI Translator (Text Translation v3)
// Docs: https://learn.microsoft.com/azure/ai-services/translator/reference/v3-0-translate
// ---------------------------------------------------------------------------

async function translatorAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ClientTraceId': crypto.randomUUID()
  };

  if (config.translatorKey) {
    headers['Ocp-Apim-Subscription-Key'] = config.translatorKey;
    if (config.translatorRegion) {
      headers['Ocp-Apim-Subscription-Region'] = config.translatorRegion;
    }
    return headers;
  }

  // AAD path (Managed Identity in prod). Region header still required.
  const token = await credential().getToken(COGNITIVE_SERVICES_SCOPE);
  if (!token) throw new Error('Failed to acquire AAD token for Translator');
  headers['Authorization'] = `Bearer ${token.token}`;
  if (config.translatorRegion) {
    headers['Ocp-Apim-Subscription-Region'] = config.translatorRegion;
  }
  return headers;
}

export const azureTranslator: Runner = {
  id: 'azure-translator',
  displayName: 'Azure AI Translator',

  async translate({ text, sourceLang, targetLang }) {
    if (!config.translatorEndpoint) {
      throw new Error('AZURE_TRANSLATOR_ENDPOINT is not configured');
    }
    const base = config.translatorEndpoint.replace(/\/+$/, '');
    const params = new URLSearchParams({ 'api-version': '3.0', to: targetLang });
    if (sourceLang) params.set('from', sourceLang);

    const url = `${base}/translate?${params.toString()}`;
    const headers = await translatorAuthHeaders();

    // The v3 endpoint enforces a per-request character limit (~50k). Chunk on
    // paragraph boundaries to stay safely under it while preserving formatting.
    const chunks = chunkText(text, 45_000);
    const translatedChunks: string[] = [];

    for (const chunk of chunks) {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify([{ Text: chunk }])
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Translator ${res.status}: ${detail.slice(0, 300)}`);
      }
      const body = (await res.json()) as Array<{
        translations: Array<{ text: string; to: string }>;
      }>;
      const piece = body?.[0]?.translations?.[0]?.text ?? '';
      translatedChunks.push(piece);
    }

    return { translatedText: translatedChunks.join('\n\n') };
  }
};

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let buf = '';
  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length > maxChars) {
      if (buf) out.push(buf);
      if (p.length > maxChars) {
        // hard split on length for absurdly long paragraphs
        for (let i = 0; i < p.length; i += maxChars) out.push(p.slice(i, i + maxChars));
        buf = '';
      } else {
        buf = p;
      }
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ---------------------------------------------------------------------------
// Azure AI Foundry — model catalog inference endpoint
// One Runner instance per deployed model id.
// Endpoint format (per-model): https://<aif-name>.services.ai.azure.com/models
// Auth: AAD (Cognitive Services scope) by default; API key fallback for local.
// Docs: https://learn.microsoft.com/azure/ai-foundry/model-inference/reference/reference-model-inference-api
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a professional medical translator specializing in hospital discharge documentation.',
  'Translate the user message to the requested target language while preserving:',
  '  - clinical meaning and dosing/numerics exactly,',
  '  - section structure, line breaks, lists, and headings,',
  '  - patient-facing tone and reading level.',
  'Do not add commentary, disclaimers, or extra text. Return only the translated document.'
].join(' ');

function foundryClient() {
  if (!config.foundryEndpoint) {
    throw new Error('AZURE_FOUNDRY_ENDPOINT is not configured');
  }
  if (config.foundryApiKey) {
    return ModelClient(config.foundryEndpoint, new AzureKeyCredential(config.foundryApiKey));
  }
  return ModelClient(config.foundryEndpoint, credential(), {
    credentials: { scopes: [COGNITIVE_SERVICES_SCOPE] }
  });
}

export function foundryRunner(modelId: string): Runner {
  return {
    id: `foundry:${modelId}`,
    displayName: `Azure AI Foundry / ${modelId}`,

    async translate({ text, sourceLang, targetLang }) {
      const client = foundryClient();
      const userPrompt =
        `Translate the following ${sourceLang || 'source'} discharge document into ${targetLang}.\n\n` +
        '--- BEGIN DOCUMENT ---\n' + text + '\n--- END DOCUMENT ---';

      const response = await client.path('/chat/completions').post({
        body: {
          model: modelId,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 4096
        }
      });

      if (isUnexpected(response)) {
        const err = response.body as { error?: { message?: string } };
        throw new Error(`Foundry ${response.status}: ${err?.error?.message ?? 'unknown error'}`);
      }

      const choice = response.body.choices?.[0];
      const content = choice?.message?.content ?? '';
      return { translatedText: typeof content === 'string' ? content : JSON.stringify(content) };
    }
  };
}

export function listAvailableFoundryModels(): string[] {
  return config.foundryModels;
}

export function resolveRunner(runnerId: string): Runner {
  if (runnerId === azureTranslator.id) return azureTranslator;
  if (runnerId.startsWith('foundry:')) return foundryRunner(runnerId.slice('foundry:'.length));
  throw new Error(`Unknown runner: ${runnerId}`);
}
