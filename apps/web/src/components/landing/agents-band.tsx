const AGENTS = [
  { name: 'Claude', protocol: 'MCP' },
  { name: 'Cursor', protocol: 'MCP' },
  { name: 'Cline', protocol: 'MCP' },
  { name: 'ChatGPT', protocol: 'OpenAPI' },
  { name: 'Gemini', protocol: 'OpenAPI' },
  { name: 'n8n', protocol: 'REST' },
  { name: 'Continue', protocol: 'MCP' },
  { name: 'Aider', protocol: 'REST' },
  { name: 'Zed', protocol: 'MCP' },
  { name: 'Windsurf', protocol: 'MCP' },
];

function AgentItem({ name, protocol }: { name: string; protocol: string }) {
  return (
    <div className="inline-flex flex-shrink-0 items-baseline gap-2.5">
      <span
        className="font-display text-[20px] font-semibold text-text"
        style={{ letterSpacing: '-0.01em' }}
      >
        {name}
      </span>
      <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
        {protocol}
      </span>
    </div>
  );
}

export function AgentsBand() {
  const maskStyle = {
    WebkitMaskImage:
      'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
    maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
  };
  return (
    <section className="border-b border-border">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-12 px-8 py-10">
        <div className="max-w-[280px] flex-none">
          <p className="caption text-text-subtle">Bring your own agent</p>
          <p className="mt-1.5 text-[14px] leading-[1.5] text-text-muted">
            One backend. Every agent your team has tried.
          </p>
        </div>
        <div className="flex min-w-[280px] flex-1 overflow-hidden" style={maskStyle}>
          <div
            className="flex flex-shrink-0 gap-14 pr-14"
            style={{ animation: 'marquee 40s linear infinite' }}
          >
            {AGENTS.map((a) => (
              <AgentItem key={a.name} {...a} />
            ))}
          </div>
          <div
            aria-hidden
            className="flex flex-shrink-0 gap-14 pr-14"
            style={{ animation: 'marquee 40s linear infinite' }}
          >
            {AGENTS.map((a) => (
              <AgentItem key={`${a.name}-dup`} {...a} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
