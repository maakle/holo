'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Sun, Moon, Monitor, User, LogOut, ChevronsUpDown, Palette } from 'lucide-react';
import { signOut } from '@holo/auth/client';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark' | 'system';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem('holo.theme');
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function UserMenu({ name, email }: { name?: string | null; email: string }) {
  const display = name?.trim() || email;
  const initial = display.charAt(0).toUpperCase();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function selectTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem('holo.theme', next);
    } catch {}
  }

  return (
    <div ref={ref} className="relative px-2 py-2">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors duration-micro hover:bg-surface-2"
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text text-bg"
          aria-hidden
        >
          <span className="text-[12px] font-semibold leading-none">{initial}</span>
        </div>
        <span className="min-w-0 flex-1 truncate text-[13px] text-text">{display}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-2 right-2 mb-2 rounded-lg border border-border bg-bg p-1 shadow-lg"
        >
          <div className="border-b border-border px-2 pb-2 pt-1.5">
            <div className="truncate text-[13px] font-medium text-text">{display}</div>
            <div className="truncate text-[11px] text-text-subtle">{email}</div>
          </div>

          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <User className="h-3.5 w-3.5 text-text-subtle" />
            Profile
          </Link>

          <div className="mt-1 flex items-center justify-between rounded-md px-2 py-1.5">
            <span className="flex items-center gap-2 text-[13px] text-text-muted">
              <Palette className="h-3.5 w-3.5 text-text-subtle" />
              Theme
            </span>
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                type="button"
                aria-label="System theme"
                aria-pressed={mounted && theme === 'system'}
                onClick={() => selectTheme('system')}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-sm text-text-subtle transition-colors duration-micro hover:text-text',
                  mounted && theme === 'system' && 'bg-surface-2 text-text',
                )}
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Light mode"
                aria-pressed={mounted && theme === 'light'}
                onClick={() => selectTheme('light')}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-sm text-text-subtle transition-colors duration-micro hover:text-text',
                  mounted && theme === 'light' && 'bg-surface-2 text-text',
                )}
              >
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Dark mode"
                aria-pressed={mounted && theme === 'dark'}
                onClick={() => selectTheme('dark')}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-sm text-text-subtle transition-colors duration-micro hover:text-text',
                  mounted && theme === 'dark' && 'bg-surface-2 text-text',
                )}
              >
                <Moon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              window.location.href = '/sign-in';
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <LogOut className="h-3.5 w-3.5 text-text-subtle" />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
