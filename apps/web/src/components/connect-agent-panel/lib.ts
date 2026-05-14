// Scope the dismissal per workspace so a fresh workspace doesn't inherit a
// "verified" panel from another workspace on the same browser.
export function testDismissedKey(orgId: string): string {
  return `holo:agent-test-dismissed:${orgId}`;
}

export function mcpJsonConfig(mcpUrl: string, token: string): string {
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

export function curlVerify(mcpUrl: string, token: string): string {
  const t = token || '<YOUR_HOLO_TOKEN>';
  return [
    `curl -i ${mcpUrl} \\`,
    `  -H "Authorization: Bearer ${t}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`,
  ].join('\n');
}

export type CopyHandler = (text: string, key: string) => void;

export const CONFIG_TABS = [
  'Claude',
  'ChatGPT',
  'Gemini',
  'OpenAPI',
  'Custom MCP',
] as const;
export type Tab = (typeof CONFIG_TABS)[number];

export type ConnectMode = 'chat-bot' | 'agent';
export function modeStorageKey(orgId: string): string {
  return `holo:connect-mode:${orgId}`;
}
