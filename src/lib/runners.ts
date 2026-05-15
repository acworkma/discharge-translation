// Real translation runners.
//   - azure-translator             — Azure AI Translator (Text Translation v3)
//   - azure-doc-translator         — Azure AI Document Translation (async, format-preserving NMT)
//   - foundry:<deployment>         — Foundry/AOAI chat models via Inference SDK
//
// Runners speak two shapes:
//   - translate(input)             — legacy plaintext in, plaintext out.
//   - translateStructured(input)   — structured-markdown in/out with [[PHn]]
//                                    placeholder protection honored. Preferred.
//
// AAD auth (DefaultAzureCredential / Managed Identity) is the default;
// API-key fallback is supported for local development only.

import ModelClient, { isUnexpected } from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
import {
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  type UserDelegationKey
} from '@azure/storage-blob';
import { credential, config, COGNITIVE_SERVICES_SCOPE, blobEndpoint } from './azure';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RunnerInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  modelId?: string;
}

export interface RunnerOutput {
  translatedText: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface StructuredRunnerInput {
  /** Markdown with `[[PHn]]` placeholders already substituted in. */
  markdown: string;
  sourceLang: string;
  targetLang: string;
  /** Mime type of the original upload — used by document-level engines. */
  sourceMime?: string;
  /** Original filename — used by document-level engines. */
  sourceFilename?: string;
  /** Raw upload bytes — required by azure-doc-translator. */
  sourceBytes?: Buffer;
  /** Run id, used for blob-namespacing in document-level engines. */
  runId?: string;
}

export interface StructuredRunnerOutput {
  /** Translated markdown. Caller unprotects placeholders. */
  markdown: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Engine kind — drives downstream rendering choice. */
  kind: 'nmt-text' | 'nmt-document' | 'llm';
  /** For nmt-document: native already-rendered output (DOCX/PDF bytes). */
  renderedOutput?: { buffer: Buffer; contentType: string; ext: string };
}

export interface Runner {
  id: string;
  displayName: string;
  kind: 'translator' | 'doc-translator' | 'foundry';
  translate(input: RunnerInput): Promise<RunnerOutput>;
  translateStructured(input: StructuredRunnerInput): Promise<StructuredRunnerOutput>;
}

// ---------------------------------------------------------------------------
// Azure AI Translator (Text Translation v3)
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
  const token = await credential().getToken(COGNITIVE_SERVICES_SCOPE);
  if (!token) throw new Error('Failed to acquire AAD token for Translator');
  headers['Authorization'] = `Bearer ${token.token}`;
  if (config.translatorRegion) {
    headers['Ocp-Apim-Subscription-Region'] = config.translatorRegion;
  }
  return headers;
}

async function callTextTranslator(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<{ translatedText: string; latencyMs: number }> {
  if (!config.translatorEndpoint) {
    throw new Error('AZURE_TRANSLATOR_ENDPOINT is not configured');
  }
  const t0 = Date.now();
  const base = config.translatorEndpoint.replace(/\/+$/, '');
  const isCustomSubdomain = /\.cognitiveservices\.azure\.com$/i.test(new URL(base).host);
  const usingAad = !config.translatorKey;
  const path =
    usingAad || isCustomSubdomain
      ? `${base}/translator/text/v3.0/translate`
      : `${base}/translate`;
  const params = new URLSearchParams({ 'api-version': '3.0', to: targetLang });
  if (sourceLang) params.set('from', sourceLang);
  const url = `${path}?${params.toString()}`;
  const headers = await translatorAuthHeaders();

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
    translatedChunks.push(body?.[0]?.translations?.[0]?.text ?? '');
  }
  return { translatedText: translatedChunks.join('\n\n'), latencyMs: Date.now() - t0 };
}

export const azureTranslator: Runner = {
  id: 'azure-translator',
  displayName: 'Azure AI Translator',
  kind: 'translator',
  async translate({ text, sourceLang, targetLang }) {
    return callTextTranslator(text, sourceLang, targetLang);
  },
  async translateStructured({ markdown, sourceLang, targetLang }) {
    // Text Translator preserves newlines, so headings/lists/table separators
    // survive structurally. Placeholder tokens look like noise to the engine
    // and pass through unchanged.
    const r = await callTextTranslator(markdown, sourceLang, targetLang);
    return { ...r, markdown: r.translatedText, kind: 'nmt-text' };
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
// Azure AI Document Translation (async, format-preserving NMT)
// ---------------------------------------------------------------------------

export const azureDocTranslator: Runner = {
  id: 'azure-doc-translator',
  displayName: 'Azure Document Translation',
  kind: 'doc-translator',

  async translate({ text, sourceLang, targetLang }) {
    // Document Translation is document-level; degrade to text path.
    return callTextTranslator(text, sourceLang, targetLang);
  },

  async translateStructured(input) {
    if (!config.docTranslatorEndpoint) {
      throw new Error(
        'AZURE_DOC_TRANSLATOR_ENDPOINT (or AZURE_TRANSLATOR_ENDPOINT) is not configured'
      );
    }
    if (!input.sourceBytes || !input.sourceFilename) {
      const r = await callTextTranslator(input.markdown, input.sourceLang, input.targetLang);
      return { ...r, markdown: r.translatedText, kind: 'nmt-text' };
    }
    return runDocumentTranslation({
      sourceBytes: input.sourceBytes,
      sourceFilename: input.sourceFilename,
      sourceMime: input.sourceMime || 'application/octet-stream',
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
      runId: input.runId || crypto.randomUUID()
    });
  }
};

async function runDocumentTranslation(args: {
  sourceBytes: Buffer;
  sourceFilename: string;
  sourceMime: string;
  sourceLang: string;
  targetLang: string;
  runId: string;
}): Promise<StructuredRunnerOutput> {
  const t0 = Date.now();
  const svc = new BlobServiceClient(blobEndpoint(), credential());
  const container = svc.getContainerClient(config.uploadsContainer);
  await container.createIfNotExists();

  const ext = args.sourceFilename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '.docx';
  const srcPath = `doctranslate/${args.runId}/source/in${ext}`;
  const tgtPath = `doctranslate/${args.runId}/target/out${ext}`;

  await container.getBlockBlobClient(srcPath).uploadData(args.sourceBytes, {
    blobHTTPHeaders: { blobContentType: args.sourceMime }
  });
  // Do NOT pre-create the target blob: for storageType=File the service refuses
  // to write into an existing target and returns ValidationFailed.

  const sourceSas = await sasUrl(srcPath, 'r');
  // Target SAS needs create+write (and read+list so the service can verify and
  // we can download). 'racwl' is the conservative superset.
  const targetSas = await sasUrl(tgtPath, 'racwl');

  const base = config.docTranslatorEndpoint.replace(/\/+$/, '');
  const submit = `${base}/translator/document/batches?api-version=2024-05-01`;
  const headers = await translatorAuthHeaders();
  const submitRes = await fetch(submit, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: [
        {
          source: { sourceUrl: sourceSas, language: args.sourceLang || undefined },
          targets: [{ targetUrl: targetSas, language: args.targetLang }],
          storageType: 'File'
        }
      ]
    })
  });
  if (!submitRes.ok) {
    const detail = await submitRes.text().catch(() => '');
    throw new Error(`DocTranslation submit ${submitRes.status}: ${detail.slice(0, 300)}`);
  }
  const opLocation = submitRes.headers.get('operation-location');
  if (!opLocation) throw new Error('DocTranslation: missing operation-location header');

  const deadline = Date.now() + 3 * 60_000;
  let status = 'NotStarted';
  while (Date.now() < deadline) {
    await sleep(2000);
    const poll = await fetch(opLocation, { headers });
    if (!poll.ok) {
      const detail = await poll.text().catch(() => '');
      throw new Error(`DocTranslation poll ${poll.status}: ${detail.slice(0, 300)}`);
    }
    const body = (await poll.json()) as { status?: string };
    status = body.status ?? 'Running';
    if (status === 'Succeeded' || status === 'Failed' || status === 'Cancelled') break;
  }
  if (status !== 'Succeeded') {
    // Pull the per-document error so we surface the real reason instead of a
    // bare top-level status like ValidationFailed.
    let detail = '';
    try {
      const docs = await fetch(`${opLocation}/documents`, { headers });
      if (docs.ok) {
        const j = (await docs.json()) as {
          value?: Array<{ status?: string; error?: { code?: string; message?: string } }>;
        };
        const first = j.value?.find((d) => d.error);
        if (first?.error) {
          detail = ` ${first.error.code || ''}: ${first.error.message || ''}`.trim();
        }
      }
    } catch {
      // ignore — fall through to bare status
    }
    throw new Error(`DocTranslation ended with status=${status}${detail ? ' — ' + detail : ''}`);
  }

  const translatedBuf = await container.getBlockBlobClient(tgtPath).downloadToBuffer();
  const { extractStructured } = await import('./structure');
  const structured = await extractStructured(args.sourceFilename, args.sourceMime, translatedBuf);

  return {
    markdown: structured.rawMarkdown,
    latencyMs: Date.now() - t0,
    kind: 'nmt-document',
    renderedOutput: {
      buffer: translatedBuf,
      contentType: args.sourceMime,
      ext: ext.replace(/^\./, '')
    }
  };
}

async function sasUrl(blobPath: string, permissions: string): Promise<string> {
  const svc = new BlobServiceClient(blobEndpoint(), credential());
  const start = new Date(Date.now() - 60_000);
  const expiry = new Date(Date.now() + 30 * 60_000);
  const udk: UserDelegationKey = await svc.getUserDelegationKey(start, expiry);
  const sas = generateBlobSASQueryParameters(
    {
      containerName: config.uploadsContainer,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn: start,
      expiresOn: expiry,
      protocol: 'https' as never
    },
    udk,
    config.storageAccount
  ).toString();
  return `${blobEndpoint()}/${config.uploadsContainer}/${blobPath}?${sas}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Azure AI Foundry — model catalog inference endpoint
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_PLAIN = [
  'You are a professional medical translator specializing in hospital discharge documentation.',
  'Translate the user message to the requested target language while preserving:',
  '  - clinical meaning and dosing/numerics exactly,',
  '  - section structure, line breaks, lists, and headings,',
  '  - patient-facing tone and reading level.',
  'Do not add commentary, disclaimers, or extra text. Return only the translated document.'
].join(' ');

const SYSTEM_PROMPT_STRUCTURED = [
  'You are a professional medical translator specializing in hospital discharge documentation.',
  'You will receive the source document as MARKDOWN. Translate it into the requested target language.',
  'STRICT RULES:',
  '  1. Preserve the Markdown structure EXACTLY — headings (#/##/###), bullet and numbered lists, pipe tables, paragraph breaks.',
  '  2. Tokens of the form [[PHn]] (where n is an integer) are PROTECTED PLACEHOLDERS for clinical numerics, doses, codes, dates, and times. Copy each [[PHn]] token VERBATIM. Do NOT translate, reorder, drop, or invent placeholders.',
  '  3. Translate only the human-readable prose.',
  '  4. Use patient-facing tone at a 6th–8th grade reading level when the source allows.',
  '  5. Do not add commentary, disclaimers, or extra text. Return ONLY the translated markdown.'
].join('\n');

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

async function callFoundryChat(
  modelId: string,
  system: string,
  userPrompt: string
): Promise<{
  content: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}> {
  const client = foundryClient();
  const t0 = Date.now();
  const isReasoningModel = /^(gpt-5|o[0-9])/i.test(modelId);
  const response = await client.path('/chat/completions').post({
    body: {
      model: modelId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ],
      ...(isReasoningModel
        ? { max_completion_tokens: 32_000 }
        : { temperature: 0.1, max_tokens: 4096 })
    }
  });
  if (isUnexpected(response)) {
    const err = response.body as { error?: { message?: string } };
    throw new Error(`Foundry ${response.status}: ${err?.error?.message ?? 'unknown error'}`);
  }
  const choice = response.body.choices?.[0];
  const content = choice?.message?.content ?? '';
  const usage = response.body.usage as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      }
    | undefined;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens;
  const visible =
    usage?.completion_tokens != null && reasoning != null
      ? Math.max(0, usage.completion_tokens - reasoning)
      : usage?.completion_tokens;
  return {
    content: typeof content === 'string' ? content : JSON.stringify(content),
    latencyMs: Date.now() - t0,
    inputTokens: usage?.prompt_tokens,
    outputTokens: visible
  };
}

function emptyHint(outputTokens?: number): string {
  const tokHint =
    outputTokens != null
      ? ` (model returned ${outputTokens} tokens but no visible content; likely consumed by reasoning — increase max_completion_tokens)`
      : '';
  return `Empty translation${tokHint}`;
}

export function foundryRunner(modelId: string): Runner {
  const info = config.foundryModels.find((m) => m.id === modelId);
  const display = info?.display || modelId;
  return {
    id: `foundry:${modelId}`,
    displayName: `Foundry · ${display}`,
    kind: 'foundry',

    async translate({ text, sourceLang, targetLang }) {
      const userPrompt =
        `Translate the following ${sourceLang || 'source'} discharge document into ${targetLang}.\n\n` +
        '--- BEGIN DOCUMENT ---\n' + text + '\n--- END DOCUMENT ---';
      const r = await callFoundryChat(modelId, SYSTEM_PROMPT_PLAIN, userPrompt);
      if (!r.content || !r.content.trim()) throw new Error(emptyHint(r.outputTokens));
      return {
        translatedText: r.content,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens
      };
    },

    async translateStructured({ markdown, sourceLang, targetLang }) {
      const userPrompt =
        `Source language: ${sourceLang || 'unspecified'}\nTarget language: ${targetLang}\n\n` +
        '--- BEGIN MARKDOWN ---\n' + markdown + '\n--- END MARKDOWN ---';
      const r = await callFoundryChat(modelId, SYSTEM_PROMPT_STRUCTURED, userPrompt);
      if (!r.content || !r.content.trim()) throw new Error(emptyHint(r.outputTokens));
      return {
        markdown: r.content,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        kind: 'llm'
      };
    }
  };
}

export function listAvailableFoundryModels() {
  return config.foundryModels;
}

export function resolveRunner(runnerId: string): Runner {
  if (runnerId === azureTranslator.id) return azureTranslator;
  if (runnerId === azureDocTranslator.id) return azureDocTranslator;
  if (runnerId.startsWith('foundry:')) return foundryRunner(runnerId.slice('foundry:'.length));
  throw new Error(`Unknown runner: ${runnerId}`);
}
