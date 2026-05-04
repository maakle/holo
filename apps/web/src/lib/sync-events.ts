'use client';

const EVENT_NAME = 'holo:sync-triggered';

export function notifySyncTriggered(provider: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { provider } }));
}

export function onSyncTriggered(
  provider: string,
  handler: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ provider?: string }>).detail;
    if (!detail?.provider || detail.provider === provider) handler();
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
