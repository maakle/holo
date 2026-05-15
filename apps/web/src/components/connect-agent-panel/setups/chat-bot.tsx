'use client';
import { useState } from 'react';
import { SlackSetup } from './slack';
import { GoogleChatSetup } from './google-chat';
import { TeamsSetup } from './teams';

type Surface = 'slack' | 'google-chat' | 'teams';

export function ChatBotSetup() {
  const [surface, setSurface] = useState<Surface>('slack');

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
