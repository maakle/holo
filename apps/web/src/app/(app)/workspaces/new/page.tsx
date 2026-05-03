import Link from 'next/link';
import { CreateWorkspaceForm } from './create-workspace-form';

export const dynamic = 'force-dynamic';

export default function NewWorkspacePage() {
  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Workspaces</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Create a workspace
        </h1>
        <p className="text-[15px] leading-6 text-text-muted">
          A workspace is your team&apos;s isolated boundary — its own connectors, members,
          tokens, audit log, and billing. You&apos;ll be the owner.
        </p>
      </header>

      <CreateWorkspaceForm />

      <p className="text-[13px] text-text-muted">
        Already have a workspace?{' '}
        <Link href="/dashboard" className="text-text underline-offset-2 hover:underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
