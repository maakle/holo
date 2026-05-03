'use client';
import { useState } from 'react';

interface Props {
  mcpUrl: string;
}

const CONFIG_TABS = ['Cursor', 'Claude Desktop', 'curl', 'Python', 'TypeScript'] as const;
type Tab = (typeof CONFIG_TABS)[number];

function getConfig(tab: Tab, mcpUrl: string, token: string): string {
  const t = token || '<YOUR_HOLO_TOKEN>';
  switch (tab) {
    case 'Cursor':
      return JSON.stringify(
        {
          mcpServers: {
            holo: { url: mcpUrl, headers: { Authorization: `Bearer ${t}` } },
          },
        },
        null,
        2,
      );
    case 'Claude Desktop':
      return JSON.stringify(
        {
          mcpServers: {
            holo: { url: mcpUrl, headers: { Authorization: `Bearer ${t}` } },
          },
        },
        null,
        2,
      );
    case 'curl':
      return `curl -X POST ${mcpUrl} \\
  -H "Authorization: Bearer ${t}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search","arguments":{"q":"your query"}},"id":1}'`;
    case 'Python':
      return `import httpx\n\nMCP_URL = "${mcpUrl}"\nTOKEN = "${t}"\n\nresp = httpx.post(MCP_URL, headers={"Authorization": f"Bearer {TOKEN}"},\n    json={"jsonrpc":"2.0","method":"tools/call","params":{"name":"search","arguments":{"q":"your query"}},"id":1})\nprint(resp.json())`;
    case 'TypeScript':
      return `const res = await fetch("${mcpUrl}", {\n  method: "POST",\n  headers: { "Authorization": "Bearer ${t}", "Content-Type": "application/json" },\n  body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call",\n    params: { name: "search", arguments: { q: "your query" } }, id: 1 }),\n});\nconsole.log(await res.json());`;
  }
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
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  }

  const config = getConfig(activeTab, mcpUrl, token);
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

      {/* Config snippets */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">
          Agent config
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
        <div className="relative rounded-sm bg-[#0F0F11] dark:bg-[#0F0F11] border border-gray-800">
          <pre className="p-4 text-xs font-mono text-gray-200 overflow-x-auto whitespace-pre-wrap">
            {config}
          </pre>
          <button
            onClick={() => copy(config, 'config')}
            className="absolute top-2 right-2 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 transition-colors"
          >
            {copied === 'config' ? 'Copied!' : 'Copy'}
          </button>
        </div>
        {!token && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Generate a token above to see it substituted into the config.
          </p>
        )}
      </div>
    </div>
  );
}
