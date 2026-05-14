// Render translated content back into a downloadable document.
//
// Two paths:
//   1. renderTranslated  — legacy plaintext-in, used by NMT runners that emit
//      flat text. Builds a simple DOCX/PDF/TXT.
//   2. renderMarkdownToDocx — preferred path for LLM runners. Walks a
//      Markdown intermediate (headings, paragraphs, lists, pipe tables) and
//      emits a DOCX that preserves that structure, so the format-fidelity
//      scorer can compare like-for-like.
//
// Heavy parsers (docx, pdfkit) are dynamically imported inside the renderers
// so they don't run module-init during Next.js's build-time page-data scan.

export interface RenderedDoc {
  buffer: Buffer;
  contentType: string;
  /** Filename suffix, e.g. "pdf", "docx", "txt". */
  ext: string;
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function renderTranslated(
  originalFilename: string,
  originalMime: string,
  translatedText: string
): Promise<RenderedDoc> {
  const lower = originalFilename.toLowerCase();
  const isDocx =
    originalMime.includes('officedocument.wordprocessingml') || lower.endsWith('.docx');
  const isPdf = originalMime === 'application/pdf' || lower.endsWith('.pdf');

  if (isDocx) return renderDocxFromText(translatedText);
  if (isPdf) return renderPdf(translatedText);
  return renderTxt(translatedText);
}

export async function renderMarkdownTranslated(
  originalFilename: string,
  originalMime: string,
  markdown: string
): Promise<RenderedDoc> {
  const lower = originalFilename.toLowerCase();
  const isText =
    originalMime === 'text/plain' || lower.endsWith('.txt') || lower.endsWith('.md');
  if (isText) return renderTxt(markdown);
  // DOCX in / PDF in / anything-else in → render as DOCX with preserved
  // structure. DOCX is our canonical "format-preserving" output.
  return renderMarkdownToDocx(markdown);
}

function renderTxt(text: string): RenderedDoc {
  return {
    buffer: Buffer.from(text, 'utf8'),
    contentType: 'text/plain; charset=utf-8',
    ext: 'txt'
  };
}

async function renderDocxFromText(text: string): Promise<RenderedDoc> {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const paragraphs = text.split(/\n{2,}/).map((block) => {
    const lines = block.split(/\n/);
    const runs: InstanceType<typeof TextRun>[] = [];
    lines.forEach((line, i) => {
      if (i > 0) runs.push(new TextRun({ break: 1 }));
      runs.push(new TextRun(line));
    });
    return new Paragraph({ children: runs });
  });
  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  const buf = await Packer.toBuffer(doc);
  return { buffer: buf, contentType: DOCX_MIME, ext: 'docx' };
}

async function renderPdf(text: string): Promise<RenderedDoc> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () =>
      resolve({ buffer: Buffer.concat(chunks), contentType: 'application/pdf', ext: 'pdf' })
    );
    doc.on('error', reject);
    doc.font('Helvetica').fontSize(11);
    const blocks = text.split(/\n{2,}/);
    blocks.forEach((block, i) => {
      if (i > 0) doc.moveDown(0.6);
      doc.text(block, { align: 'left' });
    });
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Markdown → DOCX (structure-preserving)
// ---------------------------------------------------------------------------

export async function renderMarkdownToDocx(markdown: string): Promise<RenderedDoc> {
  const docx = await import('docx');
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType
  } = docx;

  const HEADING_MAP = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6
  } as const;

  type Block = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;
  const children: Block[] = [];

  function inlineRuns(text: string): InstanceType<typeof TextRun>[] {
    const tokens = tokenizeInline(text);
    return tokens.map(
      (t) => new TextRun({ text: t.text, bold: t.bold, italics: t.italic })
    );
  }

  function paragraph(text: string): InstanceType<typeof Paragraph> {
    return new Paragraph({ children: inlineRuns(text) });
  }

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = Math.min(6, h[1].length) as 1 | 2 | 3 | 4 | 5 | 6;
      children.push(
        new Paragraph({ heading: HEADING_MAP[level], children: inlineRuns(h[2]) })
      );
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const txt = lines[i].trim().replace(/^[-*]\s+/, '');
        children.push(new Paragraph({ children: inlineRuns(txt), bullet: { level: 0 } }));
        i++;
      }
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        const txt = lines[i].trim().replace(/^\d+[.)]\s+/, '');
        children.push(
          new Paragraph({
            children: inlineRuns(txt),
            numbering: { reference: 'ordered', level: 0 }
          })
        );
        i++;
      }
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const t = buildTable(tableLines, { Table, TableRow, TableCell, Paragraph, WidthType });
      if (t) children.push(t);
      continue;
    }
    // Paragraph: join consecutive non-empty non-block lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i].trim()) &&
      !/^\|.*\|$/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) children.push(paragraph(para.join(' ')));
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.LEFT
            }
          ]
        }
      ]
    },
    sections: [{ properties: {}, children }]
  });
  const buf = await Packer.toBuffer(doc);
  return { buffer: buf, contentType: DOCX_MIME, ext: 'docx' };
}

function buildTable(
  lines: string[],
  ctor: {
    Table: typeof import('docx').Table;
    TableRow: typeof import('docx').TableRow;
    TableCell: typeof import('docx').TableCell;
    Paragraph: typeof import('docx').Paragraph;
    WidthType: typeof import('docx').WidthType;
  }
): InstanceType<typeof ctor.Table> | null {
  const { Table, TableRow, TableCell, Paragraph, WidthType } = ctor;
  if (lines.length === 0) return null;
  const rows: string[][] = [];
  for (const line of lines) {
    const inner = line.replace(/^\|/, '').replace(/\|$/, '');
    const cells = inner.split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  if (rows.length === 0) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  const docxRows = rows.map(
    (r) =>
      new TableRow({
        children: Array.from({ length: cols }).map(
          (_, c) =>
            new TableCell({
              children: [new Paragraph({ text: r[c] ?? '' })]
            })
        )
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: docxRows
  });
}

interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function tokenizeInline(s: string): InlineToken[] {
  const out: InlineToken[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push({ text: buf });
      buf = '';
    }
  };
  while (i < s.length) {
    if (s.startsWith('**', i)) {
      flush();
      const end = s.indexOf('**', i + 2);
      if (end === -1) {
        buf += s.slice(i);
        break;
      }
      out.push({ text: s.slice(i + 2, end), bold: true });
      i = end + 2;
      continue;
    }
    if (s[i] === '_' || s[i] === '*') {
      const ch = s[i];
      flush();
      const end = s.indexOf(ch, i + 1);
      if (end === -1) {
        buf += s.slice(i);
        break;
      }
      out.push({ text: s.slice(i + 1, end), italic: true });
      i = end + 1;
      continue;
    }
    buf += s[i++];
  }
  flush();
  if (out.length === 0) out.push({ text: '' });
  return out;
}
