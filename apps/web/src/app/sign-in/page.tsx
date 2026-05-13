import { Suspense } from 'react';
import Link from 'next/link';
import { SignInForm } from '@/components/sign-in-form';
import { HoloLogo } from '@/components/logo';

// SignInForm reads ?callbackURL via useSearchParams, which opts the page
// out of static prerendering. Suspense lets the static shell render and
// streams the form once the URL is available.
export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return (
    <main className="relative flex min-h-screen flex-col bg-bg text-text">
      <header className="px-6 py-4">
        <Link href="/" aria-label="holo home" className="text-text">
          <HoloLogo />
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col gap-2">
            <span className="caption">Sign in</span>
            <h1 className="font-display text-h1 font-semibold tracking-tight">
              Welcome to holo
            </h1>
            <p className="text-[13px] leading-5 text-text-muted">
              Open-source MCP context layer. Self-hostable. MIT-licensed core; Enterprise add-ons.
            </p>
          </div>
          <Suspense fallback={null}>
            <SignInForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
