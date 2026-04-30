'use client';

import { useState } from 'react';
import { signIn } from '@holo/auth/client';

export function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleGithub() {
    setBusy(true);
    setError(null);
    try {
      await signIn.social({ provider: 'github', callbackURL: '/dashboard' });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={handleGithub}
        disabled={busy}
        className="w-full rounded-md bg-gray-900 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"
      >
        Continue with GitHub
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <p className="text-xs text-gray-500">
        v0.0 Foundation: GitHub OAuth login only. Email OTP lands later.
      </p>
    </div>
  );
}
