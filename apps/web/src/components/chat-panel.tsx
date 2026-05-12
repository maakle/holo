'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

export interface PhaseEntry {
  id: string;
  label: string;
  state: 'active' | 'done' | 'error';
  durationMs?: number;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCallTrace[];
  modelCalls?: number;
  pending?: boolean;
  phases?: PhaseEntry[];
  error?: string;
}

// NDJSON event shapes streamed from /api/chat. Kept in sync with the
// ChatStreamEvent union in the route handler.
type StreamEvent =
  | { type: 'model_start'; modelCall: number }
  | { type: 'model_end'; modelCall: number; stopReason: string }
  | {
      type: 'tool_start';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      output: unknown;
      isError?: boolean;
      durationMs: number;
    }
  | {
      type: 'done';
      answer: string;
      toolCalls: ToolCallTrace[];
      modelCalls: number;
    }
  | { type: 'error'; problem: string; code: string };

function phaseLabelForTool(name: string, input: Record<string, unknown>): string {
  if (name === 'search') {
    const q = typeof input.q === 'string' ? input.q : '';
    return q ? `Searching your sources for "${truncateInline(q, 60)}"` : 'Searching your sources';
  }
  if (name === 'list_skills') return 'Listing skills';
  if (name === 'get_skill') {
    const slug = typeof input.slug === 'string' ? input.slug : null;
    return slug ? `Reading skill "${slug}"` : 'Reading skill details';
  }
  return `Running ${name}`;
}

function truncateInline(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

const SUGGESTIONS = [
  'What sources are connected to my workspace?',
  'List all skills available to me.',
  'Summarize the most recent content I have indexed.',
  'What can you do? Show me your tools.',
];

export function ChatPanel({
  hasAnthropicKey,
  modelId,
  conversationId: initialConversationId = null,
  initialTurns = [],
}: {
  hasAnthropicKey: boolean;
  modelId: string;
  conversationId?: string | null;
  initialTurns?: ChatTurn[];
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
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
      phases: [
        {
          id: 'thinking-initial',
          label: 'Thinking',
          state: 'active',
        },
      ],
    };
    const history = [...turns, userTurn];
    setTurns([...history, assistantTurn]);
    setInput('');
    setBusy(true);

    const failTurn = (message: string) => {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurn.id
            ? { ...t, pending: false, error: message, text: '', phases: undefined }
            : t,
        ),
      );
    };

    let activeConversationId = conversationId;
    let createdNewConversation = false;
    if (!activeConversationId) {
      let createError: string | null = null;
      try {
        const createRes = await fetch('/api/chat/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!createRes.ok) {
          const body = (await createRes.json().catch(() => null)) as
            | { problem?: string }
            | null;
          createError = body?.problem ?? 'Could not create conversation.';
        } else {
          const created = (await createRes.json()) as {
            conversation: { id: string };
          };
          activeConversationId = created.conversation.id;
          setConversationId(activeConversationId);
          // Update the URL bar so the user can refresh into the persisted
          // conversation, but DO NOT call router.refresh() yet — refreshing
          // mid-stream re-runs the parent layout/page and resets ChatPanel
          // local state, dropping the pending assistant turn before the
          // `done` event can populate it. Defer the refresh until after the
          // stream completes (see the finally block below).
          window.history.replaceState(null, '', `/chat/${activeConversationId}`);
          createdNewConversation = true;
        }
      } catch (err) {
        createError = err instanceof Error ? err.message : 'Network error.';
      }
      if (createError !== null) {
        failTurn(createError ?? 'Could not create conversation.');
        setBusy(false);
        return;
      }
    }

    const applyEvent = (event: StreamEvent) => {
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== assistantTurn.id) return t;
          const phases = t.phases ? [...t.phases] : [];

          if (event.type === 'model_start') {
            // Replace any trailing active "thinking" phase rather than stacking
            // duplicates each agent loop iteration.
            const last = phases[phases.length - 1];
            if (last && last.state === 'active' && last.label === 'Thinking') {
              return t;
            }
            phases.push({
              id: `model-${event.modelCall}`,
              label: 'Thinking',
              state: 'active',
            });
            return { ...t, phases };
          }

          if (event.type === 'model_end') {
            const idx = phases.findIndex(
              (p) => p.id === `model-${event.modelCall}` && p.state === 'active',
            );
            if (idx >= 0) {
              phases[idx] = { ...phases[idx]!, state: 'done' };
            }
            return { ...t, phases };
          }

          if (event.type === 'tool_start') {
            // Demote any trailing "Thinking" phase so the new tool phase is
            // visually the active step.
            const last = phases[phases.length - 1];
            if (last && last.state === 'active' && last.label === 'Thinking') {
              phases[phases.length - 1] = { ...last, state: 'done' };
            }
            phases.push({
              id: `tool-${event.id}`,
              label: phaseLabelForTool(event.name, event.input),
              state: 'active',
            });
            return { ...t, phases };
          }

          if (event.type === 'tool_end') {
            const idx = phases.findIndex((p) => p.id === `tool-${event.id}`);
            if (idx >= 0) {
              phases[idx] = {
                ...phases[idx]!,
                state: event.isError ? 'error' : 'done',
                durationMs: event.durationMs,
              };
            }
            return { ...t, phases };
          }

          if (event.type === 'done') {
            return {
              ...t,
              pending: false,
              text: event.answer,
              toolCalls: event.toolCalls,
              modelCalls: event.modelCalls,
              phases: undefined,
            };
          }

          if (event.type === 'error') {
            return {
              ...t,
              pending: false,
              error: event.problem,
              text: '',
              phases: undefined,
            };
          }

          return t;
        }),
      );
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, text: t.text })),
          conversationId: activeConversationId,
        }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as
          | { problem?: string }
          | null;
        failTurn(body?.problem ?? `Request failed (${res.status}).`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let newlineIdx = buffer.indexOf('\n');
          while (newlineIdx !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (line) {
              try {
                applyEvent(JSON.parse(line) as StreamEvent);
              } catch {
                // Drop malformed lines; the stream may include partial
                // frames at the chunk boundary which the next read covers.
              }
            }
            newlineIdx = buffer.indexOf('\n');
          }
        }
        if (done) break;
      }
      if (buffer.trim()) {
        try {
          applyEvent(JSON.parse(buffer.trim()) as StreamEvent);
        } catch {
          // ignore trailing partial line
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error.';
      failTurn(message);
    } finally {
      setBusy(false);
      // Refresh now that the stream is fully drained — this updates the
      // sidebar's conversation list (and any other server-rendered state)
      // without racing against the in-flight stream.
      if (createdNewConversation) router.refresh();
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="flex min-h-[480px] flex-1 flex-col rounded-md border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-[13px] text-text">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              hasAnthropicKey ? 'bg-success' : 'bg-warning'
            }`}
            aria-hidden
          />
          {hasAnthropicKey ? (
            <>
              MCP connected
              <span className="text-text-subtle">·</span>
              <code className="font-mono text-[12px] text-text-muted">{modelId}</code>
            </>
          ) : (
            'ANTHROPIC_API_KEY missing — set it to enable chat'
          )}
        </div>
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
          <PhaseList phases={turn.phases ?? []} />
        ) : turn.error ? (
          <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-[13px] text-text">
            <span className="font-medium text-error">Error: </span>
            {turn.error}
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border bg-bg px-3 py-2 text-[13px] leading-6 text-text">
              {turn.text ? (
                <Markdown text={turn.text} />
              ) : (
                <em className="text-text-subtle">No response.</em>
              )}
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

function PhaseList({ phases }: { phases: PhaseEntry[] }) {
  if (phases.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text-muted">
        <ActiveDot />
        Thinking…
      </div>
    );
  }
  return (
    <ul className="space-y-1 rounded-md border border-border bg-bg px-3 py-2 text-[13px]">
      {phases.map((p) => (
        <li key={p.id} className="flex items-center gap-2 leading-5">
          <span className="flex h-2 w-2 shrink-0 items-center justify-center">
            {p.state === 'active' ? (
              <ActiveDot />
            ) : p.state === 'error' ? (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-error" />
            ) : (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-subtle" />
            )}
          </span>
          <span
            className={
              p.state === 'active'
                ? 'text-text'
                : p.state === 'error'
                  ? 'text-error'
                  : 'text-text-muted'
            }
          >
            {p.label}
            {p.state === 'active' ? '…' : null}
          </span>
          {typeof p.durationMs === 'number' && p.state !== 'active' ? (
            <span className="ml-auto text-[11px] tabular-nums text-text-subtle">
              {p.durationMs}ms
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ActiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/50" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
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

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="my-2 first:mt-0 last:mb-0">{children}</p>
        ),
        h1: ({ children }) => (
          <h1 className="font-display text-[15px] font-semibold tracking-tight my-2 first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="font-display text-[14px] font-semibold tracking-tight my-2 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="font-display text-[13px] font-semibold tracking-tight my-2 first:mt-0">
            {children}
          </h3>
        ),
        ul: ({ children }) => (
          <ul className="my-2 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-6">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-text">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-border pl-3 text-text-muted">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-border" />,
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code
                className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-text"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={`font-mono text-[12px] leading-5 ${className ?? ''}`} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-sm border border-border bg-code-bg p-2 font-mono text-[12px] leading-5 text-text">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border bg-surface-2 px-2 py-1 text-left font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-2 py-1">{children}</td>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
