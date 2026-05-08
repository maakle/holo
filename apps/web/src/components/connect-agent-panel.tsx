'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  mcpUrl: string;
  gatewayBase: string;
  orgId: string;
}

const CONFIG_TABS = ['Claude', 'ChatGPT', 'Slack', 'OpenAPI', 'Custom MCP'] as const;
type Tab = (typeof CONFIG_TABS)[number];

// Scope the dismissal per workspace so a fresh workspace doesn't inherit a
// "verified" panel from another workspace on the same browser.
function testDismissedKey(orgId: string): string {
  return `holo:agent-test-dismissed:${orgId}`;
}

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

export function ConnectAgentPanel({ mcpUrl, gatewayBase, orgId }: Props) {
  const dismissedKey = testDismissedKey(orgId);
  const [token, setToken] = useState('');
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Claude');
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
  const [testDismissed, setTestDismissed] = useState<boolean | null>(null);

  // Read dismissed state once on mount, re-read when the workspace changes.
  useEffect(() => {
    try {
      setTestDismissed(localStorage.getItem(dismissedKey) === '1');
    } catch {
      setTestDismissed(false);
    }
  }, [dismissedKey]);

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

  // Poll for first MCP request after token generation.
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
    <div className="space-y-10">
      {/* TESTING ----------------------------------------------------------- */}
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

      {/* CONNECT YOUR AGENT ------------------------------------------------ */}
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

        {activeTab !== 'Slack' && activeTab !== 'Claude' && !token && (
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
        {activeTab === 'OpenAPI' && (
          <OpenApiSetup
            gatewayBase={gatewayBase}
            token={token}
            copied={copied}
            onCopy={copy}
          />
        )}
        {activeTab === 'Custom MCP' && (
          <CustomMcpSetup
            mcpUrl={mcpUrl}
            token={token}
            copied={copied}
            onCopy={copy}
          />
        )}
      </section>
    </div>
  );
}

// --- Testing ---------------------------------------------------------------

function curlVerify(mcpUrl: string, token: string): string {
  const t = token || '<YOUR_HOLO_TOKEN>';
  return [
    `curl -i ${mcpUrl} \\`,
    `  -H "Authorization: Bearer ${t}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`,
  ].join('\n');
}

function TestingSection({
  mcpUrl,
  token,
  tokenId,
  generating,
  genError,
  lastUsedAt,
  copied,
  onCopy,
  onGenerate,
  onDismiss,
}: {
  mcpUrl: string;
  token: string;
  tokenId: string | null;
  generating: boolean;
  genError: string | null;
  lastUsedAt: string | null;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
  onGenerate: () => void;
  onDismiss: () => void;
}) {
  const cmd = curlVerify(mcpUrl, token);
  const verified = Boolean(tokenId && lastUsedAt);

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <span className="caption">Testing</span>
        <h2 className="font-display text-h2 font-medium tracking-tight">
          Test the gateway
        </h2>
        <p className="max-w-2xl text-[13px] leading-6 text-text-muted">
          Generate a temporary key and hit the MCP endpoint with curl. We&apos;ll detect the
          request live. The generated key is a real API key — manage it in{' '}
          <a href="/settings" className="text-accent hover:underline">
            Settings → API keys
          </a>{' '}
          afterwards.
        </p>
      </div>

      <div className="space-y-1">
        <p className="caption">MCP server URL</p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={mcpUrl}
            className="flex-1 rounded-sm border border-border bg-transparent px-3 py-1.5 font-mono text-[13px] text-text"
          />
          <button
            onClick={() => onCopy(mcpUrl, 'url')}
            className="text-[12px] text-text-subtle transition-colors hover:text-text"
          >
            {copied === 'url' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {!token ? (
        <div className="space-y-1">
          <button
            onClick={onGenerate}
            disabled={generating}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors duration-micro ease-enter hover:bg-accent/90 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate test API key'}
          </button>
          {genError && <p className="text-[12px] text-error">{genError}</p>}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-border bg-surface p-3">
          <p className="text-[12px] text-warning">
            Save this key now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-[12px] text-text">
              {token}
            </code>
            <button
              onClick={() => onCopy(token, 'token')}
              className="shrink-0 text-[12px] text-text-subtle transition-colors hover:text-text"
            >
              {copied === 'token' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="caption">Verify with curl</p>
        <p className="text-[13px] leading-6 text-text-muted">
          A <InlineCode>200</InlineCode> response with{' '}
          <InlineCode>serverInfo</InlineCode> means you&apos;re good;{' '}
          <InlineCode>401 HOLO_AUTH_NO_SESSION</InlineCode> means the token wasn&apos;t
          accepted.
        </p>
        <Snippet
          text={cmd}
          copyKey="verify-curl"
          copied={copied}
          onCopy={onCopy}
          language="curl"
        />
        {tokenId && <VerifyStatus lastUsedAt={lastUsedAt} />}
      </div>

      {verified && (
        <div className="flex items-center justify-between rounded-md border border-success/40 bg-success/10 px-3 py-2.5">
          <div className="text-[13px] text-text">
            Looks good — you&apos;re ready to wire up a client below.
          </div>
          <button
            onClick={onDismiss}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] text-text transition-colors hover:bg-surface-2"
          >
            Hide test panel
          </button>
        </div>
      )}
    </section>
  );
}

function VerifyStatus({ lastUsedAt }: { lastUsedAt: string | null }) {
  if (!lastUsedAt) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
        </span>
        Waiting for first request from your terminal…
      </div>
    );
  }
  const when = new Date(lastUsedAt).toLocaleTimeString();
  return (
    <div className="flex items-center gap-2 text-[13px] text-success">
      <span className="inline-flex h-2 w-2 rounded-full bg-success" />
      Received request at {when}. Token works.
    </div>
  );
}

// --- Shared bits -----------------------------------------------------------

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[13px] leading-6 text-text">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-text-muted">
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
    <div className="relative rounded-sm border border-border bg-code-bg">
      {language && (
        <div className="absolute left-3 top-2 font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
          {language}
        </div>
      )}
      <pre className={`overflow-x-auto whitespace-pre-wrap p-4 ${language ? 'pt-7' : ''} font-mono text-xs text-text`}>
        {text}
      </pre>
      <button
        onClick={() => onCopy(text, copyKey)}
        className="absolute right-2 top-2 rounded bg-surface-2 px-2 py-1 text-xs text-text-muted transition-colors hover:text-text"
      >
        {copied === copyKey ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-text">
      {children}
    </code>
  );
}

// --- Custom MCP (was Cursor) -----------------------------------------------

function CustomMcpSetup({
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
    <div className="space-y-4">
      <p className="text-[13px] leading-6 text-text-muted">
        Works with any MCP client that reads a standard{' '}
        <InlineCode>mcp.json</InlineCode> — Cursor, Cline, Continue, Windsurf, custom hosts.
      </p>
      <ol className="list-none space-y-4">
        <Step n={1}>
          Open your client&apos;s MCP config. For example:
          <ul className="ml-1 mt-1 space-y-1 text-[13px] leading-6">
            <li>
              <span className="text-text-subtle">Cursor:</span>{' '}
              <InlineCode>~/.cursor/mcp.json</InlineCode>
            </li>
            <li>
              <span className="text-text-subtle">Cline / Continue:</span> the extension&apos;s
              MCP servers panel
            </li>
            <li>
              <span className="text-text-subtle">Custom host:</span> wherever your runtime
              loads MCP server entries
            </li>
          </ul>
        </Step>
        <Step n={2}>
          Paste this server entry. If the file already has an{' '}
          <InlineCode>mcpServers</InlineCode> block, merge the{' '}
          <InlineCode>holo</InlineCode> key into it.
          <Snippet
            text={config}
            copyKey="custom-mcp-config"
            copied={copied}
            onCopy={onCopy}
            language="mcp.json"
          />
        </Step>
        <Step n={3}>
          Restart (or refresh) your client. The <InlineCode>holo</InlineCode> server should
          appear with a healthy indicator.
        </Step>
        <Step n={4}>
          Try it: ask your agent to &ldquo;use holo to find context for X.&rdquo; Requests
          show up under <InlineCode>Observability → Runs</InlineCode>.
        </Step>
      </ol>
    </div>
  );
}

// --- Claude ----------------------------------------------------------------

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
  const [showManual, setShowManual] = useState(false);
  const config = mcpJsonConfig(mcpUrl, token);
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface px-3 py-2 text-[13px] leading-6 text-text">
        <span className="font-medium">Recommended.</span> Claude.ai web, mobile, and recent
        Desktop versions support remote MCP servers via the Custom Connector UI — no JSON
        editing, no bearer token, OAuth sign-in handled for you.
      </div>
      <ol className="list-none space-y-4">
        <Step n={1}>
          In Claude, open <InlineCode>Settings → Connectors → Add custom connector</InlineCode>.
        </Step>
        <Step n={2}>
          Fill in:
          <ul className="ml-1 mt-1 space-y-1 text-[13px] leading-6">
            <li>
              <span className="text-text-subtle">Name:</span>{' '}
              <InlineCode>holo</InlineCode>
            </li>
            <li>
              <span className="text-text-subtle">Remote MCP server URL:</span>{' '}
              <InlineCode>{mcpUrl}</InlineCode>
              <button
                onClick={() => onCopy(mcpUrl, 'claude-mcp-url')}
                aria-label="Copy MCP server URL"
                className="ml-1.5 inline-flex items-center align-middle text-text-subtle transition-colors hover:text-text"
              >
                {copied === 'claude-mcp-url' ? (
                  <span className="text-[11px]">Copied!</span>
                ) : (
                  <CopyIcon />
                )}
              </button>
            </li>
          </ul>
          <p className="text-xs text-text-subtle">
            Leave OAuth Client ID / Secret blank — holo registers Claude automatically via
            dynamic client registration.
          </p>
        </Step>
        <Step n={3}>
          Click <InlineCode>Add</InlineCode>. Claude opens a holo sign-in window — approve, and
          you&apos;re connected. No API token needed for this path.
        </Step>
        <Step n={4}>
          Enable <InlineCode>holo</InlineCode> from the tool picker (slider icon, bottom of the
          chat input) and try: &ldquo;use holo to find context for X.&rdquo;
        </Step>
      </ol>

      <button
        onClick={() => setShowManual((v) => !v)}
        className="text-xs text-text-subtle transition-colors hover:text-text"
      >
        {showManual ? '− Hide' : '+ Show'} manual setup (older Claude Desktop, no Connectors UI)
      </button>

      {showManual && (
        <ol className="list-none space-y-4 border-l border-border pl-4">
          <Step n={1}>
            Open <InlineCode>Claude → Settings → Developer → Edit Config</InlineCode>.
            <p className="text-xs text-text-subtle">
              File location:{' '}
              <InlineCode>~/Library/Application Support/Claude/</InlineCode> (macOS) ·{' '}
              <InlineCode>%APPDATA%\Claude\</InlineCode> (Windows)
            </p>
          </Step>
          <Step n={2}>
            Paste this — uses your bearer token, not OAuth. Merge <InlineCode>holo</InlineCode>{' '}
            into an existing <InlineCode>mcpServers</InlineCode> block if present.
            <Snippet
              text={config}
              copyKey="claude-config"
              copied={copied}
              onCopy={onCopy}
              language="claude_desktop_config.json"
            />
          </Step>
          <Step n={3}>
            Quit Claude completely and reopen. The <InlineCode>holo</InlineCode> tools appear in
            the &ldquo;Search and tools&rdquo; menu.
          </Step>
        </ol>
      )}
    </div>
  );
}

// --- ChatGPT ---------------------------------------------------------------

function ChatGPTSetup({ mcpUrl, token }: { mcpUrl: string; token: string }) {
  const t = token || '<YOUR_HOLO_TOKEN>';
  return (
    <ol className="list-none space-y-4">
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
        <ul className="ml-1 mt-1 space-y-1 text-[13px] leading-6">
          <li>
            <span className="text-text-subtle">Name:</span>{' '}
            <InlineCode>holo</InlineCode>
          </li>
          <li>
            <span className="text-text-subtle">MCP server URL:</span>{' '}
            <InlineCode>{mcpUrl}</InlineCode>
          </li>
          <li>
            <span className="text-text-subtle">Authentication:</span>{' '}
            <InlineCode>Custom (Bearer)</InlineCode>
          </li>
          <li>
            <span className="text-text-subtle">Token:</span>{' '}
            <InlineCode>{t}</InlineCode>
          </li>
        </ul>
      </Step>
      <Step n={4}>
        Trust the connector when prompted. In a new chat, enable <InlineCode>holo</InlineCode>{' '}
        from the <InlineCode>+</InlineCode> menu (or the &ldquo;Use connectors&rdquo; tool).
      </Step>
      <Step n={5}>
        For custom GPTs / Actions over OpenAPI, see the OpenAPI tab. Most users should use the
        MCP path above.
      </Step>
    </ol>
  );
}

// --- OpenAPI ---------------------------------------------------------------

function OpenApiSetup({
  gatewayBase,
  token,
  copied,
  onCopy,
}: {
  gatewayBase: string;
  token: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const t = token || '<YOUR_HOLO_TOKEN>';
  const specUrl = `${gatewayBase}/openapi.json`;
  const docsUrl = `${gatewayBase}/docs`;

  const searchCurl = [
    `curl -s ${gatewayBase}/v1/search \\`,
    `  -H "Authorization: Bearer ${t}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"query":"onboarding flow","limit":5}'`,
  ].join('\n');

  const listSkillsCurl = [
    `curl -s ${gatewayBase}/v1/skills \\`,
    `  -H "Authorization: Bearer ${t}"`,
  ].join('\n');

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-6 text-text-muted">
        Prefer plain HTTP? holo exposes a small REST surface alongside MCP — handy for custom
        GPT Actions, n8n, scripts, or anything that doesn&apos;t speak MCP. Auth is Bearer
        with the same API keys.
      </p>

      <ol className="list-none space-y-4">
        <Step n={1}>
          Grab the spec or open the live docs.
          <ul className="ml-1 mt-1 space-y-1 text-[13px] leading-6">
            <li>
              <span className="text-text-subtle">OpenAPI 3.1 spec:</span>{' '}
              <InlineCode>{specUrl}</InlineCode>
              <button
                onClick={() => onCopy(specUrl, 'openapi-spec-url')}
                aria-label="Copy OpenAPI spec URL"
                className="ml-1.5 inline-flex items-center align-middle text-text-subtle transition-colors hover:text-text"
              >
                {copied === 'openapi-spec-url' ? (
                  <span className="text-[11px]">Copied!</span>
                ) : (
                  <CopyIcon />
                )}
              </button>
            </li>
            <li>
              <span className="text-text-subtle">Interactive docs:</span>{' '}
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {docsUrl}
              </a>
            </li>
          </ul>
        </Step>

        <Step n={2}>
          Authenticate every request with{' '}
          <InlineCode>Authorization: Bearer &lt;key&gt;</InlineCode>. Generate one in{' '}
          <a href="/settings" className="text-accent hover:underline">
            Settings → API keys
          </a>
          .
        </Step>

        <Step n={3}>
          Search across your indexed content:
          <Snippet
            text={searchCurl}
            copyKey="openapi-search-curl"
            copied={copied}
            onCopy={onCopy}
            language="curl"
          />
        </Step>

        <Step n={4}>
          List skills available to the authenticated user:
          <Snippet
            text={listSkillsCurl}
            copyKey="openapi-skills-curl"
            copied={copied}
            onCopy={onCopy}
            language="curl"
          />
        </Step>

        <Step n={5}>
          For custom GPT Actions, import{' '}
          <InlineCode>{specUrl}</InlineCode> in the GPT builder and pick{' '}
          <InlineCode>Bearer</InlineCode> as the auth type. Paste your holo API key when
          prompted.
        </Step>
      </ol>
    </div>
  );
}

// --- Slack -----------------------------------------------------------------

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
      <div className="space-y-3 rounded-md border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-warning">
            Beta
          </span>
          <span className="text-xs text-text-subtle">Talk to holo from Slack</span>
        </div>
        <p className="text-[13px] leading-6 text-text">
          Mention <InlineCode>@holo</InlineCode> in any channel or DM, or run{' '}
          <InlineCode>/holo</InlineCode>, to retrieve context from your indexed sources. The
          bot uses the same Slack connection as your ingest sync.
        </p>
      </div>

      {status === 'loading' && (
        <p className="text-xs text-text-subtle">Checking workspace…</p>
      )}

      {status === 'not_connected' && (
        <div className="space-y-3">
          <p className="text-[13px] leading-6 text-text">
            You haven&apos;t connected Slack yet. Install the holo Slack app first — the bot
            and ingest sync share the same install.
          </p>
          <a
            href="/connections"
            className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#611f63]"
          >
            <SlackMark />
            Connect Slack →
          </a>
        </div>
      )}

      {status === 'ingest_only' && <SlackReauthCta />}

      {status === 'bot_enabled' && (
        <ol className="list-none space-y-4">
          <Step n={1}>
            <span className="text-success">
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
        <p className="text-xs text-error">
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
      <p className="text-[13px] leading-6 text-text">
        Your Slack workspace is connected for ingest, but the <InlineCode>@holo</InlineCode>{' '}
        bot needs additional scopes (mentions, DMs, <InlineCode>chat:write</InlineCode>, slash
        command). Re-authorize to enable the bot — Slack will prompt you to approve the new
        scopes.
      </p>
      <button
        onClick={reauth}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#611f63] disabled:opacity-50"
      >
        <SlackMark />
        {busy ? 'Redirecting…' : 'Re-authorize for @holo bot'}
      </button>
      {err && <p className="text-xs text-error">{err}</p>}
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
