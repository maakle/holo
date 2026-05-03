'use client';

import { useState } from 'react';

interface Snippet {
  id: string;
  title: string;
  lang: string;
  template: string;
  description: string;
}

const SNIPPETS: Snippet[] = [
  {
    id: 'claude-desktop',
    title: 'Claude Desktop',
    lang: 'json',
    description: 'Add to ~/Library/Application Support/Claude/claude_desktop_config.json',
    template: `{
  "mcpServers": {
    "holo": {
      "url": "{MCP_URL}",
      "headers": {
        "Authorization": "Bearer {TOKEN}"
      }
    }
  }
}`,
  },
  {
    id: 'cursor',
    title: 'Cursor',
    lang: 'json',
    description: 'Add to ~/.cursor/mcp.json (or per-project .cursor/mcp.json)',
    template: `{
  "mcpServers": {
    "holo": {
      "url": "{MCP_URL}",
      "headers": {
        "Authorization": "Bearer {TOKEN}"
      }
    }
  }
}`,
  },
  {
    id: 'cline',
    title: 'Cline',
    lang: 'json',
    description: 'Add to your VS Code workspace mcpSettings.json',
    template: `{
  "mcpServers": {
    "holo": {
      "url": "{MCP_URL}",
      "headers": {
        "Authorization": "Bearer {TOKEN}"
      }
    }
  }
}`,
  },
  {
    id: 'curl',
    title: 'curl',
    lang: 'bash',
    description: 'Quick check from a terminal',
    template: `curl -X POST "{REST_URL}/v1/search" \\
  -H "Authorization: Bearer {TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "how do we onboard a new ATS partner?", "limit": 5}'`,
  },
  {
    id: 'python',
    title: 'Python',
    lang: 'python',
    description: 'For agents written against the REST surface',
    template: `import os, requests

HOLO_TOKEN = os.environ["HOLO_TOKEN"]   # from your environment
HOLO_URL = "{REST_URL}"

def search(query: str, limit: int = 5):
    r = requests.post(
        f"{HOLO_URL}/v1/search",
        headers={"Authorization": f"Bearer {HOLO_TOKEN}"},
        json={"query": query, "limit": limit},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()`,
  },
  {
    id: 'typescript',
    title: 'TypeScript',
    lang: 'ts',
    description: 'For agents written against the REST surface',
    template: `const HOLO_TOKEN = process.env.HOLO_TOKEN!;
const HOLO_URL = "{REST_URL}";

export async function search(query: string, limit = 5) {
  const r = await fetch(\`\${HOLO_URL}/v1/search\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${HOLO_TOKEN}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit }),
  });
  if (!r.ok) throw new Error(\`holo \${r.status}: \${await r.text()}\`);
  return r.json();
}`,
  },
];

export function ConfigBlocks({
  mcpUrl,
  restUrl,
  token,
}: {
  mcpUrl: string;
  restUrl: string;
  token: string | null;
}) {
  const [activeId, setActiveId] = useState<string>(SNIPPETS[0]!.id);
  const [copied, setCopied] = useState<string | null>(null);
  const placeholder = '<HOLO_TOKEN>';
  const tokenValue = token ?? placeholder;
  const active = SNIPPETS.find((s) => s.id === activeId) ?? SNIPPETS[0]!;

  const renderedCode = active.template
    .replaceAll('{MCP_URL}', mcpUrl)
    .replaceAll('{REST_URL}', restUrl)
    .replaceAll('{TOKEN}', tokenValue);

  async function copy() {
    await navigator.clipboard.writeText(renderedCode);
    setCopied(active.id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveId(s.id)}
            className={
              s.id === activeId
                ? 'rounded-md border border-accent bg-accent px-3 py-1 text-body-sm font-medium text-accent-fg'
                : 'rounded-md border border-border px-3 py-1 text-body-sm text-text-muted hover:border-border-strong hover:text-text'
            }
          >
            {s.title}
          </button>
        ))}
      </div>
      <p className="text-body-sm text-text-muted">{active.description}</p>
      <div className="overflow-hidden rounded-md border border-border bg-[var(--code-bg)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="font-mono text-mono text-text-subtle">{active.title}</span>
          <div className="flex items-center gap-3">
            <span className="text-caption uppercase text-text-subtle">{active.lang}</span>
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-border px-2 py-0.5 text-caption uppercase text-text-muted hover:border-border-strong hover:text-text"
            >
              {copied === active.id ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <pre className="overflow-x-auto px-4 py-4 font-mono text-mono text-text">
          <code>{renderedCode}</code>
        </pre>
      </div>
      {!token && (
        <p className="text-body-sm text-text-subtle">
          Generate a token above to substitute it into the snippet automatically.
        </p>
      )}
    </div>
  );
}
