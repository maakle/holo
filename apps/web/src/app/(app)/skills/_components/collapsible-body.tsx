'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function CollapsibleBody({ body }: { body: string }) {
  // Per RFC-0005 the body is "rendered as collapsed markdown by default" —
  // the detail page is for orientation, not editing. Long bodies get clipped
  // to the first ~12 lines until expanded.
  const [open, setOpen] = useState(false);
  const lines = body.split('\n');
  const truncated = lines.length > 12;
  const displayBody = open || !truncated ? body : lines.slice(0, 12).join('\n');

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="prose-skill text-[14px] leading-6 text-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayBody}</ReactMarkdown>
      </div>
      {truncated ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 text-[12px] font-medium text-text-muted hover:text-accent"
        >
          {open ? 'Collapse' : `Show ${lines.length - 12} more lines`}
        </button>
      ) : null}
    </div>
  );
}
