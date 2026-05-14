// Compatibility shim that yields the plaintext flavor of an uploaded document.
// New callers should prefer src/lib/structure.ts which preserves Markdown
// structure and protects clinical numerics with placeholders.
//
// PHI safety: never log document content.

import { extractStructured } from './structure';

export async function extractText(
  filename: string,
  mime: string,
  buf: Buffer
): Promise<string> {
  const { rawMarkdown } = await extractStructured(filename, mime, buf);
  return rawMarkdown;
}
