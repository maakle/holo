'use client';

import { useEffect, useSyncExternalStore } from 'react';

const SYNC_TRIGGERED_EVENT = 'holo:sync-triggered';
const DISCONNECT_TRIGGERED_EVENT = 'holo:disconnect-triggered';

export type ConnectorSyncStatus = {
  running: boolean;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  embedQueued: number;
  chunksIndexed: number;
  /** True while the worker is still cleaning up after a Disconnect. */
  disconnecting: boolean;
};

type Statuses = Record<string, ConnectorSyncStatus>;

const EMPTY: ConnectorSyncStatus = {
  running: false,
  lastSyncedAt: null,
  lastStatus: null,
  embedQueued: 0,
  chunksIndexed: 0,
  disconnecting: false,
};

const ACTIVE_INTERVAL_MS = 3000;
const IDLE_INTERVAL_MS = 30_000;

const EMPTY_STATUSES: Statuses = {};
let snapshot: Statuses = EMPTY_STATUSES;
let hasReceivedSnapshot = false;
const listeners = new Set<() => void>();
let refCount = 0;
let timeout: ReturnType<typeof setTimeout> | null = null;
let inflight = false;
let syncEventListener: ((e: Event) => void) | null = null;

function emit() {
  for (const l of listeners) l();
}

async function tick(): Promise<void> {
  if (inflight) return;
  inflight = true;
  let anyActive = false;
  try {
    const res = await fetch('/api/connectors/status', { cache: 'no-store' });
    if (res.ok) {
      const body = (await res.json()) as { statuses?: Statuses };
      if (body.statuses) {
        snapshot = body.statuses;
        hasReceivedSnapshot = true;
        emit();
        // Treat both running syncs and in-flight disconnects as "active" — we
        // want fast cadence while either is happening so the UI flips back
        // promptly when the worker finishes.
        anyActive = Object.values(body.statuses).some(
          (s) => s.running || s.disconnecting,
        );
      }
    }
  } catch {
    // Swallow — next tick will retry. Backing off on error keeps a flapping
    // server from turning into a request storm.
  } finally {
    inflight = false;
  }
  if (refCount > 0) {
    schedule(anyActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
  }
}

function schedule(delay: number) {
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => {
    void tick();
  }, delay);
}

function start() {
  if (refCount === 0) {
    void tick();
    if (typeof window !== 'undefined') {
      // A sync or disconnect was just kicked off somewhere — fast-poll once
      // to pick up the new running/disconnecting flag, then the normal
      // cadence resumes.
      syncEventListener = () => schedule(0);
      window.addEventListener(SYNC_TRIGGERED_EVENT, syncEventListener);
      window.addEventListener(DISCONNECT_TRIGGERED_EVENT, syncEventListener);
    }
  }
  refCount += 1;
}

function stop() {
  refCount -= 1;
  if (refCount <= 0) {
    refCount = 0;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (syncEventListener && typeof window !== 'undefined') {
      window.removeEventListener(SYNC_TRIGGERED_EVENT, syncEventListener);
      window.removeEventListener(DISCONNECT_TRIGGERED_EVENT, syncEventListener);
    }
    syncEventListener = null;
  }
}

/**
 * Fire from anywhere a Disconnect call returned 202 — the store will
 * fast-poll once to pick up `disconnecting=true` and stay on the active
 * cadence until the worker flips it back.
 */
export function notifyDisconnectTriggered(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DISCONNECT_TRIGGERED_EVENT));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    stop();
  };
}

function getSnapshot(): Statuses {
  return snapshot;
}

function getServerSnapshot(): Statuses {
  return EMPTY_STATUSES;
}

export function useAllConnectorsStatus(): Statuses {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useConnectorStatus(provider: string): ConnectorSyncStatus {
  const all = useAllConnectorsStatus();
  return all[provider] ?? EMPTY;
}

/**
 * `true` once the store has received at least one status snapshot from the
 * server. Components that combine an SSR-injected hint with the live poll
 * use this to know when to stop trusting the hint — before the first poll
 * lands, the live snapshot is the empty default and would override a true
 * SSR hint with a false live value.
 */
function hasLiveStatus(): boolean {
  return hasReceivedSnapshot;
}

export function useHasLiveConnectorStatus(): boolean {
  // Subscribe to the same store so this hook re-renders when a snapshot
  // lands. The boolean is derived from the module-level flag.
  useAllConnectorsStatus();
  return hasLiveStatus();
}

/**
 * Watch a specific connector's `running` flag and fire a callback the moment
 * it transitions from running → idle. Used by the badge to refresh the
 * server-rendered tooltip data when a sync completes.
 */
export function useOnSyncCompleted(provider: string, onCompleted: () => void): void {
  const status = useConnectorStatus(provider);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `__holo_was_running_${provider}`;
    const w = window as unknown as Record<string, boolean | undefined>;
    const wasRunning = Boolean(w[key]);
    if (wasRunning && !status.running) onCompleted();
    w[key] = status.running;
  }, [provider, status.running, onCompleted]);
}

/**
 * Like {@link useOnSyncCompleted}, but fires the moment a connector's
 * `disconnecting` flag transitions from true → false. The row uses this to
 * call `router.refresh()` once the worker has finished cleanup — so the
 * server-rendered "Connect" button replaces the "Disconnecting…" badge
 * without the user having to reload.
 */
export function useOnDisconnectCompleted(
  provider: string,
  onCompleted: () => void,
): void {
  const status = useConnectorStatus(provider);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `__holo_was_disconnecting_${provider}`;
    const w = window as unknown as Record<string, boolean | undefined>;
    const wasDisconnecting = Boolean(w[key]);
    if (wasDisconnecting && !status.disconnecting) onCompleted();
    w[key] = status.disconnecting;
  }, [provider, status.disconnecting, onCompleted]);
}

export const __TEST__ = {
  reset: () => {
    snapshot = {};
    hasReceivedSnapshot = false;
    listeners.clear();
    refCount = 0;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    inflight = false;
    if (syncEventListener && typeof window !== 'undefined') {
      window.removeEventListener(SYNC_TRIGGERED_EVENT, syncEventListener);
      window.removeEventListener(DISCONNECT_TRIGGERED_EVENT, syncEventListener);
    }
    syncEventListener = null;
  },
};
