import { store } from './storage';
import { resolveRunner } from './runners';
import { scoreStub } from './scoring';
import { extractText } from './extract';

// In-process async job runner. Acceptable for M2 (single replica). For
// multi-replica or durable execution, replace with Service Bus + worker.
export async function startRun(runId: string): Promise<void> {
  const run = await store.getRun(runId);
  if (!run) return;
  const upload = await store.getUpload(run.uploadId);
  if (!upload) return;
  const blob = await store.getUploadBlob(run.uploadId);

  let sourceText = '';
  let extractError: string | null = null;
  try {
    sourceText = blob
      ? await extractText(upload.filename, upload.mimeType, blob)
      : (upload.textPreview || '');
    if (!sourceText.trim()) extractError = 'Document has no extractable text.';
  } catch (err) {
    extractError = err instanceof Error ? err.message : 'Extraction failed';
  }

  await store.updateRun(runId, (r) => {
    r.status = 'running';
  });

  if (extractError) {
    await store.updateRun(runId, (r) => {
      for (const t of r.results) {
        t.status = 'failed';
        t.completedAt = Date.now();
        t.error = extractError!;
      }
    });
    return;
  }

  // Fire all runners in parallel; each updates its own slot independently.
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
        const out = await runner.translate({
          text: sourceText,
          sourceLang: upload.sourceLang,
          targetLang: upload.targetLang
        });
        if (!out.translatedText || !out.translatedText.trim()) {
          const tokHint =
            out.outputTokens != null
              ? ` (model returned ${out.outputTokens} tokens but no visible content; likely consumed by reasoning — increase max_completion_tokens)`
              : '';
          throw new Error(`Empty translation${tokHint}`);
        }
        // Persist the translation as a blob (downloadable via SAS).
        await store.writeRunOutput(runId, result.runnerId, out.translatedText);
        const scores = scoreStub(sourceText, out.translatedText);
        await store.updateRun(runId, (r) => {
          const t = r.results.find((x) => x.runnerId === result.runnerId);
          if (t) {
            t.status = 'succeeded';
            t.completedAt = Date.now();
            t.translatedText = out.translatedText;
            t.displayName = runner.displayName;
            t.latencyMs = out.latencyMs;
            t.inputTokens = out.inputTokens;
            t.outputTokens = out.outputTokens;
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
