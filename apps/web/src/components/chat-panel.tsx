'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCallTrace[];
  modelCalls?: number;
  pending?: boolean;
  error?: string;
}

interface ChatApiResponse {
  answer: string;
  toolCalls: ToolCallTrace[];
  modelCalls: number;
  problem?: string;
  code?: string;
}

const SUGGESTIONS = [
  'List the tools you have access to.',
  'Search for "onboarding" and summarize the top results.',
  'List all skills available to me.',
  'What is the most recent Slack message indexed?',
];

export function ChatPanel({ hasAnthropicKey }: { hasAnthropicKey: boolean }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  async function send(question: string) {
    if (!question.trim() || busy) return;
    if (!hasAnthropicKey) {
      toast.error('ANTHROPIC_API_KEY is not configured on the server.');
      return;
    }
    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: 'user',
      text: question.trim(),
    };
    const assistantTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      pending: true,
    };
    const history = [...turns, userTurn];
    setTurns([...history, assistantTurn]);
    setInput('');
    setBusy(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, text: t.text })),
        }),
      });
      const data = (await res.json()) as ChatApiResponse;
      if (!res.ok) {
        const message = data.problem ?? `Request failed (${res.status}).`;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurn.id
              ? { ...t, pending: false, error: message, text: '' }
              : t,
          ),
        );
        return;
      }
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurn.id
            ? {
                ...t,
                pending: false,
                text: data.answer,
                toolCalls: data.toolCalls,
                modelCalls: data.modelCalls,
              }
            : t,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error.';
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurn.id
            ? { ...t, pending: false, error: message, text: '' }
            : t,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(input);
  }

  function clearChat() {
    setTurns([]);
  }

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[480px] flex-col rounded-md border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-[13px] text-text">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              hasAnthropicKey ? 'bg-success' : 'bg-warning'
            }`}
            aria-hidden
          />
          {hasAnthropicKey
            ? 'Agent ready · Anthropic key detected'
            : 'ANTHROPIC_API_KEY missing — set it to enable chat'}
        </div>
        <button
          type="button"
          onClick={clearChat}
          disabled={turns.length === 0 || busy}
          className="text-[12px] text-text-subtle transition-colors duration-micro hover:text-text disabled:opacity-40"
        >
          Clear conversation
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <EmptyState
            hasAnthropicKey={hasAnthropicKey}
            onPick={(q) => {
              setInput(q);
              void send(q);
            }}
          />
        ) : (
          <ul className="space-y-5">
            {turns.map((t) => (
              <li key={t.id}>
                <Turn turn={t} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={onSubmit}
        className="border-t border-border bg-surface px-4 py-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={
              hasAnthropicKey
                ? 'Ask the agent anything about your indexed content…'
                : 'Disabled: server is missing ANTHROPIC_API_KEY'
            }
            disabled={busy || !hasAnthropicKey}
            className="flex-1 resize-none rounded-sm border border-border bg-transparent px-3 py-2 font-sans text-[13px] leading-5 text-text placeholder:text-text-subtle focus:outline focus:outline-2 focus:outline-accent focus:[outline-offset:-1px] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim() || !hasAnthropicKey}
            className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-fg transition-colors duration-micro ease-enter hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-text-subtle">
          Enter to send · Shift+Enter for newline
        </p>
      </form>
    </div>
  );
}

function EmptyState({
  hasAnthropicKey,
  onPick,
}: {
  hasAnthropicKey: boolean;
  onPick: (q: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="space-y-1">
        <p className="font-display text-h3 text-text">Start a conversation</p>
        <p className="max-w-md text-[13px] leading-6 text-text-muted">
          The agent uses the same tools your MCP clients use. Try one of the prompts
          below or ask your own question.
        </p>
      </div>
      <ul className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              disabled={!hasAnthropicKey}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-left text-[13px] leading-5 text-text-muted transition-colors duration-micro hover:border-border-strong hover:text-text disabled:opacity-50"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="caption text-text-subtle">You</span>
        <div className="max-w-[85%] whitespace-pre-wrap rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-6 text-text">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="caption text-text-subtle">Agent</span>
      <div className="w-full max-w-[100%] space-y-2">
        {turn.pending ? (
          <PendingDots />
        ) : turn.error ? (
          <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-[13px] text-text">
            <span className="font-medium text-error">Error: </span>
            {turn.error}
          </div>
        ) : (
          <>
            <div className="whitespace-pre-wrap rounded-md border border-border bg-bg px-3 py-2 text-[13px] leading-6 text-text">
              {turn.text || <em className="text-text-subtle">No response.</em>}
            </div>
            {turn.toolCalls && turn.toolCalls.length > 0 && (
              <ToolTrace calls={turn.toolCalls} modelCalls={turn.modelCalls} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PendingDots() {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text-muted">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      Calling tools…
    </div>
  );
}

function ToolTrace({
  calls,
  modelCalls,
}: {
  calls: ToolCallTrace[];
  modelCalls?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-md border border-border bg-bg"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-1.5 text-[12px] text-text-muted transition-colors hover:text-text">
        <span>
          {calls.length} tool {calls.length === 1 ? 'call' : 'calls'}
          {typeof modelCalls === 'number' ? ` · ${modelCalls} model turn${modelCalls === 1 ? '' : 's'}` : null}
        </span>
        <span aria-hidden className="font-mono text-text-subtle">
          {open ? '−' : '+'}
        </span>
      </summary>
      <ul className="space-y-2 border-t border-border px-3 py-2">
        {calls.map((c) => (
          <li key={c.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <code className="font-mono text-text">
                {c.name}
                {c.isError ? (
                  <span className="ml-1 text-error">[error]</span>
                ) : null}
              </code>
              {typeof c.durationMs === 'number' && (
                <span className="text-text-subtle tabular-nums">{c.durationMs}ms</span>
              )}
            </div>
            <pre className="overflow-x-auto rounded-sm border border-border bg-code-bg p-2 font-mono text-[11px] leading-4 text-text-muted">
{JSON.stringify(c.input, null, 2)}
            </pre>
            {c.output !== undefined && (
              <pre className="overflow-x-auto rounded-sm border border-border bg-code-bg p-2 font-mono text-[11px] leading-4 text-text-muted">
{truncate(JSON.stringify(c.output, null, 2), 4000)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (${s.length - max} more chars truncated)`;
}
