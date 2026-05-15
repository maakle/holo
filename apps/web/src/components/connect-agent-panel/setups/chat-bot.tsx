'use client';
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SlackSetup } from './slack';
import { GoogleChatSetup } from './google-chat';
import { TeamsSetup } from './teams';
import { isChatSurface, type ChatSurface } from '../lib';

export function ChatBotSetup() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get('surface');
  const surface: ChatSurface = isChatSurface(raw) ? raw : 'slack';

  const setSurface = useCallback(
    (next: ChatSurface) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('surface', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-border">
        <SurfaceTab active={surface === 'slack'} onClick={() => setSurface('slack')}>
          Slack
        </SurfaceTab>
        <SurfaceTab
          active={surface === 'google-chat'}
          onClick={() => setSurface('google-chat')}
        >
          Google Chat
        </SurfaceTab>
        <SurfaceTab active={surface === 'teams'} onClick={() => setSurface('teams')}>
          Microsoft Teams
        </SurfaceTab>
      </div>

      {surface === 'slack' && <SlackSetup />}
      {surface === 'google-chat' && <GoogleChatSetup />}
      {surface === 'teams' && <TeamsSetup />}
    </div>
  );
}

function SurfaceTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors duration-micro ease-enter ${
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}
