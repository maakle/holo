'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { HoloLogo } from '@/components/logo';
import { GithubMark } from '@/components/landing/brand-marks';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const GITHUB_URL = 'https://github.com/maakle/holo';

const NAV_LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: '#platform', label: 'Product' },
  { href: '#connectors', label: 'Connectors' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#open-source', label: 'Open source' },
  { href: `${GITHUB_URL}#readme`, label: 'Docs', external: true },
];

export function LandingHeader({ isAuthed }: { isAuthed: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur supports-backdrop-filter:bg-bg/60">
      <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 py-3.5 sm:gap-8 sm:px-8">
        <Link href="/" aria-label="holo home" className="text-text">
          <HoloLogo />
        </Link>
        <nav className="hidden gap-6 md:flex">
          {NAV_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-medium text-text-muted transition-colors hover:text-text"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="text-[13px] font-medium text-text-muted transition-colors hover:text-text"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
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
            className="hidden h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg transition-opacity hover:opacity-90 sm:inline-flex"
          >
            {isAuthed ? 'Open dashboard' : 'Get started'}
          </Link>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus:focus-ring"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] max-w-[85vw] bg-bg p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="flex h-full flex-col">
                <div className="flex h-14 items-center border-b border-border px-5 text-text">
                  <HoloLogo />
                </div>
                <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
                  {NAV_LINKS.map((link) =>
                    link.external ? (
                      <a
                        key={link.href}
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className="rounded-md px-3 py-2 text-[14px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className="rounded-md px-3 py-2 text-[14px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                      >
                        {link.label}
                      </Link>
                    ),
                  )}
                </nav>
                <div className="flex flex-col gap-2 border-t border-border px-3 py-4">
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text"
                  >
                    <GithubMark className="h-3.5 w-3.5" />
                    <span className="text-text-muted">Star on GitHub</span>
                  </a>
                  <Link
                    href={isAuthed ? '/dashboard' : '/sign-in'}
                    onClick={() => setOpen(false)}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg transition-opacity hover:opacity-90"
                  >
                    {isAuthed ? 'Open dashboard' : 'Get started'}
                  </Link>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
