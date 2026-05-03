'use client';

import { useState } from 'react';

export function SkillLabelPanel() {
  const [artifactId, setArtifactId] = useState('');
  const [skillSlug, setSkillSlug] = useState('');
  const [labelStatus, setLabelStatus] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);

  const [synthSlug, setSynthSlug] = useState('');
  const [synthStatus, setSynthStatus] = useState<string | null>(null);
  const [synthError, setSynthError] = useState<string | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);

  async function addLabel() {
    if (!artifactId.trim() || !skillSlug.trim()) return;
    setLabelLoading(true);
    setLabelStatus(null);
    setLabelError(null);
    try {
      const res = await fetch('/api/skills/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceArtifactId: artifactId.trim(), skillSlug: skillSlug.trim() }),
      });
      const data = await res.json() as { ok?: boolean; problem?: string };
      if (res.ok) {
        setLabelStatus('Label added.');
        setArtifactId('');
      } else {
        setLabelError(data.problem ?? 'Failed to add label.');
      }
    } catch {
      setLabelError('Network error. Try again.');
    } finally {
      setLabelLoading(false);
    }
  }

  async function synthesize() {
    if (!synthSlug.trim()) return;
    setSynthLoading(true);
    setSynthStatus(null);
    setSynthError(null);
    try {
      const res = await fetch('/api/skills/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillSlug: synthSlug.trim() }),
      });
      const data = await res.json() as { ok?: boolean; skillId?: string; problem?: string; fix?: string };
      if (res.ok) {
        setSynthStatus(`Skill synthesized (id: ${data.skillId ?? '?'}). Reload to see it in the table.`);
      } else {
        setSynthError(`${data.problem ?? 'Synthesis failed.'}${data.fix ? ` ${data.fix}` : ''}`);
      }
    } catch {
      setSynthError('Network error. Try again.');
    } finally {
      setSynthLoading(false);
    }
  }

  const inputCls =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 focus:outline-hidden focus:ring-1 focus:ring-[#3F47FF]';
  const btnCls =
    'rounded-md bg-[#3F47FF] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3038e0] disabled:opacity-50 transition-colors whitespace-nowrap';

  return (
    <div className="space-y-4">
      {/* Label an artifact */}
      <div className="rounded-md border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Label an artifact</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Paste a source artifact UUID and the procedure name it exemplifies.
          Label 2+ artifacts with the same name to enable synthesis.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            placeholder="Artifact UUID"
            value={artifactId}
            onChange={(e) => setArtifactId(e.target.value)}
            className={inputCls}
          />
          <input
            type="text"
            placeholder="Procedure name (e.g. handle-refund-request)"
            value={skillSlug}
            onChange={(e) => setSkillSlug(e.target.value)}
            className={inputCls}
          />
          <button onClick={addLabel} disabled={labelLoading || !artifactId || !skillSlug} className={btnCls}>
            {labelLoading ? 'Saving…' : 'Add label'}
          </button>
        </div>
        {labelStatus && <p className="text-xs text-green-600 dark:text-green-400">{labelStatus}</p>}
        {labelError && <p className="text-xs text-red-600 dark:text-red-400">{labelError}</p>}
      </div>

      {/* Synthesize a skill */}
      <div className="rounded-md border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Synthesize a skill</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Enter a procedure slug you&apos;ve already labeled 2+ artifacts for.
          Claude will extract a reusable template and store it in your skill library.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Procedure slug (e.g. handle-refund-request)"
            value={synthSlug}
            onChange={(e) => setSynthSlug(e.target.value)}
            className={inputCls}
          />
          <button onClick={synthesize} disabled={synthLoading || !synthSlug} className={btnCls}>
            {synthLoading ? 'Synthesizing…' : 'Synthesize'}
          </button>
        </div>
        {synthStatus && <p className="text-xs text-green-600 dark:text-green-400">{synthStatus}</p>}
        {synthError && <p className="text-xs text-red-600 dark:text-red-400">{synthError}</p>}
      </div>
    </div>
  );
}
