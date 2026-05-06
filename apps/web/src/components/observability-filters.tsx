'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

interface Props {
  kind: string | undefined;
  status: string | undefined;
  availableKinds: readonly string[];
}

const KIND_LABELS: Record<string, string> = {
  mcp_call: 'MCP tool',
  mcp_list: 'tools/list',
  llm_call: 'LLM',
  slack_message: 'Slack',
  agent_step: 'Agent step',
  tool_call: 'Tool call',
  connector_sync: 'Sync',
  rest_call: 'REST',
};

export function ObservabilityFilters({ kind, status, availableKinds }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(sp.toString());
    next.delete('cursor');
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      style={{ opacity: isPending ? 0.6 : 1 }}
    >
      <span
        className="text-xs font-medium uppercase tracking-widest"
        style={{ color: 'var(--text-subtle)' }}
      >
        Kind
      </span>
      <Chip active={!kind} onClick={() => setParam('kind', undefined)}>
        All
      </Chip>
      {availableKinds.map((k) => (
        <Chip key={k} active={kind === k} onClick={() => setParam('kind', k)}>
          {KIND_LABELS[k] ?? k}
        </Chip>
      ))}
      <span
        className="ml-3 text-xs font-medium uppercase tracking-widest"
        style={{ color: 'var(--text-subtle)' }}
      >
        Status
      </span>
      <Chip active={!status} onClick={() => setParam('status', undefined)}>
        All
      </Chip>
      <Chip active={status === 'error'} onClick={() => setParam('status', 'error')}>
        Errors only
      </Chip>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded px-2 py-1 text-[12px] font-medium transition-colors"
      style={{
        background: active ? '#3F47FF' : 'var(--surface-2)',
        color: active ? 'white' : 'var(--text-muted)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </button>
  );
}
