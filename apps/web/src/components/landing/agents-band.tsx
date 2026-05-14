const AGENTS = [
  { name: 'Claude' },
  { name: 'Cursor' },
  { name: 'Slack bot' },
  { name: 'ChatGPT' },
  { name: 'Gemini' },
];

function AgentItem({ name }: { name: string }) {
  return (
    <div className="inline-flex flex-shrink-0 items-baseline">
      <span
        className="font-display text-[20px] font-semibold text-text"
        style={{ letterSpacing: '-0.01em' }}
      >
        {name}
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
          <div className="flex w-max animate-marquee gap-14 pr-14">
            {AGENTS.map((a) => (
              <AgentItem key={a.name} {...a} />
            ))}
            {AGENTS.map((a) => (
              <AgentItem key={`${a.name}-dup`} {...a} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
