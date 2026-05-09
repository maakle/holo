import { type CopyHandler } from '../lib';
import { CopyIcon, InlineCode, Snippet, Step } from '../snippet';

export function OpenApiSetup({
  gatewayBase,
  token,
  copied,
  onCopy,
}: {
  gatewayBase: string;
  token: string;
  copied: string | null;
  onCopy: CopyHandler;
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
