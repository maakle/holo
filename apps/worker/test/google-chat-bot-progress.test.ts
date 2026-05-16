import { describe, it, expect, vi } from 'vitest';
import type { GoogleChatAppApiClient } from '@holo/connectors';
import { makeChatPlaceholderProgress } from '../src/google-chat-bot/progress';

/**
 * The throttle had a real bug: a pending setTimeout could fire AFTER the
 * caller issued the final answer patch, overwriting the answer with a
 * stale progress phrase. These tests pin the contract — `cancel()` must
 * disarm the timer, drop pending text, and refuse subsequent updates.
 */

function makeClient(): {
  client: GoogleChatAppApiClient;
  patch: ReturnType<typeof vi.fn>;
} {
  const patch = vi.fn(async () => ({ ok: true as const, message: undefined }));
  const client = {
    createMessage: vi.fn(),
    patchMessage: patch,
  } as unknown as GoogleChatAppApiClient;
  return { client, patch };
}

describe('makeChatPlaceholderProgress.cancel', () => {
  it('prevents a pending throttled patch from landing after cancel', async () => {
    vi.useFakeTimers();
    try {
      const { client, patch } = makeClient();
      const p = makeChatPlaceholderProgress({ client, messageName: 'spaces/X/messages/Y' });
      // First update sends immediately (lastSentAt = 0).
      p.update('_first_');
      // Allow the immediate send's microtask + the patch promise to settle.
      await vi.advanceTimersByTimeAsync(0);
      expect(patch).toHaveBeenCalledTimes(1);
      // Second update within the 750ms window schedules a setTimeout.
      p.update('_second_');
      // Cancel before the timer fires.
      await p.cancel();
      // Advance past the throttle window — the scheduled timer should
      // have been cleared and the second patch must NEVER land.
      await vi.advanceTimersByTimeAsync(1000);
      expect(patch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops subsequent updates after cancel', async () => {
    vi.useFakeTimers();
    try {
      const { client, patch } = makeClient();
      const p = makeChatPlaceholderProgress({ client, messageName: 'spaces/X/messages/Y' });
      await p.cancel();
      p.update('_late_');
      await vi.advanceTimersByTimeAsync(1000);
      expect(patch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for an in-flight patch to settle before resolving', async () => {
    const { client, patch } = makeClient();
    let resolveInflight: ((v: { ok: true }) => void) | null = null;
    patch.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveInflight = resolve;
        }),
    );
    const p = makeChatPlaceholderProgress({ client, messageName: 'spaces/X/messages/Y' });
    p.update('_first_');
    // patchMessage is now pending. cancel() must await it instead of
    // returning early — otherwise finalize might issue its patch while
    // ours is mid-flight and the two could be processed out of order.
    let canceled = false;
    const canceling = p.cancel().then(() => {
      canceled = true;
    });
    // Yield several microtasks to be sure cancel hasn't resolved yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(canceled).toBe(false);
    resolveInflight!({ ok: true });
    await canceling;
    expect(canceled).toBe(true);
  });
});
