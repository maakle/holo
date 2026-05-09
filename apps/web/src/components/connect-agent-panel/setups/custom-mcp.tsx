import { mcpJsonConfig, type CopyHandler } from '../lib';
import { InlineCode, Snippet, Step } from '../snippet';

export function CustomMcpSetup({
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
