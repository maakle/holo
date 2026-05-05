'use client';

import { useEffect, useSyncExternalStore } from 'react';

const SYNC_TRIGGERED_EVENT = 'holo:sync-triggered';

export type ConnectorSyncStatus = {
  running: boolean;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  embedQueued: number;
  chunksIndexed: number;
};

type Statuses = Record<string, ConnectorSyncStatus>;

const EMPTY: ConnectorSyncStatus = {
  running: false,
  lastSyncedAt: null,
  lastStatus: null,
  embedQueued: 0,
  chunksIndexed: 0,
};

const ACTIVE_INTERVAL_MS = 3000;
const IDLE_INTERVAL_MS = 30_000;

let snapshot: Statuses = {};
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
  let anyRunning = false;
  try {
    const res = await fetch('/api/connectors/status', { cache: 'no-store' });
    if (res.ok) {
      const body = (await res.json()) as { statuses?: Statuses };
      if (body.statuses) {
        snapshot = body.statuses;
        emit();
        anyRunning = Object.values(body.statuses).some((s) => s.running);
      }
    }
  } catch {
    // Swallow — next tick will retry. Backing off on error keeps a flapping
    // server from turning into a request storm.
  } finally {
    inflight = false;
  }
  if (refCount > 0) {
    schedule(anyRunning ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
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
      // A sync was just kicked off somewhere — fast-poll once to pick up the
      // running flag, then the normal cadence resumes.
      syncEventListener = () => schedule(0);
      window.addEventListener(SYNC_TRIGGERED_EVENT, syncEventListener);
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
    }
    syncEventListener = null;
  }
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
  return {};
}

export function useAllConnectorsStatus(): Statuses {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useConnectorStatus(provider: string): ConnectorSyncStatus {
  const all = useAllConnectorsStatus();
  return all[provider] ?? EMPTY;
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

export const __TEST__ = {
  reset: () => {
    snapshot = {};
    listeners.clear();
    refCount = 0;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    inflight = false;
    if (syncEventListener && typeof window !== 'undefined') {
      window.removeEventListener(SYNC_TRIGGERED_EVENT, syncEventListener);
    }
    syncEventListener = null;
  },
};
