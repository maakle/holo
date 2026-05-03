'use client';

import { useState, type FormEvent } from 'react';
import { signIn, signUp } from '@holo/auth/client';

type Mode = 'sign-in' | 'sign-up';

export function SignInForm() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
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

  async function handleEmail(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === 'sign-in'
          ? await signIn.email({ email, password, callbackURL: '/dashboard' })
          : await signUp.email({
              email,
              password,
              name: name || email.split('@')[0] || email,
              callbackURL: '/dashboard',
            });
      if ('error' in result && result.error) {
        setError(result.error.message ?? 'Authentication failed.');
        setBusy(false);
        return;
      }
      window.location.href = '/dashboard';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={handleGithub}
        disabled={busy}
        className="flex h-10 w-full items-center justify-center rounded-md border border-border bg-surface text-body-sm font-medium text-text transition-colors hover:border-border-strong disabled:opacity-50"
      >
        Continue with GitHub
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-caption uppercase text-text-subtle">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleEmail} className="space-y-3">
        {mode === 'sign-up' && (
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className="h-10 w-full rounded-md border border-border bg-transparent px-3 text-body-sm text-text outline-none placeholder:text-text-subtle focus:border-transparent focus:outline focus:outline-2 focus:outline-accent"
          />
        )}
        <input
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          autoComplete="email"
          className="h-10 w-full rounded-md border border-border bg-transparent px-3 text-body-sm text-text outline-none placeholder:text-text-subtle focus:border-transparent focus:outline focus:outline-2 focus:outline-accent"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          className="h-10 w-full rounded-md border border-border bg-transparent px-3 text-body-sm text-text outline-none placeholder:text-text-subtle focus:border-transparent focus:outline focus:outline-2 focus:outline-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex h-10 w-full items-center justify-center rounded-md bg-accent text-body-sm font-medium text-accent-fg transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-body-sm text-text-muted">
        {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
            setError(null);
          }}
          className="font-medium text-text hover:text-accent"
        >
          {mode === 'sign-in' ? 'Create one' : 'Sign in'}
        </button>
      </p>

      {error ? <p className="text-center text-body-sm text-error">{error}</p> : null}
    </div>
  );
}
