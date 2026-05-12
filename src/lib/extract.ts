// Document text extraction. Centralized so jobs.ts and any future preview
// path use the same logic. PHI safety: never log document content.
//
// Heavy parsers (mammoth, pdf-parse) are dynamically imported inside the
// extractor so they don't run module-init at Next.js build time.

export async function extractText(filename: string, mime: string, buf: Buffer): Promise<string> {
  const lower = filename.toLowerCase();
  const isDocx = mime.includes('officedocument.wordprocessingml') || lower.endsWith('.docx');
  const isPdf = mime === 'application/pdf' || lower.endsWith('.pdf');
  const isText = mime.startsWith('text/') || lower.endsWith('.txt') || lower.endsWith('.md');

  if (isDocx) {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || '';
  }
  if (isPdf) {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const out = await parser.getText();
      const text = (out as { text?: string }).text;
      if (text) return text;
      const pages = (out as { pages?: Array<{ text?: string }> }).pages;
      return pages?.map((p) => p.text || '').join('\n\n') || '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (isText) {
    return buf.toString('utf8');
  }
  // Fallback: try utf8, but reject if it looks binary.
  const text = buf.toString('utf8');
  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)) bad++;
  }
  if (text.length > 0 && bad / text.length > 0.05) {
    throw new Error(
      `Unsupported file type "${mime || 'unknown'}" (${filename}). Upload TXT, PDF, or DOCX.`
    );
  }
  return text;
}
