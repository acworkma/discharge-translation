// In-process job runner: extract → translate (per-runner) → render → score.
// Acceptable for single-replica HoK demo; replace with Service Bus + worker
// for multi-replica or durable execution.
//
// PHI safety: document text is never logged. Only IDs/lengths/status appear.

import { store } from './storage';
import { resolveRunner, type StructuredRunnerOutput } from './runners';
import { runScoring } from './scoring';
import {
  extractStructured,
  unprotectPlaceholders,
  signatureOf,
  type StructuredDoc
} from './structure';
import { renderMarkdownTranslated, renderTranslated, type RenderedDoc } from './render';

export async function startRun(runId: string): Promise<void> {
  const run = await store.getRun(runId);
  if (!run) return;
  const upload = await store.getUpload(run.uploadId);
  if (!upload) return;
  const blob = await store.getUploadBlob(run.uploadId);

  let structured: StructuredDoc | null = null;
  let extractError: string | null = null;
  try {
    if (!blob && !upload.textPreview) {
      extractError = 'Document has no extractable text.';
    } else {
      const buf =
        blob ?? Buffer.from(upload.textPreview ?? '', 'utf8');
      const mime = blob ? upload.mimeType : 'text/plain';
      structured = await extractStructured(upload.filename, mime, buf);
    }
  } catch (err) {
    extractError = err instanceof Error ? err.message : 'Extraction failed';
  }

  await store.updateRun(runId, (r) => {
    r.status = 'running';
  });

  if (extractError || !structured) {
    const message = extractError || 'Extraction failed';
    await store.updateRun(runId, (r) => {
      for (const t of r.results) {
        t.status = 'failed';
        t.completedAt = Date.now();
        t.error = message;
      }
    });
    return;
  }

  const sourceDoc = structured;

  await Promise.allSettled(
    run.results.map(async (result) => {
      await store.updateRun(runId, (r) => {
        const t = r.results.find((x) => x.runnerId === result.runnerId);
        if (t) {
          t.status = 'running';
          t.startedAt = Date.now();
        }
      });

      try {
        const runner = resolveRunner(result.runnerId);
        const out: StructuredRunnerOutput = await runner.translateStructured({
          markdown: sourceDoc.markdown,
          sourceLang: upload.sourceLang,
          targetLang: upload.targetLang,
          sourceMime: upload.mimeType,
          sourceFilename: upload.filename,
          sourceBytes: blob,
          runId
        });

        // Unprotect placeholders that round-tripped through the engine.
        const translatedMarkdown = unprotectPlaceholders(out.markdown, sourceDoc.placeholders);
        if (!translatedMarkdown || !translatedMarkdown.trim()) {
          throw new Error('Empty translation');
        }

        // Persist the markdown intermediate for diffs / audit.
        await store.writeRunOutput(runId, result.runnerId, translatedMarkdown);

        // Render. NMT-document engines provide their own native bytes;
        // text/LLM engines render via the markdown→docx renderer.
        let rendered: RenderedDoc;
        if (out.renderedOutput) {
          rendered = out.renderedOutput;
        } else if (out.kind === 'llm') {
          rendered = await renderMarkdownTranslated(
            upload.filename,
            upload.mimeType,
            translatedMarkdown
          );
        } else {
          // nmt-text — current Translator. Same lossy plaintext render as before.
          rendered = await renderTranslated(
            upload.filename,
            upload.mimeType,
            translatedMarkdown
          );
        }

        const baseName = upload.filename.replace(/\.[^./\\]+$/, '');
        const safeRunner = result.runnerId.replace(/[^a-zA-Z0-9._-]/g, '_');
        const downloadName = `${baseName}.${upload.targetLang}.${safeRunner}.${rendered.ext}`;
        const renderedPath = await store.writeRunBinary(
          runId,
          result.runnerId,
          rendered.ext,
          rendered.contentType,
          rendered.buffer
        );

        // Score against the source structured representation. We re-derive
        // the candidate's signature from its unprotected markdown so the
        // placeholder check compares apples to apples.
        const scores = await runScoring({
          sourceMarkdown: sourceDoc.rawMarkdown,
          sourceSignature: signatureOf(sourceDoc.rawMarkdown),
          targetMarkdown: translatedMarkdown,
          sourceLang: upload.sourceLang,
          targetLang: upload.targetLang
        });

        await store.updateRun(runId, (r) => {
          const t = r.results.find((x) => x.runnerId === result.runnerId);
          if (t) {
            t.status = 'succeeded';
            t.completedAt = Date.now();
            t.translatedText = translatedMarkdown;
            t.displayName = runner.displayName;
            t.latencyMs = out.latencyMs;
            t.inputTokens = out.inputTokens;
            t.outputTokens = out.outputTokens;
            t.outputBlobPath = renderedPath;
            t.outputContentType = rendered.contentType;
            t.outputFilename = downloadName;
            t.scores = scores;
          }
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Runner failed';
        await store.updateRun(runId, (r) => {
          const t = r.results.find((x) => x.runnerId === result.runnerId);
          if (t) {
            t.status = 'failed';
            t.completedAt = Date.now();
            t.error = message;
          }
        });
      }
    })
  );
}
