'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authClient, signIn } from '@holo/auth/client';
import { Button } from '@/components/ui/button';

type Step = 'email' | 'otp';

const inputClass =
  'h-10 w-full rounded-md border border-border bg-transparent px-3 text-[13px] text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent disabled:opacity-50';

export function SignInForm() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Sync `hasEmail` from the actual DOM value on focus/input/blur. This lets
  // password-manager autofill (which sometimes assigns the value without
  // dispatching a React-observable change event) still enable the button.
  function syncHasEmail() {
    setHasEmail(!!emailRef.current?.value.trim());
  }

  // After mount, double-check the field — autofill can land before our
  // listeners attach.
  useEffect(() => {
    if (step !== 'email') return;
    const id = window.setTimeout(syncHasEmail, 200);
    return () => window.clearTimeout(id);
  }, [step]);

  async function handleGithub() {
    setBusy(true);
    setError(null);
    try {
      const res = await signIn.social({ provider: 'github', callbackURL: '/dashboard' });
      if (res && 'error' in res && res.error) {
        setError(res.error.message ?? 'Sign-in failed.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendOtp(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    // Read from FormData so we still get the value when a password manager
    // autofills the input without firing React's onChange (1Password etc.).
    const formData = new FormData(ev.currentTarget);
    const submittedEmail = String(formData.get('email') ?? '').trim();
    if (!submittedEmail) {
      setError('Please enter an email.');
      return;
    }
    if (submittedEmail !== email) setEmail(submittedEmail);
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email: submittedEmail,
        type: 'sign-in',
      });
      if ('error' in res && res.error) {
        setError(res.error.message ?? 'Could not send code.');
        return;
      }
      setStep('otp');
      setInfo(`We sent a 6-digit code to ${submittedEmail}. It expires in 5 minutes.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signIn.emailOtp({ email, otp });
      if ('error' in res && res.error) {
        setError(res.error.message ?? 'Invalid or expired code.');
        return;
      }
      window.location.href = '/dashboard';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function backToEmail() {
    setStep('email');
    setOtp('');
    setError(null);
    setInfo(null);
  }

  return (
    <div className="space-y-4">
      <Button
        onClick={handleGithub}
        disabled={busy}
        size="lg"
        className="w-full bg-text text-bg hover:bg-text/90 focus-visible:focus-ring"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.58.11.79-.25.79-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.17a10.97 10.97 0 0 1 5.74 0c2.18-1.48 3.14-1.17 3.14-1.17.63 1.59.23 2.76.11 3.05.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
        </svg>
        Continue with GitHub
      </Button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="caption text-text-subtle">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {step === 'email' ? (
        <form onSubmit={handleSendOtp} className="space-y-3">
          <input
            ref={emailRef}
            name="email"
            type="email"
            required
            placeholder="you@company.com"
            defaultValue={email}
            onInput={syncHasEmail}
            onChange={(e) => {
              setEmail(e.target.value);
              syncHasEmail();
            }}
            onFocus={syncHasEmail}
            onBlur={syncHasEmail}
            disabled={busy}
            autoComplete="email"
            autoFocus
            className={inputClass}
          />
          <Button
            type="submit"
            disabled={busy || !hasEmail}
            size="lg"
            variant="outline"
            className="w-full"
          >
            {busy ? 'Sending…' : 'Continue with email'}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-3">
          <input
            name="otp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            placeholder="123456"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy}
            autoComplete="one-time-code"
            autoFocus
            className={`${inputClass} text-center font-mono text-[15px] tracking-[0.3em]`}
          />
          <Button
            type="submit"
            disabled={busy || otp.length !== 6}
            size="lg"
            variant="primary"
            className="w-full"
          >
            {busy ? 'Verifying…' : 'Sign in'}
          </Button>
          <button
            type="button"
            onClick={backToEmail}
            disabled={busy}
            className="block w-full text-center text-[13px] text-text-muted hover:text-text disabled:opacity-50"
          >
            Use a different email
          </button>
        </form>
      )}

      {info ? <p className="text-[13px] text-text-muted">{info}</p> : null}
      {error ? <p className="text-[13px] text-error">{error}</p> : null}
    </div>
  );
}
