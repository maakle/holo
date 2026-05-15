'use client';
import { useState } from 'react';
import { SlackSetup } from './slack';
import { GoogleChatSetup } from './google-chat';

type Surface = 'slack' | 'google-chat';

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
        <ComingSoonChip label="Microsoft Teams" />
      </div>

      {surface === 'slack' && <SlackSetup />}
      {surface === 'google-chat' && <GoogleChatSetup />}
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

function ComingSoonChip({ label }: { label: string }) {
  return (
    <span className="ml-auto mb-1 inline-flex items-center gap-1.5 self-center rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-text-muted">
      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-text-subtle" />
      {label} coming soon
    </span>
  );
}
