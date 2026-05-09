import { InlineCode, Step } from '../snippet';

export function ChatGPTSetup({ mcpUrl, token }: { mcpUrl: string; token: string }) {
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
