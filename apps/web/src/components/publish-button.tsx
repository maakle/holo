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
      <span className="text-xs font-medium uppercase tracking-wide text-green-500 dark:text-green-400">
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
        className="text-xs text-red-500 dark:text-red-400 hover:underline"
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
          : 'text-xs text-indigo-500 dark:text-indigo-400 hover:underline cursor-pointer'
      }
    >
      {state === 'loading' ? 'Publishing…' : 'Publish'}
    </button>
  );
}
