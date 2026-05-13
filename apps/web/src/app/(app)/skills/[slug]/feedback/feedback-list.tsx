'use client';

/**
 * Feedback inbox client component.
 *
 * Each row is collapsible. "Promote to eval" expands a structured editor
 * for the `expected` payload — substrings the answer must include, chunk
 * ids it must cite, and strings it must NOT say. We pre-fill substrings
 * from the correction text (best-effort: trim, split on sentence-ish
 * boundaries) so the common case is one click.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface Row {
  id: string;
  answerId: string;
  rating: number;
  correctionText: string | null;
  question: string;
  answer: string;
  createdAt: string;
}

export function FeedbackList({ slug, rows }: { slug: string; rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-6 text-[13px] text-text-muted">
        No feedback yet for <code className="font-mono">{slug}</code>.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <FeedbackRow slug={slug} row={r} />
        </li>
      ))}
    </ul>
  );
}

function FeedbackRow({ slug, row }: { slug: string; row: Row }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="rounded-md border border-border bg-surface">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="space-y-1">
          <span className="caption text-text-subtle">
            <RatingBadge rating={row.rating} />
            <span className="ml-2 tabular-nums">
              {new Date(row.createdAt).toLocaleString()}
            </span>
          </span>
          <p className="text-[14px] leading-5 text-text">{row.question}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-text transition-colors duration-micro hover:border-border-strong"
        >
          {open ? 'Close' : 'Promote to eval'}
        </button>
      </header>
      <div className="space-y-2 border-t border-border px-4 py-3">
        <div>
          <span className="caption text-text-subtle">Answer</span>
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-6 text-text-muted">
            {row.answer}
          </pre>
        </div>
        {row.correctionText ? (
          <div>
            <span className="caption text-text-subtle">Correction</span>
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-6 text-text">
              {row.correctionText}
            </pre>
          </div>
        ) : null}
      </div>
      {open ? <PromoteEditor slug={slug} row={row} /> : null}
    </article>
  );
}

function RatingBadge({ rating }: { rating: number }) {
  if (rating > 0) {
    return <span className="text-success">{'\u{1F44D}'}</span>;
  }
  if (rating < 0) {
    return <span className="text-error">{'\u{1F44E}'}</span>;
  }
  return <span className="text-text-subtle">·</span>;
}

function PromoteEditor({ slug, row }: { slug: string; row: Row }) {
  const router = useRouter();
  const seed = row.correctionText?.trim() ?? '';
  const [substrings, setSubstrings] = useState<string>(seedSubstrings(seed));
  const [mustCite, setMustCite] = useState('');
  const [mustNotSay, setMustNotSay] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const promote = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const expected = {
        answer_substrings: splitLines(substrings),
        must_cite: splitLines(mustCite),
        must_not_say: splitLines(mustNotSay),
      };
      const res = await fetch(
        `/api/skills/${encodeURIComponent(slug)}/feedback/${row.id}/promote`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expected }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { problem?: string } | null;
        toast.error(body?.problem ?? `Promote failed (${res.status}).`);
        return;
      }
      toast.success('Promoted to active eval.');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-border bg-surface-2 px-4 py-3">
      <p className="caption text-text-subtle">Expected payload</p>
      <FieldArea
        label="answer_substrings"
        hint="One per line. Every line must appear in the answer (case-insensitive)."
        value={substrings}
        onChange={setSubstrings}
      />
      <FieldArea
        label="must_cite (chunk_ids)"
        hint="One chunk_id per line. Each must appear in citations[].chunk_id."
        value={mustCite}
        onChange={setMustCite}
      />
      <FieldArea
        label="must_not_say"
        hint="One per line. None may appear in the answer (case-insensitive)."
        value={mustNotSay}
        onChange={setMustNotSay}
      />
      <div>
        <button
          type="button"
          onClick={() => void promote()}
          disabled={submitting}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors duration-micro ease-enter hover:bg-accent/90 disabled:opacity-50"
        >
          {submitting ? 'Promoting…' : 'Promote to active eval'}
        </button>
      </div>
    </div>
  );
}

function FieldArea({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block font-mono text-[12px] text-text">{label}</label>
      <p className="text-[12px] text-text-subtle">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-sm border border-border bg-bg px-3 py-2 font-mono text-[12px] leading-5 text-text placeholder:text-text-subtle focus:outline focus:outline-2 focus:outline-accent focus:[outline-offset:-1px]"
      />
    </div>
  );
}

function seedSubstrings(correction: string): string {
  // Best-effort: take the first 1-2 short clauses from the correction as
  // suggested substrings. The user adjusts before promoting.
  if (!correction) return '';
  return correction
    .split(/[.!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 80)
    .slice(0, 2)
    .join('\n');
}

function splitLines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
