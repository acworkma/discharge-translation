// Embeddings client for the meaning-fidelity scorer (ask3 §5).
//
// Uses the Azure OpenAI deployment-scoped path on the Foundry resource:
//   POST {foundryBase}/openai/deployments/{deployment}/embeddings?api-version=...
//
// The Foundry Models inference `/models/embeddings` router does NOT correctly
// resolve AOAI embedding deployments (e.g. `text-embedding-3-large-015418`):
// it strips the deployment suffix and routes to a legacy
// `/v1/engines/{base-model}/embeddings` path, which returns HTTP 200 with an
// empty body (grpc-status 12 in the headers). We bypass it and hit the AOAI
// deployment route directly. Chat completions keep using `@azure-rest/ai-inference`
// because that router works for OpenAI-deployed chat models.

import { credential, config, COGNITIVE_SERVICES_SCOPE } from './azure';

const EMBED_API_VERSION = process.env.AZURE_EMBEDDING_API_VERSION || '2024-10-21';

function foundryBase(): string {
  if (!config.foundryEndpoint) {
    throw new Error('AZURE_FOUNDRY_ENDPOINT not configured (required for embeddings)');
  }
  // Strip trailing `/models` (the inference-API suffix) and any trailing slash
  // so we can append AOAI-style paths.
  return config.foundryEndpoint.replace(/\/+$/, '').replace(/\/models$/, '');
}

async function authHeaders(): Promise<Record<string, string>> {
  if (config.foundryApiKey) {
    return { 'api-key': config.foundryApiKey };
  }
  const token = await credential().getToken(COGNITIVE_SERVICES_SCOPE);
  if (!token?.token) {
    throw new Error('Failed to acquire AAD token for cognitiveservices scope');
  }
  return { Authorization: `Bearer ${token.token}` };
}

// text-embedding-3-large has an 8192-token input cap. Long segments (e.g. a
// markdown table serialized into a single line, or a paragraph without
// internal newlines) blow it up with HTTP 400. We split anything over
// MAX_INPUT_CHARS into char-bounded chunks, embed all chunks, and average
// the vectors per original segment to preserve caller order/length.
//
// 1 BPE token ≈ 3-4 chars for English/Spanish; 24000 chars stays well under
// 8192 tokens with margin for CJK and Arabic where tokens are denser.
const MAX_INPUT_CHARS = 24_000;

function splitOversize(text: string): string[] {
  if (text.length <= MAX_INPUT_CHARS) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += MAX_INPUT_CHARS) {
    out.push(text.slice(i, i + MAX_INPUT_CHARS));
  }
  return out;
}

function averageVectors(vecs: number[][]): number[] {
  if (vecs.length === 1) return vecs[0];
  const dim = vecs[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) sum[i] += v[i];
  for (let i = 0; i < dim; i++) sum[i] /= vecs.length;
  return sum;
}

async function rawEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `${foundryBase()}/openai/deployments/${encodeURIComponent(
    config.embeddingDeployment
  )}/embeddings?api-version=${EMBED_API_VERSION}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders())
    },
    body: JSON.stringify({ input: texts })
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      detail = errBody?.error?.message ?? '';
    } catch {
      detail = (await res.text().catch(() => '')) || '';
    }
    throw new Error(`Embeddings ${res.status}: ${detail || res.statusText}`);
  }

  const body = (await res.json()) as {
    data?: Array<{ embedding: number[]; index?: number }>;
  };
  const data = body.data ?? [];
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map((d) => d.embedding);
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Flatten oversized segments into chunks, remembering the chunk count per
  // original input so we can re-aggregate after the API call.
  const flat: string[] = [];
  const chunkCounts: number[] = [];
  for (const t of texts) {
    const chunks = splitOversize(t);
    chunkCounts.push(chunks.length);
    flat.push(...chunks);
  }

  const vecs = await rawEmbed(flat);

  const out: number[][] = [];
  let cursor = 0;
  for (const n of chunkCounts) {
    out.push(averageVectors(vecs.slice(cursor, cursor + n)));
    cursor += n;
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
