'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { diffLines, type Change } from 'diff';

interface FormatBreakdown {
  score: number;
  headingOrder: number;
  headingCount: number;
  bulletCount: number;
  numberedCount: number;
  tableCount: number;
  tableShape: number;
  paragraphCount: number;
  placeholders: number;
}
interface MeaningBreakdown {
  score: number;
  meanCosine: number;
  minCosine: number;
  segmentsCompared: number;
  error?: string;
}
interface SafetyBreakdown {
  score: number;
  raw: number;
  rationale: string;
  error?: string;
}
interface CriticalError {
  kind: string;
  severity: 'low' | 'medium' | 'high';
  detail: string;
}
interface ScoreSet {
  ctqs?: number;
  decision?: 'auto_publish' | 'human_review' | 'reject';
  format?: FormatBreakdown;
  meaning?: MeaningBreakdown;
  safety?: SafetyBreakdown;
  criticalErrors?: CriticalError[];
  criticalGateFailed?: boolean;
  overall?: number;
}
interface RunnerResult {
  runnerId: string;
  displayName: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  translatedText?: string;
  outputBlobPath?: string;
  outputFilename?: string;
  scores?: ScoreSet;
  error?: string;
}
interface Run {
  id: string;
  status: string;
  createdAt: number;
  results: RunnerResult[];
}
interface Upload {
  id: string;
  filename: string;
  sourceLang: string;
  targetLang: string;
  textPreview?: string;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    queued: 'bg-slate-200 text-slate-700',
    running: 'bg-amber-100 text-amber-800 animate-pulse',
    succeeded: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800'
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[s] || 'bg-slate-100'}`}>
      {s}
    </span>
  );
}

function decisionBadge(d?: ScoreSet['decision']) {
  if (!d) return <span className="text-slate-300">—</span>;
  const map: Record<string, string> = {
    auto_publish: 'bg-emerald-100 text-emerald-800',
    human_review: 'bg-amber-100 text-amber-800',
    reject: 'bg-red-100 text-red-800'
  };
  const label: Record<string, string> = {
    auto_publish: 'Auto-publish',
    human_review: 'Human review',
    reject: 'Reject'
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[d]}`}>{label[d]}</span>
  );
}

function scoreCell(n?: number) {
  if (n == null) return <span className="text-slate-300">—</span>;
  const c = n >= 90 ? 'text-emerald-700' : n >= 80 ? 'text-amber-700' : 'text-red-700';
  return <span className={`font-semibold ${c}`}>{n.toFixed(1)}</span>;
}

function fmtMs(ms?: number) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function fmtTokens(n?: number) {
  if (n == null) return '—';
  return n.toLocaleString();
}

type SortKey = 'ctqs' | 'format' | 'meaning' | 'safety' | 'latency';

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ run: Run; upload: Upload } | null>(null);
  const [tab, setTab] = useState<'leaderboard' | 'diff'>('leaderboard');
  const [sortKey, setSortKey] = useState<SortKey>('ctqs');
  const [diffA, setDiffA] = useState<string>('');
  const [diffB, setDiffB] = useState<string>('');

  useEffect(() => {
    let alive = true;
    async function tick() {
      const res = await fetch(`/api/runs/${id}`);
      if (!res.ok) return;
      const j = await res.json();
      if (alive) setData(j);
      if (alive && j.run.status !== 'succeeded' && j.run.status !== 'failed') {
        setTimeout(tick, 1500);
      }
    }
    tick();
    return () => {
      alive = false;
    };
  }, [id]);

  // Pick sensible defaults for the diff dropdowns once results land.
  useEffect(() => {
    if (!data) return;
    const done = data.run.results.filter((r) => r.status === 'succeeded');
    if (done.length >= 2) {
      if (!diffA) setDiffA(done[0].runnerId);
      if (!diffB) setDiffB(done[1].runnerId);
    } else if (done.length === 1 && !diffA) {
      setDiffA(done[0].runnerId);
    }
  }, [data, diffA, diffB]);

  const sortedResults = useMemo(() => {
    if (!data) return [];
    const r = [...data.run.results];
    r.sort((a, b) => keyVal(b, sortKey) - keyVal(a, sortKey));
    return r;
  }, [data, sortKey]);

  if (!data) return <p>Loading...</p>;
  const { run, upload } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Run {run.id.slice(0, 8)}</h1>
          <p className="text-sm text-slate-500">
            {upload?.filename} · {upload?.sourceLang} → {upload?.targetLang} ·{' '}
            {run.results.length} engines
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Overall</span>
          {statusBadge(run.status)}
        </div>
      </div>

      <div className="border-b border-slate-200 flex gap-4 text-sm">
        <TabBtn active={tab === 'leaderboard'} onClick={() => setTab('leaderboard')}>
          Leaderboard
        </TabBtn>
        <TabBtn active={tab === 'diff'} onClick={() => setTab('diff')}>
          Diff
        </TabBtn>
      </div>

      {tab === 'leaderboard' && (
        <LeaderboardView
          results={sortedResults}
          runId={run.id}
          sortKey={sortKey}
          setSortKey={setSortKey}
        />
      )}
      {tab === 'diff' && (
        <DiffView
          results={run.results}
          upload={upload}
          diffA={diffA}
          setDiffA={setDiffA}
          diffB={diffB}
          setDiffB={setDiffB}
        />
      )}
    </div>
  );
}

function keyVal(r: RunnerResult, k: SortKey): number {
  switch (k) {
    case 'ctqs':
      return r.scores?.ctqs ?? -1;
    case 'format':
      return r.scores?.format?.score ?? -1;
    case 'meaning':
      return r.scores?.meaning?.score ?? -1;
    case 'safety':
      return r.scores?.safety?.score ?? -1;
    case 'latency':
      // Lower latency is better → invert.
      return r.latencyMs != null ? -r.latencyMs : -Number.MAX_SAFE_INTEGER;
  }
}

function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 -mb-px border-b-2 ${
        active
          ? 'border-brand text-brand font-medium'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function SortableTh({
  label,
  k,
  sortKey,
  setSortKey
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
}) {
  return (
    <th
      onClick={() => setSortKey(k)}
      className={`px-3 py-2 cursor-pointer select-none ${
        sortKey === k ? 'text-brand' : ''
      }`}
    >
      {label}
      {sortKey === k && ' ▼'}
    </th>
  );
}

function LeaderboardView({
  results,
  runId,
  sortKey,
  setSortKey
}: {
  results: RunnerResult[];
  runId: string;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Engine</th>
              <th className="px-3 py-2">Status</th>
              <SortableTh label="CTQS" k="ctqs" sortKey={sortKey} setSortKey={setSortKey} />
              <SortableTh label="Format" k="format" sortKey={sortKey} setSortKey={setSortKey} />
              <SortableTh
                label="Meaning"
                k="meaning"
                sortKey={sortKey}
                setSortKey={setSortKey}
              />
              <SortableTh label="Safety" k="safety" sortKey={sortKey} setSortKey={setSortKey} />
              <th className="px-3 py-2">Critical</th>
              <SortableTh
                label="Latency"
                k="latency"
                sortKey={sortKey}
                setSortKey={setSortKey}
              />
              <th className="px-3 py-2">Tokens</th>
              <th className="px-3 py-2">Decision</th>
              <th className="px-3 py-2">Download</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.runnerId} className="border-t">
                <td className="px-3 py-2 font-medium">{r.displayName}</td>
                <td className="px-3 py-2 text-center">{statusBadge(r.status)}</td>
                <td className="px-3 py-2 text-center">{scoreCell(r.scores?.ctqs)}</td>
                <td className="px-3 py-2 text-center">{scoreCell(r.scores?.format?.score)}</td>
                <td className="px-3 py-2 text-center">{scoreCell(r.scores?.meaning?.score)}</td>
                <td className="px-3 py-2 text-center">{scoreCell(r.scores?.safety?.score)}</td>
                <td className="px-3 py-2 text-center">
                  {r.scores?.criticalGateFailed ? (
                    <span className="text-red-700 font-semibold">FAIL</span>
                  ) : r.scores?.criticalErrors && r.scores.criticalErrors.length > 0 ? (
                    <span className="text-amber-700">
                      {r.scores.criticalErrors.length} soft
                    </span>
                  ) : (
                    <span className="text-emerald-700">OK</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">{fmtMs(r.latencyMs)}</td>
                <td className="px-3 py-2 text-center text-xs text-slate-500">
                  ↑{fmtTokens(r.inputTokens)} ↓{fmtTokens(r.outputTokens)}
                </td>
                <td className="px-3 py-2 text-center">{decisionBadge(r.scores?.decision)}</td>
                <td className="px-3 py-2 text-center">
                  {r.outputBlobPath ? (
                    <a
                      href={`/api/runs/${runId}/download?runner=${encodeURIComponent(r.runnerId)}`}
                      className="text-xs bg-brand text-white px-2 py-1 rounded hover:bg-brand-dark"
                    >
                      {r.outputFilename ? r.outputFilename.split('.').pop()?.toUpperCase() : 'doc'}
                    </a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {results.map((r) => (
        <ResultDetail key={r.runnerId} r={r} />
      ))}
    </div>
  );
}

function ResultDetail({ r }: { r: RunnerResult }) {
  const s = r.scores;
  return (
    <div className="bg-white rounded shadow p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{r.displayName}</h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>⏱ {fmtMs(r.latencyMs)}</span>
          <span>
            ↑ {fmtTokens(r.inputTokens)} ↓ {fmtTokens(r.outputTokens)}
          </span>
          {statusBadge(r.status)}
        </div>
      </div>

      {s && (
        <div className="grid sm:grid-cols-3 gap-4 text-xs">
          <div className="border rounded p-2">
            <div className="font-medium mb-1 text-slate-600">
              Format · {s.format?.score?.toFixed(1) ?? '—'}
            </div>
            {s.format && (
              <ul className="space-y-0.5 text-slate-500">
                <li>Heading order: {s.format.headingOrder.toFixed(1)}</li>
                <li>Heading count: {s.format.headingCount.toFixed(1)}</li>
                <li>Bullet count: {s.format.bulletCount.toFixed(1)}</li>
                <li>Numbered count: {s.format.numberedCount.toFixed(1)}</li>
                <li>Table count: {s.format.tableCount.toFixed(1)}</li>
                <li>Table shape: {s.format.tableShape.toFixed(1)}</li>
                <li>Paragraphs: {s.format.paragraphCount.toFixed(1)}</li>
                <li>Placeholders: {s.format.placeholders.toFixed(1)}</li>
              </ul>
            )}
          </div>
          <div className="border rounded p-2">
            <div className="font-medium mb-1 text-slate-600">
              Meaning · {s.meaning?.score?.toFixed(1) ?? '—'}
            </div>
            {s.meaning && (
              <ul className="space-y-0.5 text-slate-500">
                <li>Mean cosine: {s.meaning.meanCosine.toFixed(3)}</li>
                <li>Min cosine: {s.meaning.minCosine.toFixed(3)}</li>
                <li>Segments: {s.meaning.segmentsCompared}</li>
                {s.meaning.error && (
                  <li className="text-red-700 break-words">⚠ {s.meaning.error}</li>
                )}
              </ul>
            )}
          </div>
          <div className="border rounded p-2">
            <div className="font-medium mb-1 text-slate-600">
              Safety · {s.safety?.score?.toFixed(1) ?? '—'}
            </div>
            {s.safety && (
              <ul className="space-y-0.5 text-slate-500">
                <li>Likert: {s.safety.raw}/5</li>
                <li className="line-clamp-3">{s.safety.rationale}</li>
              </ul>
            )}
          </div>
        </div>
      )}

      {s?.criticalErrors && s.criticalErrors.length > 0 && (
        <div className="text-xs">
          <div className="font-medium text-slate-600 mb-1">Critical errors</div>
          <ul className="space-y-1">
            {s.criticalErrors.map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${
                    e.severity === 'high'
                      ? 'bg-red-100 text-red-800'
                      : e.severity === 'medium'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {e.kind}
                </span>
                <span className="text-slate-600">{e.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-xs text-slate-500 mb-1">Translation</div>
        <pre className="text-xs whitespace-pre-wrap bg-slate-50 border rounded p-2 max-h-72 overflow-auto">
          {r.translatedText || (r.status === 'running' ? '…translating…' : r.error || '')}
        </pre>
      </div>
    </div>
  );
}

function DiffView({
  results,
  upload,
  diffA,
  setDiffA,
  diffB,
  setDiffB
}: {
  results: RunnerResult[];
  upload: Upload;
  diffA: string;
  setDiffA: (s: string) => void;
  diffB: string;
  setDiffB: (s: string) => void;
}) {
  const succeeded = results.filter((r) => r.status === 'succeeded');
  const a = results.find((r) => r.runnerId === diffA);
  const b = results.find((r) => r.runnerId === diffB);

  const changes: Change[] = useMemo(() => {
    if (!a?.translatedText || !b?.translatedText) return [];
    return diffLines(a.translatedText, b.translatedText);
  }, [a, b]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded shadow p-4 grid sm:grid-cols-2 gap-3 text-sm">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Left</label>
          <select
            value={diffA}
            onChange={(e) => setDiffA(e.target.value)}
            className="border rounded px-3 py-2 w-full"
          >
            <option value="">—</option>
            {succeeded.map((r) => (
              <option key={r.runnerId} value={r.runnerId}>
                {r.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Right</label>
          <select
            value={diffB}
            onChange={(e) => setDiffB(e.target.value)}
            className="border rounded px-3 py-2 w-full"
          >
            <option value="">—</option>
            {succeeded.map((r) => (
              <option key={r.runnerId} value={r.runnerId}>
                {r.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {upload.textPreview && (
        <details className="bg-white rounded shadow p-3">
          <summary className="text-sm font-medium cursor-pointer">Source preview</summary>
          <pre className="text-xs whitespace-pre-wrap bg-slate-50 border rounded p-2 mt-2 max-h-60 overflow-auto">
            {upload.textPreview}
          </pre>
        </details>
      )}

      <div className="bg-white rounded shadow p-4">
        {!a || !b ? (
          <p className="text-sm text-slate-500">
            Pick two succeeded translations to compare.
          </p>
        ) : (
          <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-[60vh] overflow-auto">
            {changes.map((c, i) => (
              <span
                key={i}
                className={
                  c.added
                    ? 'bg-emerald-100 text-emerald-900'
                    : c.removed
                    ? 'bg-red-100 text-red-900 line-through'
                    : 'text-slate-700'
                }
              >
                {c.value}
              </span>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
