'use client';
import { useEffect, useState } from 'react';

interface RunnerOpt {
  id: string;
  displayName: string;
  kind: string;
  provider: string;
  tier: string;
  modelId?: string;
}

// Day-1 demo language presets (ask2 §10, top 5 by patient volume).
const TARGET_LANGS: Array<{ code: string; label: string }> = [
  { code: 'es', label: 'Spanish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'zh-Hans', label: 'Mandarin (Simplified)' },
  { code: 'ar', label: 'Arabic' },
  { code: 'tl', label: 'Tagalog' }
];

const TIER_STYLES: Record<string, string> = {
  flagship: 'bg-violet-100 text-violet-800',
  balanced: 'bg-sky-100 text-sky-800',
  budget: 'bg-emerald-100 text-emerald-800',
  baseline: 'bg-slate-200 text-slate-700'
};

const PROVIDER_ORDER = ['azure', 'openai', 'mistral', 'meta', 'deepseek', 'other'];
const PROVIDER_LABEL: Record<string, string> = {
  azure: 'Azure (NMT baseline)',
  openai: 'OpenAI',
  mistral: 'Mistral',
  meta: 'Meta (Llama)',
  deepseek: 'DeepSeek',
  other: 'Other'
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('es');
  const [runners, setRunners] = useState<RunnerOpt[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch('/api/runners')
      .then((r) => r.json())
      .then((d) => {
        const list: RunnerOpt[] = d.runners || [];
        setRunners(list);
        // No models pre-selected — user explicitly chooses which engines to compare.
      });
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!file) return setErr('Choose a file');
    if (selected.size === 0) return setErr('Select at least one model');
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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const grouped = PROVIDER_ORDER
    .map((p) => ({ provider: p, items: runners.filter((r) => r.provider === p) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="max-w-3xl mx-auto bg-white shadow rounded p-6 space-y-6">
      <h1 className="text-xl font-semibold">New Translation Run</h1>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1">Discharge document</label>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded px-4 py-6 cursor-pointer text-sm transition-colors ${
              dragOver
                ? 'border-sky-400 bg-sky-50'
                : file
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
              accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            />
            {file ? (
              <>
                <span className="font-medium text-emerald-800">{file.name}</span>
                <span className="text-xs text-slate-500 mt-1">
                  {(file.size / 1024).toFixed(1)} KB · click or drop to replace
                </span>
              </>
            ) : (
              <>
                <span className="font-medium text-slate-700">
                  Drop a file here or click to browse
                </span>
                <span className="text-xs text-slate-500 mt-1">
                  TXT, MD, PDF (text-extractable), or DOCX
                </span>
              </>
            )}
          </label>
          <p className="text-xs text-slate-500 mt-1">
            PHI-safe: text is not logged.
          </p>
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
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">Engines to compare</label>
            <span className="text-xs text-slate-500">{selected.size} selected</span>
          </div>
          <div className="space-y-4">
            {grouped.map((g) => (
              <div key={g.provider}>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                  {PROVIDER_LABEL[g.provider] || g.provider}
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {g.items.map((r) => {
                    const checked = selected.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center gap-2 border rounded px-3 py-2 cursor-pointer text-sm ${
                          checked ? 'bg-sky-50 border-sky-300' : 'bg-white border-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(r.id)}
                          className="shrink-0"
                        />
                        <span className="flex-1 truncate">
                          {r.displayName.replace(/^Foundry · /, '')}
                        </span>
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${
                            TIER_STYLES[r.tier] || 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {r.tier}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            {runners.length === 0 && <p className="text-sm text-slate-400">Loading engines…</p>}
          </div>
        </div>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button
          disabled={busy}
          className="bg-brand text-white px-4 py-2 rounded hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? 'Starting…' : `Upload & Run (${selected.size} engines)`}
        </button>
      </form>
    </div>
  );
}
