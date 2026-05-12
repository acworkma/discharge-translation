'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ScoreSet { clinicalFidelity: number; terminologyConsistency: number; formattingPreservation: number; readability: number; overall: number; }
interface RunnerResult { runnerId: string; displayName: string; status: string; translatedText?: string; scores?: ScoreSet; error?: string; }
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
            {upload?.filename} · {upload?.sourceLang} → {upload?.targetLang}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Overall</span>
          {statusBadge(run.status)}
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {run.results.map((r) => (
          <div key={r.runnerId} className="bg-white rounded shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{r.displayName}</h2>
              {statusBadge(r.status)}
            </div>
            <div className="grid grid-cols-5 gap-2 text-xs text-center">
              <div><div className="text-slate-500">Clin</div>{scoreCell(r.scores?.clinicalFidelity)}</div>
              <div><div className="text-slate-500">Term</div>{scoreCell(r.scores?.terminologyConsistency)}</div>
              <div><div className="text-slate-500">Fmt</div>{scoreCell(r.scores?.formattingPreservation)}</div>
              <div><div className="text-slate-500">Read</div>{scoreCell(r.scores?.readability)}</div>
              <div><div className="text-slate-500">Overall</div>{scoreCell(r.scores?.overall)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Translation preview</div>
              <pre className="text-xs whitespace-pre-wrap bg-slate-50 border rounded p-2 max-h-48 overflow-auto">
{r.translatedText || (r.status === 'running' ? '…translating…' : r.error || '')}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
