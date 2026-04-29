import { SignInForm } from '@/components/sign-in-form';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Sign in to memex</h1>
          <p className="text-sm text-gray-500">Single-user mode (v0.0).</p>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
