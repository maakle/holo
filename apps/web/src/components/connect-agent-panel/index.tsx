'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CONFIG_TABS,
  modeStorageKey,
  testDismissedKey,
  type ConnectMode,
  type Tab,
} from './lib';
import { InlineCode } from './snippet';
import { TestingSection } from './testing-section';
import { ClaudeSetup } from './setups/claude';
import { ChatGPTSetup } from './setups/chatgpt';
import { CustomMcpSetup } from './setups/custom-mcp';
import { GeminiSetup } from './setups/gemini';
import { OpenApiSetup } from './setups/openapi';
import { ChatBotSetup } from './setups/chat-bot';

interface Props {
  mcpUrl: string;
  gatewayBase: string;
  orgId: string;
}

export function ConnectAgentPanel({ mcpUrl, gatewayBase, orgId }: Props) {
  const dismissedKey = testDismissedKey(orgId);
  const modeKey = modeStorageKey(orgId);
  const [mode, setMode] = useState<ConnectMode>('chat-bot');
  const [token, setToken] = useState('');
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Claude');
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
  const [testDismissed, setTestDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setTestDismissed(localStorage.getItem(dismissedKey) === '1');
      const stored = localStorage.getItem(modeKey);
      if (stored === 'chat-bot' || stored === 'agent') setMode(stored);
    } catch {
      setTestDismissed(false);
    }
  }, [dismissedKey, modeKey]);

  function selectMode(next: ConnectMode) {
    setMode(next);
    try {
      localStorage.setItem(modeKey, next);
    } catch {
      // storage may be unavailable; in-memory selection is fine
    }
  }

  function dismissTesting() {
    try {
      localStorage.setItem(dismissedKey, '1');
    } catch {
      // storage may be unavailable; in-memory dismissal is fine
    }
    setTestDismissed(true);
  }

  function reopenTesting() {
    try {
      localStorage.removeItem(dismissedKey);
    } catch {
      // best effort
    }
    setTestDismissed(false);
  }

  async function generateToken() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'agent-test' }),
      });
      const data = (await res.json()) as { id?: string; token?: string; problem?: string };
      if (res.ok && data.token) {
        setToken(data.token);
        setTokenId(data.id ?? null);
        setLastUsedAt(null);
      } else {
        setGenError(data.problem ?? 'Failed to generate token.');
      }
    } catch {
      setGenError('Network error.');
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (!tokenId || lastUsedAt) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tokens/${tokenId}/last-used`);
        if (!res.ok) return;
        const data = (await res.json()) as { lastUsedAt?: string | null };
        if (!cancelled && data.lastUsedAt) setLastUsedAt(data.lastUsedAt);
      } catch {
        // swallow — keep polling
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tokenId, lastUsedAt]);

  function copy(text: string, key: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="space-y-8">
      <ModePicker mode={mode} onSelect={selectMode} />

      {mode === 'chat-bot' && <ChatBotSetup />}

      {mode === 'agent' && (
        <div className="space-y-10">
          {testDismissed === false && (
            <TestingSection
              mcpUrl={mcpUrl}
              token={token}
              tokenId={tokenId}
              generating={generating}
              genError={genError}
              lastUsedAt={lastUsedAt}
              copied={copied}
              onCopy={copy}
              onGenerate={generateToken}
              onDismiss={dismissTesting}
            />
          )}

          {testDismissed === true && (
            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-[13px] text-text">
                  <span className="inline-flex h-2 w-2 rounded-full bg-success" />
                  Connection verified. Test panel hidden.
                </div>
                <p className="text-[12px] text-text-subtle">
                  Manage API keys in{' '}
                  <a href="/settings" className="text-accent hover:underline">
                    Settings → API keys
                  </a>
                  .
                </p>
              </div>
              <button
                onClick={reopenTesting}
                className="text-[12px] text-text-subtle transition-colors hover:text-text"
              >
                Test again
              </button>
            </div>
          )}

          <section className="space-y-3">
            <div className="space-y-1">
              <span className="caption">Connect your agent</span>
              <h2 className="font-display text-h2 font-medium tracking-tight">
                Wire up a client
              </h2>
              <p className="max-w-2xl text-[13px] leading-6 text-text-muted">
                Pick your client below. Token-based clients use API keys from{' '}
                <a href="/settings" className="text-accent hover:underline">
                  Settings → API keys
                </a>
                ; Claude can connect over OAuth without a token.
              </p>
            </div>

            <div className="flex gap-1 border-b border-border">
              {CONFIG_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors duration-micro ease-enter ${
                    activeTab === tab
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab !== 'Claude' && !token && (
              <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
                <span
                  aria-hidden
                  className="mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white"
                >
                  !
                </span>
                <div className="text-[13px] leading-6 text-text">
                  Snippets below use <InlineCode>&lt;YOUR_HOLO_TOKEN&gt;</InlineCode> as a
                  placeholder. Generate a key in{' '}
                  <a href="/settings" className="text-accent hover:underline">
                    Settings → API keys
                  </a>{' '}
                  and paste it in.
                </div>
              </div>
            )}

            {activeTab === 'Claude' && (
              <ClaudeSetup mcpUrl={mcpUrl} token={token} copied={copied} onCopy={copy} />
            )}
            {activeTab === 'ChatGPT' && <ChatGPTSetup mcpUrl={mcpUrl} token={token} />}
            {activeTab === 'Gemini' && (
              <GeminiSetup
                gatewayBase={gatewayBase}
                token={token}
                copied={copied}
                onCopy={copy}
              />
            )}
            {activeTab === 'OpenAPI' && (
              <OpenApiSetup
                gatewayBase={gatewayBase}
                token={token}
                copied={copied}
                onCopy={copy}
              />
            )}
            {activeTab === 'Custom MCP' && (
              <CustomMcpSetup mcpUrl={mcpUrl} token={token} copied={copied} onCopy={copy} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ModePicker({
  mode,
  onSelect,
}: {
  mode: ConnectMode;
  onSelect: (next: ConnectMode) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ModeCard
        active={mode === 'chat-bot'}
        title="Chat bot"
        description="Talk to holo from Slack — Google Chat and Teams coming soon."
        onClick={() => onSelect('chat-bot')}
      />
      <ModeCard
        active={mode === 'agent'}
        title="AI agent"
        description="Use holo as an MCP server in Claude, ChatGPT, or any custom client."
        onClick={() => onSelect('agent')}
      />
    </div>
  );
}

function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group flex flex-col gap-1.5 rounded-md border px-4 py-3.5 text-left transition-colors duration-micro ease-enter ${
        active
          ? 'border-accent bg-accent/5'
          : 'border-border bg-surface hover:border-text-subtle'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium text-text">{title}</span>
        <span
          aria-hidden
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${
            active ? 'border-accent bg-accent' : 'border-border'
          }`}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
      </div>
      <p className="text-[13px] leading-5 text-text-muted">{description}</p>
    </button>
  );
}
