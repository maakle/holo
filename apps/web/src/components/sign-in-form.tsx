'use client';

import { useState } from 'react';
import { signIn } from '@holo/auth/client';
import { Button } from '@/components/ui/button';

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
      <Button
        onClick={handleGithub}
        disabled={busy}
        size="lg"
        className="w-full bg-text text-bg hover:bg-text/90 focus-visible:focus-ring"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.58.11.79-.25.79-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.17a10.97 10.97 0 0 1 5.74 0c2.18-1.48 3.14-1.17 3.14-1.17.63 1.59.23 2.76.11 3.05.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
        </svg>
        Continue with GitHub
      </Button>
      {error ? <p className="text-[13px] text-error">{error}</p> : null}
      <p className="caption text-text-subtle">
        v0.0 Foundation · GitHub OAuth only · Email OTP lands later
      </p>
    </div>
  );
}
