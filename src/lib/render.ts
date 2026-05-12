// Render translated text back into the original document format.
// PDF -> PDF, DOCX -> DOCX, TXT/MD/anything else -> TXT.
//
// Heavy parsers (docx, pdfkit) are dynamically imported inside the renderers
// so they don't run module-init during Next.js's build-time page-data scan.

export interface RenderedDoc {
  buffer: Buffer;
  contentType: string;
  /** Filename suffix to use, e.g. "pdf", "docx", "txt". */
  ext: string;
}

export async function renderTranslated(
  originalFilename: string,
  originalMime: string,
  translatedText: string
): Promise<RenderedDoc> {
  const lower = originalFilename.toLowerCase();
  const isDocx =
    originalMime.includes('officedocument.wordprocessingml') || lower.endsWith('.docx');
  const isPdf = originalMime === 'application/pdf' || lower.endsWith('.pdf');

  if (isDocx) return renderDocx(translatedText);
  if (isPdf) return renderPdf(translatedText);
  return renderTxt(translatedText);
}

function renderTxt(text: string): RenderedDoc {
  return {
    buffer: Buffer.from(text, 'utf8'),
    contentType: 'text/plain; charset=utf-8',
    ext: 'txt'
  };
}

async function renderDocx(text: string): Promise<RenderedDoc> {
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

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }]
  });

  const buf = await Packer.toBuffer(doc);
  return {
    buffer: buf,
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx'
  };
}

async function renderPdf(text: string): Promise<RenderedDoc> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () =>
      resolve({
        buffer: Buffer.concat(chunks),
        contentType: 'application/pdf',
        ext: 'pdf'
      })
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
