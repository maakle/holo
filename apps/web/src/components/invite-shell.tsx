import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function InviteShell({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <main className="flex min-h-screen flex-col bg-bg text-text">
      <header className="px-6 py-4">
        <Link href="/" className="font-display text-[15px] font-semibold tracking-tight">
          holo
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="font-display text-h1 font-semibold tracking-tight">{title}</h1>
          <p className="text-[13px] leading-5 text-text-muted">{body}</p>
          <Button asChild variant="outline">
            <Link href={action?.href ?? '/'}>{action?.label ?? 'Back to home'}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
