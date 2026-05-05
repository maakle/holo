'use client';

import { useState } from 'react';
import { toast } from 'sonner';

interface ReplayPanelsProps {
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  errorCode: string | null;
}

export function ReplayPanels({ inputJson, outputJson, errorCode }: ReplayPanelsProps) {
  const inputStr = JSON.stringify(inputJson, null, 2);
  const outputStr = outputJson
    ? JSON.stringify(outputJson, null, 2)
    : errorCode
      ? `Error: ${errorCode}`
      : 'null';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Input" body={inputStr} />
      <Panel title="Output" body={outputStr} tone={errorCode ? 'error' : undefined} />
    </div>
  );
}

function Panel({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: 'error';
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      toast.success(`${title} copied`);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked in some sandboxes; ignore
    }
  }

  return (
    <div className="overflow-hidden rounded border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="caption text-text-subtle">{title}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[12px] text-text-muted transition-colors hover:text-text"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="overflow-auto p-4 font-mono text-[12px] leading-5"
        style={{
          background: 'var(--code-bg)',
          color: tone === 'error' ? 'var(--error)' : 'var(--text)',
          maxHeight: '480px',
        }}
      >
        {body}
      </pre>
    </div>
  );
}
