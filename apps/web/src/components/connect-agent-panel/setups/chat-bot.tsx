'use client';
import { SlackSetup } from './slack';

export function ChatBotSetup() {
  return (
    <div className="space-y-6">
      <SlackSetup />
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <div className="caption mb-2">Coming soon</div>
        <div className="flex flex-wrap gap-2">
          <ComingSoonChip label="Google Chat" />
          <ComingSoonChip label="Microsoft Teams" />
        </div>
      </div>
    </div>
  );
}

function ComingSoonChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[12px] text-text-muted">
      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-text-subtle" />
      {label}
    </span>
  );
}
