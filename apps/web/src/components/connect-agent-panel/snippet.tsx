import { type ReactNode } from 'react';
import { type CopyHandler } from './lib';

export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[13px] leading-6 text-text">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-text-muted">
        {n}
      </span>
      <div className="flex-1 space-y-2">{children}</div>
    </li>
  );
}

export function Snippet({
  text,
  copyKey,
  copied,
  onCopy,
  language,
}: {
  text: string;
  copyKey: string;
  copied: string | null;
  onCopy: CopyHandler;
  language?: string;
}) {
  return (
    <div className="relative rounded-sm border border-border bg-code-bg">
      {language && (
        <div className="absolute left-3 top-2 font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
          {language}
        </div>
      )}
      <pre
        className={`overflow-x-auto whitespace-pre-wrap p-4 ${language ? 'pt-7' : ''} font-mono text-xs text-text`}
      >
        {text}
      </pre>
      <button
        onClick={() => onCopy(text, copyKey)}
        className="absolute right-2 top-2 rounded bg-surface-2 px-2 py-1 text-xs text-text-muted transition-colors hover:text-text"
      >
        {copied === copyKey ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-text">
      {children}
    </code>
  );
}
