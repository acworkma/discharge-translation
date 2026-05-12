'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ScoreSet { clinicalFidelity: number; terminologyConsistency: number; formattingPreservation: number; readability: number; overall: number; }
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
  scores?: ScoreSet;
  error?: string;
}
interface Run { id: string; status: string; createdAt: number; results: RunnerResult[]; }
interface Upload { id: string; filename: string; sourceLang: string; targetLang: string; }

function statusBadge(s: string) {
  const map: Record<string, string> = {
    queued: 'bg-slate-200 text-slate-700',
    running: 'bg-amber-100 text-amber-800 animate-pulse',
    succeeded: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800'
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[s] || 'bg-slate-100'}`}>{s}</span>;
}

function scoreCell(n?: number) {
  if (n == null) return <span className="text-slate-300">—</span>;
  const c = n >= 0.9 ? 'text-emerald-700' : n >= 0.8 ? 'text-amber-700' : 'text-red-700';
  return <span className={`font-semibold ${c}`}>{n.toFixed(2)}</span>;
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

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ run: Run; upload: Upload } | null>(null);

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
    return () => { alive = false; };
  }, [id]);

  if (!data) return <p>Loading...</p>;
  const { run, upload } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Run {run.id.slice(0, 8)}</h1>
          <p className="text-sm text-slate-500">
            {upload?.filename} · {upload?.sourceLang} → {upload?.targetLang} · {run.results.length} models
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Overall</span>
          {statusBadge(run.status)}
        </div>
      </div>

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Model</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Latency</th>
              <th className="px-3 py-2">Input tok</th>
              <th className="px-3 py-2">Output tok</th>
              <th className="px-3 py-2">Overall</th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((r) => (
              <tr key={r.runnerId} className="border-t">
                <td className="px-3 py-2 font-medium">{r.displayName}</td>
                <td className="px-3 py-2 text-center">{statusBadge(r.status)}</td>
                <td className="px-3 py-2 text-center">{fmtMs(r.latencyMs)}</td>
                <td className="px-3 py-2 text-center">{fmtTokens(r.inputTokens)}</td>
                <td className="px-3 py-2 text-center">{fmtTokens(r.outputTokens)}</td>
                <td className="px-3 py-2 text-center">{scoreCell(r.scores?.overall)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {run.results.map((r) => (
          <div key={r.runnerId} className="bg-white rounded shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{r.displayName}</h2>
              {statusBadge(r.status)}
            </div>
            <div className="text-xs text-slate-500 flex gap-4">
              <span>⏱ {fmtMs(r.latencyMs)}</span>
              <span>↑ {fmtTokens(r.inputTokens)}</span>
              <span>↓ {fmtTokens(r.outputTokens)}</span>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Translation</div>
              <pre className="text-xs whitespace-pre-wrap bg-slate-50 border rounded p-2 max-h-72 overflow-auto">
{r.translatedText || (r.status === 'running' ? '…translating…' : r.error || '')}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
