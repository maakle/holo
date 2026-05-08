'use client';

// Tiny event bus so the sidebar's "Sample data active" indicator can react
// to install/remove actions on the connections page instantly. Without this
// the indicator only updates on its 30s background poll — long enough that
// users assume removal didn't take effect.
const EVENT_NAME = 'holo:sample-data-changed';

export function notifySampleDataChanged(active: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { active } }));
}

export function onSampleDataChanged(
  handler: (active: boolean) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ active?: boolean }>).detail;
    handler(Boolean(detail?.active));
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
