import Link from 'next/link';
import { HoloLogo } from '@/components/logo';
import { GithubMark } from '@/components/landing/brand-marks';

const GITHUB_URL = 'https://github.com/maakle/holo';

export function LandingHeader({ isAuthed }: { isAuthed: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur supports-backdrop-filter:bg-bg/60">
      <div className="mx-auto flex max-w-[1280px] items-center gap-8 px-8 py-3.5">
        <Link href="/" aria-label="holo home" className="text-text">
          <HoloLogo />
        </Link>
        <nav className="hidden gap-6 md:flex">
          <Link
            href="#platform"
            className="text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            Product
          </Link>
          <Link
            href="#connectors"
            className="text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            Connectors
          </Link>
          <Link
            href="#open-source"
            className="text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            Open source
          </Link>
          <a
            href={`${GITHUB_URL}#readme`}
            className="text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            Docs
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-[30px] items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-text sm:inline-flex"
          >
            <GithubMark className="h-3.5 w-3.5" />
            <span className="text-text-muted">Star</span>
          </a>
          <Link
            href={isAuthed ? '/dashboard' : '/sign-in'}
            className="inline-flex h-8 items-center justify-center rounded-md px-2 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            {isAuthed ? 'Dashboard' : 'Sign in'}
          </Link>
          <Link
            href={isAuthed ? '/dashboard' : '/sign-in'}
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            {isAuthed ? 'Open dashboard' : 'Get started'}
          </Link>
        </div>
      </div>
    </header>
  );
}
