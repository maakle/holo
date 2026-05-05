'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  mcpUrl: string;
}

const CONFIG_TABS = ['Cursor', 'Claude', 'ChatGPT', 'Slack'] as const;
type Tab = (typeof CONFIG_TABS)[number];

function mcpJsonConfig(mcpUrl: string, token: string): string {
  const t = token || '<YOUR_HOLO_TOKEN>';
  return JSON.stringify(
    {
      mcpServers: {
        holo: { url: mcpUrl, headers: { Authorization: `Bearer ${t}` } },
      },
    },
    null,
    2,
  );
}

export function ConnectAgentPanel({ mcpUrl }: Props) {
  const [token, setToken] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Cursor');

  async function generateToken() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'agent' }),
      });
      const data = (await res.json()) as { token?: string; problem?: string };
      if (res.ok && data.token) {
        setToken(data.token);
      } else {
        setGenError(data.problem ?? 'Failed to generate token.');
      }
    } catch {
      setGenError('Network error.');
    } finally {
      setGenerating(false);
    }
  }

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

  const inputCls =
    'rounded-sm border border-gray-300 bg-white px-3 py-1.5 text-sm font-mono dark:border-gray-700 dark:bg-gray-950';
  const btnPrimary =
    'rounded-md bg-[#3F47FF] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3038e0] disabled:opacity-50 transition-colors';

  return (
    <div className="space-y-6">
      {/* MCP URL */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">
          MCP server URL
        </p>
        <div className="flex items-center gap-2">
          <input readOnly value={mcpUrl} className={`${inputCls} flex-1`} />
          <button
            onClick={() => copy(mcpUrl, 'url')}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            {copied === 'url' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Token */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">
          API token
        </p>
        {token ? (
          <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 space-y-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Save this token now — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono flex-1 break-all">{token}</code>
              <button
                onClick={() => copy(token, 'token')}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 shrink-0 transition-colors"
              >
                {copied === 'token' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <button onClick={generateToken} disabled={generating} className={btnPrimary}>
              {generating ? 'Generating…' : 'Generate API token'}
            </button>
            {genError && (
              <p className="text-xs text-red-600 dark:text-red-400">{genError}</p>
            )}
          </div>
        )}
      </div>

      {/* Setup */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">
          Setup
        </p>
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
          {CONFIG_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-[#3F47FF] text-[#3F47FF]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Cursor' && (
          <CursorSetup
            mcpUrl={mcpUrl}
            token={token}
            copied={copied}
            onCopy={copy}
          />
        )}
        {activeTab === 'Claude' && (
          <ClaudeSetup
            mcpUrl={mcpUrl}
            token={token}
            copied={copied}
            onCopy={copy}
          />
        )}
        {activeTab === 'ChatGPT' && (
          <ChatGPTSetup mcpUrl={mcpUrl} token={token} />
        )}
        {activeTab === 'Slack' && <SlackSetup />}

        {!token && activeTab !== 'Slack' && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Generate a token above to see it pre-filled below.
          </p>
        )}
      </div>
    </div>
  );
}

// --- Tab content -----------------------------------------------------------

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[13px] leading-6 text-gray-700 dark:text-gray-300">
      <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-800 text-[11px] font-medium flex items-center justify-center mt-0.5 text-gray-600 dark:text-gray-400">
        {n}
      </span>
      <div className="flex-1 space-y-2">{children}</div>
    </li>
  );
}

function Snippet({
  text,
  copyKey,
  copied,
  onCopy,
  language,
}: {
  text: string;
  copyKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
  language?: string;
}) {
  return (
    <div className="relative rounded-sm bg-[#0F0F11] border border-gray-800">
      {language && (
        <div className="absolute top-2 left-3 text-[10px] uppercase tracking-[0.06em] text-gray-500 font-mono">
          {language}
        </div>
      )}
      <pre className={`p-4 ${language ? 'pt-7' : ''} text-xs font-mono text-gray-200 overflow-x-auto whitespace-pre-wrap`}>
        {text}
      </pre>
      <button
        onClick={() => onCopy(text, copyKey)}
        className="absolute top-2 right-2 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 transition-colors"
      >
        {copied === copyKey ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-[12px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200">
      {children}
    </code>
  );
}

function CursorSetup({
  mcpUrl,
  token,
  copied,
  onCopy,
}: {
  mcpUrl: string;
  token: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const config = mcpJsonConfig(mcpUrl, token);
  return (
    <ol className="space-y-4 list-none">
      <Step n={1}>
        Open Cursor → <InlineCode>Settings</InlineCode> → <InlineCode>MCP</InlineCode>, or
        edit <InlineCode>~/.cursor/mcp.json</InlineCode> directly.
      </Step>
      <Step n={2}>
        Paste this server entry. If the file already has an <InlineCode>mcpServers</InlineCode>{' '}
        block, merge the <InlineCode>holo</InlineCode> key into it.
        <Snippet
          text={config}
          copyKey="cursor-config"
          copied={copied}
          onCopy={onCopy}
          language="mcp.json"
        />
      </Step>
      <Step n={3}>
        Restart Cursor (or hit the refresh icon in the MCP settings panel). The{' '}
        <InlineCode>holo</InlineCode> server should appear with a green dot.
      </Step>
      <Step n={4}>
        Try it: ask Cursor &ldquo;use holo to find context for X.&rdquo; You&apos;ll see the
        request show up under <InlineCode>Skills → Runs</InlineCode>.
      </Step>
    </ol>
  );
}

function ClaudeSetup({
  mcpUrl,
  token,
  copied,
  onCopy,
}: {
  mcpUrl: string;
  token: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const config = mcpJsonConfig(mcpUrl, token);
  return (
    <ol className="space-y-4 list-none">
      <Step n={1}>
        Open <InlineCode>Claude → Settings → Developer → Edit Config</InlineCode>. This opens{' '}
        <InlineCode>claude_desktop_config.json</InlineCode> in your editor.
        <p className="text-xs text-gray-500 dark:text-gray-400">
          File location:{' '}
          <InlineCode>~/Library/Application Support/Claude/</InlineCode> (macOS) ·{' '}
          <InlineCode>%APPDATA%\Claude\</InlineCode> (Windows)
        </p>
      </Step>
      <Step n={2}>
        Paste this into the file. Merge <InlineCode>holo</InlineCode> into an existing{' '}
        <InlineCode>mcpServers</InlineCode> block if you have one.
        <Snippet
          text={config}
          copyKey="claude-config"
          copied={copied}
          onCopy={onCopy}
          language="claude_desktop_config.json"
        />
      </Step>
      <Step n={3}>
        Quit Claude completely and reopen. Look for the{' '}
        <InlineCode>holo</InlineCode> tools in the &ldquo;Search and tools&rdquo; menu (slider
        icon, bottom-left of the chat input).
      </Step>
      <Step n={4}>
        Mobile / Claude.ai web: same URL works as a Custom Connector under{' '}
        <InlineCode>Settings → Connectors → Add custom connector</InlineCode>. Paste the URL
        above; auth uses the same Bearer token.
      </Step>
    </ol>
  );
}

function ChatGPTSetup({ mcpUrl, token }: { mcpUrl: string; token: string }) {
  const t = token || '<YOUR_HOLO_TOKEN>';
  return (
    <ol className="space-y-4 list-none">
      <Step n={1}>
        Requires ChatGPT Pro, Business, Enterprise, or Edu (Developer Mode for MCP is not
        available on Free/Plus today).
      </Step>
      <Step n={2}>
        In ChatGPT, go to <InlineCode>Settings → Connectors → Advanced</InlineCode> and turn
        on <InlineCode>Developer mode</InlineCode>.
      </Step>
      <Step n={3}>
        Open <InlineCode>Settings → Connectors → Create</InlineCode> and fill in:
        <ul className="text-[13px] leading-6 space-y-1 ml-1 mt-1">
          <li>
            <span className="text-gray-500 dark:text-gray-400">Name:</span>{' '}
            <InlineCode>holo</InlineCode>
          </li>
          <li>
            <span className="text-gray-500 dark:text-gray-400">MCP server URL:</span>{' '}
            <InlineCode>{mcpUrl}</InlineCode>
          </li>
          <li>
            <span className="text-gray-500 dark:text-gray-400">Authentication:</span>{' '}
            <InlineCode>Custom (Bearer)</InlineCode>
          </li>
          <li>
            <span className="text-gray-500 dark:text-gray-400">Token:</span>{' '}
            <InlineCode>{t}</InlineCode>
          </li>
        </ul>
      </Step>
      <Step n={4}>
        Trust the connector when prompted. In a new chat, enable <InlineCode>holo</InlineCode>{' '}
        from the <InlineCode>+</InlineCode> menu (or the &ldquo;Use connectors&rdquo; tool).
      </Step>
      <Step n={5}>
        For custom GPTs / Actions (OpenAPI route), see the{' '}
        <a
          href="https://docs.holo.dev/connect/chatgpt-actions"
          className="text-[#3F47FF] hover:underline"
        >
          OpenAPI guide
        </a>
        . Most users should use the MCP path above.
      </Step>
    </ol>
  );
}

type SlackBotStatus = 'loading' | 'not_connected' | 'ingest_only' | 'bot_enabled' | 'error';

function useSlackBotStatus(): SlackBotStatus {
  const [status, setStatus] = useState<SlackBotStatus>('loading');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/connectors/slack/bot-status')
      .then((res) => res.json())
      .then((data: { status?: SlackBotStatus }) => {
        if (cancelled) return;
        setStatus(data.status ?? 'error');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

function SlackSetup() {
  // The Slack bot rides on the same Slack app used for ingest. Behavior here
  // is status-aware:
  //  - not_connected: send the user to /connections to install Slack first
  //  - ingest_only:   prompt re-auth so Slack adds the bot scopes
  //  - bot_enabled:   show the success state and how to use @holo
  const status = useSlackBotStatus();

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded">
            Beta
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Talk to holo from Slack
          </span>
        </div>
        <p className="text-[13px] leading-6 text-gray-700 dark:text-gray-300">
          Mention <InlineCode>@holo</InlineCode> in any channel or DM, or run{' '}
          <InlineCode>/holo</InlineCode>, to retrieve context from your indexed sources. The
          bot uses the same Slack connection as your ingest sync.
        </p>
      </div>

      {status === 'loading' && (
        <p className="text-xs text-gray-400 dark:text-gray-500">Checking workspace…</p>
      )}

      {status === 'not_connected' && (
        <div className="space-y-3">
          <p className="text-[13px] leading-6 text-gray-700 dark:text-gray-300">
            You haven&apos;t connected Slack yet. Install the holo Slack app first — the bot
            and ingest sync share the same install.
          </p>
          <a
            href="/connections"
            className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-2 text-xs font-medium text-white hover:bg-[#611f63] transition-colors"
          >
            <SlackMark />
            Connect Slack →
          </a>
        </div>
      )}

      {status === 'ingest_only' && <SlackReauthCta />}

      {status === 'bot_enabled' && (
        <ol className="space-y-4 list-none">
          <Step n={1}>
            <span className="text-emerald-600 dark:text-emerald-400">
              ✓ <InlineCode>@holo</InlineCode> is active in your workspace.
            </span>
          </Step>
          <Step n={2}>
            Invite the bot into any channel and ping it:{' '}
            <InlineCode>/invite @holo</InlineCode>, then{' '}
            <InlineCode>@holo what do we know about onboarding?</InlineCode>
          </Step>
          <Step n={3}>
            Or use the slash command anywhere: <InlineCode>/holo &lt;your question&gt;</InlineCode>.
            Add <InlineCode>--public</InlineCode> to share the answer with the channel.
          </Step>
          <Step n={4}>
            DMs work too — open a DM with <InlineCode>@holo</InlineCode> and ask directly.
          </Step>
        </ol>
      )}

      {status === 'error' && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Couldn&apos;t check Slack bot status. Refresh and try again.
        </p>
      )}
    </div>
  );
}

/**
 * Re-auth button: the existing /api/connectors/[provider]/initiate route
 * accepts POST and returns { authorizeUrl } — we POST programmatically and
 * navigate the browser there. Same pattern as the connect-wizard but inline.
 */
function SlackReauthCta() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reauth() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/connectors/slack/initiate', { method: 'POST' });
      const data = (await res.json()) as { authorizeUrl?: string; problem?: string };
      if (res.ok && data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
        return;
      }
      setErr(data.problem ?? 'Failed to start Slack re-auth.');
    } catch {
      setErr('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-6 text-gray-700 dark:text-gray-300">
        Your Slack workspace is connected for ingest, but the <InlineCode>@holo</InlineCode>{' '}
        bot needs additional scopes (mentions, DMs, <InlineCode>chat:write</InlineCode>, slash
        command). Re-authorize to enable the bot — Slack will prompt you to approve the new
        scopes.
      </p>
      <button
        onClick={reauth}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-2 text-xs font-medium text-white hover:bg-[#611f63] disabled:opacity-50 transition-colors"
      >
        <SlackMark />
        {busy ? 'Redirecting…' : 'Re-authorize for @holo bot'}
      </button>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}

function SlackMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 14.5a2 2 0 1 1 2 2H5v-2zm1-1a2 2 0 1 1-2-2h2v2zM10.5 5a2 2 0 1 1 2 2v2h-2V5zm1 1a2 2 0 1 1-2 2v-2h2zM19 9.5a2 2 0 1 1-2-2h2v2zm-1 1a2 2 0 1 1 2 2h-2v-2zM13.5 19a2 2 0 1 1-2-2v-2h2v4zm-1-1a2 2 0 1 1 2-2v2h-2z"
        fill="currentColor"
      />
    </svg>
  );
}
