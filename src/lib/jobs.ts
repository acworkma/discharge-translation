import { store } from './storage';
import { resolveRunner } from './runners';
import { scoreStub } from './scoring';

// In-process async job runner. Acceptable for M2 (single replica). For
// multi-replica or durable execution, replace with Service Bus + worker.
export async function startRun(runId: string): Promise<void> {
  const run = await store.getRun(runId);
  if (!run) return;
  const upload = await store.getUpload(run.uploadId);
  if (!upload) return;
  const blob = await store.getUploadBlob(run.uploadId);
  // Stub: treat blob as utf-8 text. Real OCR/PDF/DOCX parsing comes next.
  const sourceText = blob ? blob.toString('utf8') : (upload.textPreview || '');

  await store.updateRun(runId, (r) => {
    r.status = 'running';
  });

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
