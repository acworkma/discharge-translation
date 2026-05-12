// Persistent store backed by Azure Blob (raw upload bytes + translation outputs)
// and Azure Table Storage (upload + run metadata).
//
// PHI safety: document text is never logged. Only IDs/lengths/status appear in logs.

import { randomUUID } from 'node:crypto';
import {
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  type UserDelegationKey
} from '@azure/storage-blob';
import { TableClient, odata } from '@azure/data-tables';
import { credential, config, blobEndpoint, tableEndpoint } from './azure';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ScoreSet {
  clinicalFidelity: number;
  terminologyConsistency: number;
  formattingPreservation: number;
  readability: number;
  overall: number;
}

export interface RunnerResult {
  runnerId: string;
  displayName: string;
  status: RunStatus;
  startedAt?: number;
  completedAt?: number;
  translatedText?: string;
  scores?: ScoreSet;
  error?: string;
}

export interface UploadRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sourceLang: string;
  targetLang: string;
  uploadedAt: number;
  textPreview?: string;
}

export interface RunRecord {
  id: string;
  uploadId: string;
  createdAt: number;
  status: RunStatus;
  selectedRunners: string[];
  results: RunnerResult[];
}

// --- clients (lazy) -------------------------------------------------------

let _blobSvc: BlobServiceClient | null = null;
let _uploadsTable: TableClient | null = null;
let _runsTable: TableClient | null = null;
let _initPromise: Promise<void> | null = null;

function blobService(): BlobServiceClient {
  if (!_blobSvc) _blobSvc = new BlobServiceClient(blobEndpoint(), credential());
  return _blobSvc;
}

function uploadsTable(): TableClient {
  if (!_uploadsTable) {
    _uploadsTable = new TableClient(tableEndpoint(), config.uploadsTable, credential());
  }
  return _uploadsTable;
}

function runsTable(): TableClient {
  if (!_runsTable) {
    _runsTable = new TableClient(tableEndpoint(), config.runsTable, credential());
  }
  return _runsTable;
}

async function ensureInfra(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const container = blobService().getContainerClient(config.uploadsContainer);
    await container.createIfNotExists();
    await uploadsTable().createTable();
    await runsTable().createTable();
  })();
  return _initPromise;
}

// --- entity (de)serialization --------------------------------------------

const PARTITION = 'v1';

function uploadToEntity(u: UploadRecord) {
  return {
    partitionKey: PARTITION,
    rowKey: u.id,
    filename: u.filename,
    mimeType: u.mimeType,
    sizeBytes: u.sizeBytes,
    sourceLang: u.sourceLang,
    targetLang: u.targetLang,
    uploadedAt: u.uploadedAt,
    textPreview: u.textPreview ?? ''
  };
}

function entityToUpload(e: Record<string, unknown>): UploadRecord {
  return {
    id: String(e.rowKey),
    filename: String(e.filename),
    mimeType: String(e.mimeType),
    sizeBytes: Number(e.sizeBytes),
    sourceLang: String(e.sourceLang),
    targetLang: String(e.targetLang),
    uploadedAt: Number(e.uploadedAt),
    textPreview: e.textPreview ? String(e.textPreview) : undefined
  };
}

function runToEntity(r: RunRecord) {
  return {
    partitionKey: PARTITION,
    rowKey: r.id,
    uploadId: r.uploadId,
    createdAt: r.createdAt,
    status: r.status,
    selectedRunners: JSON.stringify(r.selectedRunners),
    results: JSON.stringify(r.results)
  };
}

function entityToRun(e: Record<string, unknown>): RunRecord {
  return {
    id: String(e.rowKey),
    uploadId: String(e.uploadId),
    createdAt: Number(e.createdAt),
    status: e.status as RunStatus,
    selectedRunners: JSON.parse(String(e.selectedRunners ?? '[]')),
    results: JSON.parse(String(e.results ?? '[]'))
  };
}

// --- public API -----------------------------------------------------------

export const store = {
  newId: () => randomUUID(),

  async saveUpload(
    rec: Omit<UploadRecord, 'id' | 'uploadedAt'>,
    data: Buffer
  ): Promise<UploadRecord> {
    await ensureInfra();
    const id = randomUUID();
    const full: UploadRecord = { ...rec, id, uploadedAt: Date.now() };

    const container = blobService().getContainerClient(config.uploadsContainer);
    const block = container.getBlockBlobClient(`${id}/source`);
    await block.uploadData(data, {
      blobHTTPHeaders: { blobContentType: full.mimeType }
    });

    await uploadsTable().createEntity(uploadToEntity(full));
    return full;
  },

  async getUpload(id: string): Promise<UploadRecord | undefined> {
    await ensureInfra();
    try {
      const e = await uploadsTable().getEntity<Record<string, unknown>>(PARTITION, id);
      return entityToUpload(e);
    } catch (err: unknown) {
      if ((err as { statusCode?: number })?.statusCode === 404) return undefined;
      throw err;
    }
  },

  async getUploadBlob(id: string): Promise<Buffer | undefined> {
    await ensureInfra();
    const container = blobService().getContainerClient(config.uploadsContainer);
    const block = container.getBlockBlobClient(`${id}/source`);
    if (!(await block.exists())) return undefined;
    return await block.downloadToBuffer();
  },

  async listUploads(): Promise<UploadRecord[]> {
    await ensureInfra();
    const out: UploadRecord[] = [];
    for await (const e of uploadsTable().listEntities<Record<string, unknown>>({
      queryOptions: { filter: odata`PartitionKey eq ${PARTITION}` }
    })) {
      out.push(entityToUpload(e));
    }
    return out.sort((a, b) => b.uploadedAt - a.uploadedAt);
  },

  async deleteUpload(id: string): Promise<void> {
    await ensureInfra();
    const runs = await store.listRunsForUpload(id);
    for (const r of runs) await store.deleteRun(r.id);

    try {
      await uploadsTable().deleteEntity(PARTITION, id);
    } catch (err: unknown) {
      if ((err as { statusCode?: number })?.statusCode !== 404) throw err;
    }

    const container = blobService().getContainerClient(config.uploadsContainer);
    for await (const blob of container.listBlobsFlat({ prefix: `${id}/` })) {
      await container.deleteBlob(blob.name);
    }
  },

  async createRun(uploadId: string, selectedRunners: string[]): Promise<RunRecord> {
    await ensureInfra();
    const id = randomUUID();
    const rec: RunRecord = {
      id,
      uploadId,
      createdAt: Date.now(),
      status: 'queued',
      selectedRunners,
      results: selectedRunners.map((rid) => ({
        runnerId: rid,
        displayName: rid,
        status: 'queued'
      }))
    };
    await runsTable().createEntity(runToEntity(rec));
    return rec;
  },

  async getRun(id: string): Promise<RunRecord | undefined> {
    await ensureInfra();
    try {
      const e = await runsTable().getEntity<Record<string, unknown>>(PARTITION, id);
      return entityToRun(e);
    } catch (err: unknown) {
      if ((err as { statusCode?: number })?.statusCode === 404) return undefined;
      throw err;
    }
  },

  async listRunsForUpload(uploadId: string): Promise<RunRecord[]> {
    await ensureInfra();
    const out: RunRecord[] = [];
    for await (const e of runsTable().listEntities<Record<string, unknown>>({
      queryOptions: { filter: odata`PartitionKey eq ${PARTITION} and uploadId eq ${uploadId}` }
    })) {
      out.push(entityToRun(e));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },

  async listRuns(): Promise<RunRecord[]> {
    await ensureInfra();
    const out: RunRecord[] = [];
    for await (const e of runsTable().listEntities<Record<string, unknown>>({
      queryOptions: { filter: odata`PartitionKey eq ${PARTITION}` }
    })) {
      out.push(entityToRun(e));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },

  async updateRun(id: string, mut: (r: RunRecord) => void): Promise<void> {
    await ensureInfra();
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await runsTable()
        .getEntity<Record<string, unknown>>(PARTITION, id)
        .catch((err: unknown) => {
          if ((err as { statusCode?: number })?.statusCode === 404) return undefined;
          throw err;
        });
      if (!current) return;
      const r = entityToRun(current);
      mut(r);
      if (r.results.every((x) => x.status === 'succeeded')) r.status = 'succeeded';
      else if (
        r.results.some((x) => x.status === 'failed') &&
        r.results.every((x) => x.status === 'failed' || x.status === 'succeeded')
      ) r.status = 'failed';
      else if (r.results.some((x) => x.status === 'running' || x.status === 'queued'))
        r.status = 'running';

      try {
        await runsTable().updateEntity(
          { ...runToEntity(r), etag: (current as { etag?: string }).etag },
          'Replace'
        );
        return;
      } catch (err: unknown) {
        if ((err as { statusCode?: number })?.statusCode === 412) continue;
        throw err;
      }
    }
    throw new Error(`updateRun(${id}): exhausted retries`);
  },

  async deleteRun(id: string): Promise<void> {
    await ensureInfra();
    try {
      await runsTable().deleteEntity(PARTITION, id);
    } catch (err: unknown) {
      if ((err as { statusCode?: number })?.statusCode !== 404) throw err;
    }
    const container = blobService().getContainerClient(config.uploadsContainer);
    for await (const blob of container.listBlobsFlat({ prefix: `runs/${id}/` })) {
      await container.deleteBlob(blob.name);
    }
  },

  async writeRunOutput(runId: string, runnerId: string, content: string): Promise<string> {
    await ensureInfra();
    const container = blobService().getContainerClient(config.uploadsContainer);
    const safe = runnerId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `runs/${runId}/${safe}.txt`;
    await container
      .getBlockBlobClient(path)
      .upload(content, Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'text/plain; charset=utf-8' }
      });
    return path;
  },

  async getDownloadUrl(blobPath: string, ttlMinutes = 10): Promise<string> {
    await ensureInfra();
    const svc = blobService();
    const start = new Date(Date.now() - 60_000);
    const expiry = new Date(Date.now() + ttlMinutes * 60_000);
    const udk: UserDelegationKey = await svc.getUserDelegationKey(start, expiry);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: config.uploadsContainer,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: start,
        expiresOn: expiry,
        protocol: 'https' as never
      },
      udk,
      config.storageAccount
    ).toString();
    return `${blobEndpoint()}/${config.uploadsContainer}/${blobPath}?${sas}`;
  }
};
