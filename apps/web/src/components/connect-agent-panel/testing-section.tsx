import { curlVerify, type CopyHandler } from './lib';
import { InlineCode, Snippet } from './snippet';

export function TestingSection({
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
  onCopy: CopyHandler;
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
