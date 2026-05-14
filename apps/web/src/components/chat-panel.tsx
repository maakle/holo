'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Markdown } from '@/components/ui/markdown';

interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

// Wire-format claim from the server (RFC-0007). Matches WireAnswerClaim in
// @holo/agent-tools/claims. Snake_case at the boundary.
export interface ChatClaim {
  text: string;
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  citation_indices: number[];
  reason?: string;
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
  /** RFC-0007 structured claims envelope. Optional — older turns and
   * surfaces that don't opt-in will leave this undefined. */
  claims?: ChatClaim[];
  /** Stable orchestrator-minted id for this assistant turn — used by the
   * inline 👍 / 👎 / correct bar to attach feedback. Absent on user turns
   * and on assistant turns from before RFC-0008. */
  answerId?: string;
  /** Mirrors the user's question for this assistant turn, denormalized so
   * the feedback POST carries the (question, answer) pair without us
   * having to walk back through history. */
  question?: string;
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
      answer_id: string;
      answer: string;
      toolCalls: ToolCallTrace[];
      modelCalls: number;
      claims?: ChatClaim[];
    }
  | { type: 'error'; problem: string; code: string };

function phaseLabelForTool(name: string, input: Record<string, unknown>): string {
  if (name === 'search') {
    const q = typeof input.q === 'string' ? input.q : '';
    return q ? `Searching your sources for "${truncateInline(q, 60)}"` : 'Searching your sources';
  }
  if (name === 'list_connections') return 'Checking connected sources';
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
  'Which connectors are set up and when did they last sync?',
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
              claims: event.claims,
              phases: undefined,
              answerId: event.answer_id,
              question: userTurn.text,
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
    <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
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
            {turn.claims && turn.claims.length > 0 && (
              <UnverifiedBanner claims={turn.claims} />
            )}
            <div className="rounded-md border border-border bg-bg px-3 py-2 text-[13px] leading-6 text-text">
              {turn.text ? (
                <Markdown text={turn.text} />
              ) : (
                <em className="text-text-subtle">No response.</em>
              )}
              {turn.claims && turn.claims.length > 0 && (
                <ClaimChips claims={turn.claims} />
              )}
            </div>
            {turn.toolCalls && turn.toolCalls.length > 0 && (
              <ToolTrace calls={turn.toolCalls} modelCalls={turn.modelCalls} />
            )}
            {turn.answerId && turn.text && turn.question ? (
              <FeedbackBar
                answerId={turn.answerId}
                question={turn.question}
                answer={turn.text}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Banner rendered above the answer when at least one claim is `unverified`
 * (the hard-gate fired). Uses --error per DESIGN.md "Badges" pattern:
 * 12%-transparent filled background + colored text. No new tokens introduced.
 */
function UnverifiedBanner({ claims }: { claims: ChatClaim[] }) {
  const unverified = claims.filter((c) => c.confidence === 'unverified');
  if (unverified.length === 0) return null;
  const noun = unverified.length === 1 ? 'claim' : 'claims';
  return (
    <div
      role="status"
      className="rounded-sm border border-error/40 bg-error/[0.12] px-3 py-2 text-[12px] leading-5 text-error"
    >
      <span className="font-medium">
        {unverified.length} {noun} couldn&apos;t be verified from your data.
      </span>{' '}
      <span className="text-error/80">
        Look for the red &ldquo;unverified&rdquo; chips below.
      </span>
    </div>
  );
}

/**
 * Inline rating bar under each assistant turn (RFC-0008).
 *
 * Design (per DESIGN.md):
 * - Three ghost icon-buttons, 12px caption-style labels, neutral text.
 * - 👎 or "✏ Correct this" expands a textarea *inline* — no modal.
 * - Submit POSTs /v1/feedback through the same-origin gateway proxy.
 * - Accent color is reserved for active state (selected vote / focus ring);
 *   we use at most one accent dot per bar so the per-screen budget is
 *   respected even when many turns are visible.
 */
function FeedbackBar({
  answerId,
  question,
  answer,
}: {
  answerId: string;
  question: string;
  answer: string;
}) {
  const [vote, setVote] = useState<-1 | 0 | 1 | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const post = async (rating: -1 | 0 | 1, text?: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answer_id: answerId,
          rating,
          correction_text: text?.trim() ? text.trim() : undefined,
          denorm: {
            question,
            answer,
            citations: [],
            coverage: [],
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { problem?: string } | null;
        toast.error(body?.problem ?? `Could not save feedback (${res.status}).`);
        return;
      }
      setVote(rating);
      setSubmitted(true);
      if (text?.trim()) setShowCorrection(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-[12px] text-text-subtle">
        <button
          type="button"
          aria-label="Helpful"
          disabled={submitting}
          onClick={() => void post(1)}
          className={`rounded-sm border px-2 py-1 transition-colors duration-micro disabled:opacity-50 ${
            vote === 1
              ? 'border-accent text-accent'
              : 'border-border hover:border-border-strong hover:text-text'
          }`}
        >
          {'\u{1F44D}'}
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          disabled={submitting}
          onClick={() => {
            setShowCorrection(true);
            void post(-1);
          }}
          className={`rounded-sm border px-2 py-1 transition-colors duration-micro disabled:opacity-50 ${
            vote === -1
              ? 'border-accent text-accent'
              : 'border-border hover:border-border-strong hover:text-text'
          }`}
        >
          {'\u{1F44E}'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setShowCorrection((v) => !v)}
          className="rounded-sm border border-border px-2 py-1 text-text-muted transition-colors duration-micro hover:border-border-strong hover:text-text disabled:opacity-50"
        >
          {'✏️'} Correct this
        </button>
        {submitted ? (
          <span className="ml-2 caption text-text-subtle">Thanks</span>
        ) : null}
      </div>
      {showCorrection ? (
        <div className="space-y-1.5">
          <textarea
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            rows={3}
            placeholder="What should the answer have said? Keep it specific."
            className="w-full resize-none rounded-sm border border-border bg-transparent px-3 py-2 font-sans text-[13px] leading-5 text-text placeholder:text-text-subtle focus:outline focus:outline-2 focus:outline-accent focus:[outline-offset:-1px]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting || !correction.trim()}
              onClick={() => void post(vote ?? 0, correction)}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text transition-colors duration-micro hover:border-border-strong disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Send correction'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCorrection(false);
                setCorrection('');
              }}
              className="text-[12px] text-text-subtle hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Footer chip list of every non-high claim. `high` is the default
 * confidence and renders no chip (DESIGN.md restraint: don't draw the
 * user's eye to the good case). `medium` is muted and only revealed on
 * hover. `low` and `unverified` are always visible.
 */
function ClaimChips({ claims }: { claims: ChatClaim[] }) {
  const visible = claims.filter((c) => c.confidence !== 'high');
  if (visible.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
      {visible.map((c, i) => (
        <li key={`${i}-${c.text.slice(0, 24)}`}>
          <ClaimChip claim={c} />
        </li>
      ))}
    </ul>
  );
}

function ClaimChip({ claim }: { claim: ChatClaim }) {
  // Color mapping per DESIGN.md Badges pattern: filled-color (12%
  // transparent background + colored text). No ad-hoc hex.
  //   - medium: neutral metadata badge (surface-2 + muted text). Only
  //     readable on hover so it doesn't shout.
  //   - low: warning (amber)
  //   - unverified: error (red)
  let className: string;
  let label: string;
  if (claim.confidence === 'medium') {
    className =
      'border border-border bg-surface-2 text-text-subtle hover:text-text-muted';
    label = 'uncertain';
  } else if (claim.confidence === 'low') {
    className = 'border border-warning/40 bg-warning/[0.12] text-warning';
    label = 'low confidence';
  } else {
    // 'unverified' — high is filtered out by ClaimChips
    className = 'border border-error/40 bg-error/[0.12] text-error';
    label = 'unverified';
  }
  const tooltipParts = [claim.text];
  if (claim.reason) tooltipParts.push(`— ${claim.reason}`);
  return (
    <span
      title={tooltipParts.join(' ')}
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] leading-4 ${className}`}
    >
      {label}
    </span>
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

