'use client';

import { useState } from 'react';

interface PublishButtonProps {
  skillId: string;
}

type PublishState = 'idle' | 'loading' | 'published' | 'already_published' | 'error';

export function PublishButton({ skillId }: PublishButtonProps) {
  const [state, setState] = useState<PublishState>('idle');

  async function handlePublish() {
    setState('loading');
    try {
      const res = await fetch(`/api/skills/${skillId}/publish`, { method: 'POST' });
      const data = (await res.json()) as { publishedId?: string; error?: string };
      if (res.status === 409 || data.error === 'already_published') {
        setState('already_published');
      } else if (res.ok) {
        setState('published');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }

  if (state === 'published') {
    return (
      <span
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: 'var(--success)' }}
      >
        Published
      </span>
    );
  }

  if (state === 'already_published') {
    return (
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        Already published
      </span>
    );
  }

  if (state === 'error') {
    return (
      <button
        onClick={handlePublish}
        className="text-xs hover:underline"
        style={{ color: 'var(--error)' }}
      >
        Failed — retry
      </button>
    );
  }

  return (
    <button
      onClick={handlePublish}
      disabled={state === 'loading'}
      className={
        state === 'loading'
          ? 'text-xs text-gray-400 dark:text-gray-500 cursor-not-allowed'
          : 'text-xs hover:underline cursor-pointer'
      }
      style={state !== 'loading' ? { color: 'var(--accent)' } : undefined}
    >
      {state === 'loading' ? 'Publishing…' : 'Publish'}
    </button>
  );
}
