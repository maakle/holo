import Link from 'next/link';
import { SignInForm } from '@/components/sign-in-form';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <Link
            href="/"
            className="inline-block font-display text-h1 font-semibold tracking-tight"
          >
            holo
          </Link>
          <p className="mt-3 text-body-sm text-text-muted">
            Sign in to your workspace, or create one in seconds.
          </p>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
