// Document structure pipeline.
//
// Goal: produce a single canonical Markdown representation of any uploaded
// discharge document, plus a "placeholder map" that protects clinical numerics
// (doses, labs, ICD-10, dates, times) from translation drift, plus a
// "structure signature" the format-fidelity scorer can compare across source
// and target.
//
// PHI safety: we never log document content. Only counts/IDs.

export interface Placeholder {
  /** Token inserted into the protected markdown, e.g. `[[PH7]]`. */
  token: string;
  /** Original text from the source (e.g. "5 mg", "ICD-10 J18.9", "2026-05-09"). */
  original: string;
  /** Heuristic category for diagnostics; not load-bearing. */
  kind: 'dose' | 'icd10' | 'date' | 'time' | 'number' | 'code';
}

export interface StructureSignature {
  /** Ordered list of heading levels + normalized text. */
  headings: Array<{ level: number; text: string }>;
  /** Count of bullet vs numbered list items. */
  bulletItems: number;
  numberedItems: number;
  /** One entry per markdown table: { rows, cols }. */
  tables: Array<{ rows: number; cols: number }>;
  /** Total non-empty paragraph (block) count. */
  paragraphs: number;
  /** Set of placeholder tokens that appear in the document. */
  placeholders: string[];
}

export interface StructuredDoc {
  /** Markdown with `[[PHn]]` placeholders substituted for protected spans. */
  markdown: string;
  /** Markdown WITHOUT placeholder substitution — for human display. */
  rawMarkdown: string;
  placeholders: Placeholder[];
  signature: StructureSignature;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function extractStructured(
  filename: string,
  mime: string,
  buf: Buffer
): Promise<StructuredDoc> {
  const lower = filename.toLowerCase();
  const isDocx = mime.includes('officedocument.wordprocessingml') || lower.endsWith('.docx');
  const isPdf = mime === 'application/pdf' || lower.endsWith('.pdf');
  const isMd = lower.endsWith('.md') || mime === 'text/markdown';

  let rawMarkdown: string;
  if (isDocx) rawMarkdown = await docxToMarkdown(buf);
  else if (isPdf) rawMarkdown = pdfTextToMarkdown(await pdfToText(buf));
  else if (isMd) rawMarkdown = buf.toString('utf8');
  else rawMarkdown = textToMarkdown(buf.toString('utf8'));

  rawMarkdown = normalizeMarkdown(rawMarkdown);
  if (!rawMarkdown.trim()) {
    throw new Error('Document has no extractable text.');
  }

  const { protectedMarkdown, placeholders } = protectPlaceholders(rawMarkdown);
  const signature = signatureOf(protectedMarkdown);

  return { markdown: protectedMarkdown, rawMarkdown, placeholders, signature };
}

/**
 * Build a structured representation directly from already-extracted Markdown
 * (used for translated output coming back from a runner). Re-applies the
 * signature scorer; does NOT re-protect placeholders.
 */
export function structureFromMarkdown(markdown: string): StructureSignature {
  return signatureOf(normalizeMarkdown(markdown));
}

// ---------------------------------------------------------------------------
// Placeholder protection
// ---------------------------------------------------------------------------

// Order matters: more specific patterns first.
const PROTECTORS: Array<{ kind: Placeholder['kind']; re: RegExp }> = [
  // ICD-10: letter + digits + optional .digits, e.g. J18.9, E11.65, S52.501A
  { kind: 'icd10', re: /\b[A-TV-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?\b/g },
  // Dose values: number (+ optional decimal) + unit
  {
    kind: 'dose',
    re: /\b\d+(?:\.\d+)?\s?(?:mg|mcg|μg|ug|ml|mL|l|L|g|kg|iu|IU|units?|tablets?|caps?|tab|drops?|sprays?|puffs?|%)\b/g
  },
  // ISO dates
  { kind: 'date', re: /\b\d{4}-\d{2}-\d{2}\b/g },
  // US dates
  { kind: 'date', re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // 24h or 12h times
  { kind: 'time', re: /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|am|pm)?\b/g },
  // RxNorm / NDC-ish numeric codes (10+ digits) — keep before generic number
  { kind: 'code', re: /\b\d{10,}\b/g },
  // Bare integers/decimals >= 2 digits (avoids destroying common single digits like "1.")
  { kind: 'number', re: /\b\d{2,}(?:\.\d+)?\b/g }
];

export function protectPlaceholders(markdown: string): {
  protectedMarkdown: string;
  placeholders: Placeholder[];
} {
  const placeholders: Placeholder[] = [];
  let out = markdown;
  for (const { kind, re } of PROTECTORS) {
    out = out.replace(re, (match) => {
      // Do not double-protect existing placeholders.
      if (/^\[\[PH\d+\]\]$/.test(match)) return match;
      const idx = placeholders.length;
      const token = `[[PH${idx}]]`;
      placeholders.push({ token, original: match, kind });
      return token;
    });
  }
  return { protectedMarkdown: out, placeholders };
}

export function unprotectPlaceholders(text: string, placeholders: Placeholder[]): string {
  let out = text;
  for (const p of placeholders) {
    // Use split/join to replace every occurrence; the model is supposed to
    // emit each token exactly once, but be defensive.
    out = out.split(p.token).join(p.original);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structure signature
// ---------------------------------------------------------------------------

export function signatureOf(markdown: string): StructureSignature {
  const headings: StructureSignature['headings'] = [];
  let bulletItems = 0;
  let numberedItems = 0;
  const tables: StructureSignature['tables'] = [];
  let paragraphs = 0;
  const placeholdersSet = new Set<string>();

  const lines = markdown.split(/\r?\n/);
  let i = 0;
  let inTable = false;
  let tableRows = 0;
  let tableCols = 0;
  let inParagraph = false;

  function closeTable() {
    if (inTable) {
      tables.push({ rows: tableRows, cols: tableCols });
      inTable = false;
      tableRows = 0;
      tableCols = 0;
    }
  }
  function closeParagraph() {
    if (inParagraph) {
      paragraphs++;
      inParagraph = false;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // collect placeholder tokens regardless of line role
    for (const m of trimmed.matchAll(/\[\[PH\d+\]\]/g)) placeholdersSet.add(m[0]);

    if (!trimmed) {
      closeTable();
      closeParagraph();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      closeTable();
      closeParagraph();
      headings.push({ level: heading[1].length, text: normalizeHeadingText(heading[2]) });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      closeTable();
      closeParagraph();
      bulletItems++;
      i++;
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      closeTable();
      closeParagraph();
      numberedItems++;
      i++;
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      closeParagraph();
      // Skip the separator row (---).
      const isSeparator = /^\|\s*:?-{3,}.*\|$/.test(trimmed.replace(/\s/g, ''));
      if (!inTable) {
        inTable = true;
        tableRows = 0;
        tableCols = trimmed.split('|').filter((c) => c !== '').length;
      }
      if (!isSeparator) tableRows++;
      i++;
      continue;
    }

    // Regular paragraph line.
    closeTable();
    inParagraph = true;
    i++;
  }
  closeTable();
  closeParagraph();

  return {
    headings,
    bulletItems,
    numberedItems,
    tables,
    paragraphs,
    placeholders: Array.from(placeholdersSet).sort()
  };
}

function normalizeHeadingText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Format-specific parsers
// ---------------------------------------------------------------------------

async function docxToMarkdown(buf: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  // mammoth's default inlines DOCX images as <img src="data:image/...;base64,...">.
  // For a clinical document those payloads are useless to the LLM (hundreds of
  // KB of base64) and they blow past the embedding 8192-token cap, so we
  // suppress them and emit a stable [FIGURE] token that translates cleanly
  // and keeps the surrounding paragraph structure intact.
  const html =
    (
      await mammoth.convertToHtml(
        { buffer: buf },
        {
          convertImage: mammoth.images.imgElement(async () => ({
            src: '',
            alt: '[FIGURE]'
          }))
        }
      )
    ).value || '';
  const TurndownService = (await import('turndown')).default;
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_'
  });
  // Drop any <img> outright (with or without a base64 src). The alt text we
  // set above ([FIGURE]) survives via the explicit rule below.
  turndown.addRule('stripImg', {
    filter: 'img',
    replacement: (_c, node) => {
      type N = { getAttribute?: (k: string) => string | null };
      const alt = (node as N).getAttribute?.('alt') || '';
      return alt ? alt : '[FIGURE]';
    }
  });
  // Turndown's default does not handle tables well; install the lightweight
  // built-in GFM table rule manually.
  turndown.addRule('table', {
    filter: 'table',
    replacement: htmlTableToMarkdown
  });
  const md = turndown.turndown(html);
  // Belt-and-braces: if anything still leaks a data:image URL (e.g. inline
  // CSS background-images that turndown picked up), nuke it. The regex is
  // greedy on the base64 body which can contain '+', '/', '=' and newlines.
  return md.replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/gi, '[FIGURE]');
}

function htmlTableToMarkdown(_content: string, node: unknown): string {
  // turndown passes a real DOM-like node. We sniff for rows/cells via duck typing.
  type N = { tagName?: string; childNodes?: N[]; textContent?: string };
  const table = node as N;
  const rows: string[][] = [];
  function walk(n: N | undefined) {
    if (!n) return;
    if (n.tagName === 'TR') {
      const cells: string[] = [];
      const children = n.childNodes || [];
      for (const c of children) {
        if (c.tagName === 'TD' || c.tagName === 'TH') {
          cells.push((c.textContent || '').replace(/\s+/g, ' ').trim());
        }
      }
      if (cells.length) rows.push(cells);
    }
    for (const c of n.childNodes || []) walk(c);
  }
  walk(table);
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const padded = [...r];
    while (padded.length < cols) padded.push('');
    return padded;
  });
  const header = norm[0];
  const sep = new Array(cols).fill('---');
  const body = norm.slice(1);
  const out: string[] = [];
  out.push('| ' + header.join(' | ') + ' |');
  out.push('| ' + sep.join(' | ') + ' |');
  for (const r of body) out.push('| ' + r.join(' | ') + ' |');
  return '\n' + out.join('\n') + '\n';
}

async function pdfToText(buf: Buffer): Promise<string> {
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

// PDF text comes back as flat lines. Heuristics: ALL-CAPS short lines become
// H2, lines ending with ':' followed by content become H3, dashed lines
// become bullets. Not perfect; the format-fidelity scorer will compare
// like-for-like since both source and back-translation go through this same
// path.
function pdfTextToMarkdown(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      out.push('');
      continue;
    }
    if (/^[\s•\-*]\s*/.test(line) && line.trim().length > 1) {
      out.push('- ' + line.replace(/^[\s•\-*]+\s*/, ''));
      continue;
    }
    if (/^\d+[.)]\s+/.test(line.trim())) {
      out.push(line.trim());
      continue;
    }
    const trimmed = line.trim();
    if (
      trimmed.length <= 80 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      !/[.!?]$/.test(trimmed)
    ) {
      out.push('## ' + toTitleCase(trimmed));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function textToMarkdown(text: string): string {
  // Plain text: assume blank-line-separated paragraphs are already meaningful.
  return text.replace(/\r\n/g, '\n');
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

function normalizeMarkdown(s: string): string {
  // Collapse 3+ blank lines to 2.
  return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
