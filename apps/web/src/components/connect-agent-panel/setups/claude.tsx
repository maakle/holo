'use client';
import { useState } from 'react';
import { mcpJsonConfig, type CopyHandler } from '../lib';
import { CopyIcon, InlineCode, Snippet, Step } from '../snippet';

export function ClaudeSetup({
  mcpUrl,
  token,
  copied,
  onCopy,
}: {
  mcpUrl: string;
  token: string;
  copied: string | null;
  onCopy: CopyHandler;
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
