'use client';
import { useEffect, useState } from 'react';

interface RunnerOpt { id: string; displayName: string; kind: string; }

const TARGET_LANGS = [
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ru', label: 'Russian' },
  { code: 'pt', label: 'Portuguese' }
];

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('es');
  const [runners, setRunners] = useState<RunnerOpt[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/runners').then((r) => r.json()).then((d) => {
      setRunners(d.runners || []);
      // default-select translator + first foundry model
      const def = new Set<string>();
      const t = d.runners.find((x: RunnerOpt) => x.kind === 'translator');
      if (t) def.add(t.id);
      const f = d.runners.find((x: RunnerOpt) => x.kind === 'foundry');
      if (f) def.add(f.id);
      setSelected(def);
    });
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!file) return setErr('Choose a file');
    if (selected.size === 0) return setErr('Select at least one runner');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('sourceLang', 'en');
      fd.append('targetLang', targetLang);
      const up = await fetch('/api/uploads', { method: 'POST', body: fd }).then((r) => r.json());
      if (!up.id) throw new Error('Upload failed');
      const run = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: up.id, runners: Array.from(selected) })
      }).then((r) => r.json());
      if (!run.id) throw new Error('Run start failed');
      window.location.href = `/runs/${run.id}`;
    } catch (e: any) {
      setErr(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto bg-white shadow rounded p-6 space-y-6">
      <h1 className="text-xl font-semibold">New Translation Run</h1>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1">Discharge document</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm"
          />
          <p className="text-xs text-slate-500 mt-1">PDF, DOCX, TXT, or images. PHI-safe: text is not logged.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Target language</label>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="border rounded px-3 py-2 w-full"
          >
            {TARGET_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Runners</label>
          <div className="space-y-2">
            {runners.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <span>{r.displayName}</span>
                <span className="text-xs text-slate-400">{r.id}</span>
              </label>
            ))}
            {runners.length === 0 && <p className="text-sm text-slate-400">Loading...</p>}
          </div>
        </div>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button
          disabled={busy}
          className="bg-brand text-white px-4 py-2 rounded hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? 'Starting...' : 'Upload & Run'}
        </button>
      </form>
    </div>
  );
}
