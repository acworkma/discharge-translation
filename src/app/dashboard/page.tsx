'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Upload { id: string; filename: string; sizeBytes: number; uploadedAt: number; sourceLang: string; targetLang: string; }
interface Run { id: string; uploadId: string; status: string; createdAt: number; }

function statusBadge(s: string) {
  const map: Record<string, string> = {
    queued: 'bg-slate-200 text-slate-700',
    running: 'bg-amber-100 text-amber-800 animate-pulse',
    succeeded: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800'
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[s] || 'bg-slate-100'}`}>{s}</span>;
}

export default function Dashboard() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  async function refresh() {
    const [u, r] = await Promise.all([
      fetch('/api/uploads').then((x) => x.json()),
      fetch('/api/runs').then((x) => x.json())
    ]);
    setUploads(u.uploads || []);
    setRuns(r.runs || []);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  async function deleteUpload(id: string) {
    if (!confirm('Delete this document and all its runs?')) return;
    await fetch(`/api/uploads/${id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link href="/upload" className="bg-brand text-white px-4 py-2 rounded hover:bg-brand-dark">
          New Translation Run
        </Link>
      </div>

      <section className="bg-white rounded shadow">
        <div className="px-4 py-3 border-b font-medium">Documents</div>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">File</th>
              <th className="px-4 py-2">Languages</th>
              <th className="px-4 py-2">Uploaded</th>
              <th className="px-4 py-2">Runs</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {uploads.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No uploads yet</td></tr>
            )}
            {uploads.map((u) => {
              const myRuns = runs.filter((r) => r.uploadId === u.id);
              return (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2 font-mono">{u.filename}</td>
                  <td className="px-4 py-2">{u.sourceLang} → {u.targetLang}</td>
                  <td className="px-4 py-2">{new Date(u.uploadedAt).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2 flex-wrap">
                      {myRuns.map((r) => (
                        <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center gap-2 hover:underline">
                          <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                          {statusBadge(r.status)}
                        </Link>
                      ))}
                      {myRuns.length === 0 && <span className="text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => deleteUpload(u.id)} className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
