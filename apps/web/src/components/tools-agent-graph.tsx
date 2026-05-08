import Image from 'next/image';
import { Logo } from '@/components/logo';

const TOOLS = [
  { id: 'slack', label: 'slack', src: '/connectors/slack.webp' },
  { id: 'github', label: 'github', src: '/connectors/github.webp' },
  { id: 'notion', label: 'notion', src: '/connectors/notion.webp' },
  { id: 'grain', label: 'grain', src: '/connectors/grain.webp' },
  { id: 'pylon', label: 'pylon', src: '/connectors/usepylon.webp' },
  { id: 'hubspot', label: 'hubspot', src: '/connectors/hubspot.webp' },
  { id: 'linear', label: 'linear', src: '/connectors/linear.webp' },
] as const;

const AGENTS = [
  { label: 'Claude' },
  { label: 'ChatGPT' },
  { label: 'Slack agent' },
  { label: 'Your custom agent' },
] as const;

const CAPABILITIES = [
  'Security',
  'Rate limits',
  'Scoped access',
  'Audit logging',
  'Observability',
  'Agent runtime',
] as const;

// Fixed-size canvas on desktop. Mobile gets a stacked fallback.
const W = 960;
const H = 560;
const TOOL_X = 64; // right edge of each tool tile (line anchor)
const TOOL_TILE = 44;
const TOOL_GAP = 22;
const TOOL_BLOCK_H = TOOLS.length * TOOL_TILE + (TOOLS.length - 1) * TOOL_GAP;
const TOOL_TOP = (H - TOOL_BLOCK_H) / 2;
const HOLO_CX = W / 2;
const HOLO_CY = H / 2;
const HOLO_W = 280;
const HOLO_H = 280;
const AGENT_W = 240;
const AGENT_X = W - AGENT_W; // left edge of agent panel
const AGENT_CY = HOLO_CY;

function toolCenterY(index: number) {
  return TOOL_TOP + index * (TOOL_TILE + TOOL_GAP) + TOOL_TILE / 2;
}

export function ToolsAgentGraph() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="caption text-text-subtle">How it fits together</p>
          <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
            Your tools in. Any agent out.
          </h2>
          <p className="mx-auto mt-4 max-w-[600px] text-balance text-[15px] leading-6 text-text-muted">
            Holo ingests from the systems your team already runs and exposes one
            scope-aware context layer over MCP and OpenAPI. Bring whichever agent
            you like — same data, same procedures.
          </p>
        </div>

        {/* Desktop graph */}
        <div className="mt-10 hidden md:flex md:justify-center">
          <DesktopGraph />
        </div>

        {/* Mobile fallback */}
        <div className="mt-12 grid gap-6 md:hidden">
          <div className="rounded-md border border-border bg-surface p-5">
            <p className="caption text-text-subtle">Sources</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {TOOLS.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5"
                >
                  <Image src={t.src} alt="" width={16} height={16} aria-hidden />
                  <span className="font-mono text-[12px] text-text-muted">{t.label}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-border bg-surface p-5">
            <div className="text-center">
              <div className="mx-auto h-10 w-10">
                <Logo />
              </div>
              <p className="mt-3 font-display text-[16px] font-semibold tracking-tight">holo</p>
              <p className="mt-1 text-[12px] text-text-subtle">context layer</p>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-1.5">
              {CAPABILITIES.map((c) => (
                <li
                  key={c}
                  className="rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-center text-[11px] leading-none text-text-muted"
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-border bg-surface p-5">
            <p className="caption text-text-subtle">Your agent</p>
            <ul className="mt-4 space-y-2">
              {AGENTS.map((a) => (
                <li
                  key={a.label}
                  className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2 text-[13px] text-text"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                  {a.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function DesktopGraph() {
  const holoLeft = HOLO_CX - HOLO_W / 2;
  const holoRight = HOLO_CX + HOLO_W / 2;

  return (
    <div
      className="relative w-full"
      style={{ maxWidth: W, aspectRatio: `${W} / ${H}` }}
    >
      {/* Inner absolute layer matches our fixed-coordinate space */}
      <div className="absolute inset-0">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {TOOLS.map((_, i) => {
            const y = toolCenterY(i);
            const targetY =
              HOLO_CY + (i - (TOOLS.length - 1) / 2) * (HOLO_H / (TOOLS.length + 1));
            const c1x = TOOL_X + (holoLeft - TOOL_X) * 0.5;
            const c2x = TOOL_X + (holoLeft - TOOL_X) * 0.5;
            return (
              <path
                key={i}
                d={`M ${TOOL_X} ${y} C ${c1x} ${y}, ${c2x} ${targetY}, ${holoLeft} ${targetY}`}
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <line
            x1={holoRight}
            y1={HOLO_CY}
            x2={AGENT_X - 8}
            y2={HOLO_CY}
            stroke="var(--text-subtle)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={`${AGENT_X - 14},${HOLO_CY - 5} ${AGENT_X - 6},${HOLO_CY} ${AGENT_X - 14},${HOLO_CY + 5}`}
            fill="none"
            stroke="var(--text-subtle)"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {TOOLS.map((t, i) => (
          <div
            key={t.id}
            className="absolute flex items-center justify-center rounded-md border border-border bg-surface"
            style={{
              left: pctX(TOOL_X - TOOL_TILE),
              top: pctY(toolCenterY(i) - TOOL_TILE / 2),
              width: pctX(TOOL_TILE),
              height: pctY(TOOL_TILE),
            }}
          >
            <Image
              src={t.src}
              alt=""
              width={24}
              height={24}
              className="h-[55%] w-[55%] object-contain"
              aria-hidden
            />
          </div>
        ))}

        {/* Holo node */}
        <div
          className="absolute rounded-lg border border-border bg-surface"
          style={{
            left: pctX(HOLO_CX - HOLO_W / 2),
            top: pctY(HOLO_CY - HOLO_H / 2),
            width: pctX(HOLO_W),
            height: pctY(HOLO_H),
          }}
        >
          <CornerTicks />
          <div className="absolute inset-0 flex flex-col items-center px-5 py-6">
            <div className="h-10 w-10">
              <Logo />
            </div>
            <span className="mt-2 font-display text-[15px] font-semibold tracking-tight text-text">
              holo
            </span>
            <span className="caption mt-1 text-text-subtle">context layer</span>
            <div className="my-4 h-px w-full bg-border" aria-hidden />
            <ul className="grid w-full grid-cols-2 gap-1.5">
              {CAPABILITIES.map((c) => (
                <li
                  key={c}
                  className="rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-center text-[11px] leading-none text-text-muted"
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Agent panel */}
        <div
          className="absolute"
          style={{
            left: pctX(AGENT_X),
            top: pctY(AGENT_CY),
            width: pctX(AGENT_W),
            transform: 'translateY(-50%)',
          }}
        >
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-text">Your agent</span>
              <span className="flex gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
                <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
                <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
              </span>
            </div>
            <div className="mt-3 rounded-sm border border-accent/40 bg-accent/[0.06] px-2.5 py-1.5 font-mono text-[12px] text-text">
              context.search()
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {AGENTS.map((a) => (
              <li
                key={a.label}
                className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                {a.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function pctX(x: number) {
  return `${(x / W) * 100}%`;
}
function pctY(y: number) {
  return `${(y / H) * 100}%`;
}

function CornerTicks() {
  const common = 'absolute h-2 w-2 border-text-subtle';
  return (
    <>
      <span className={`${common} left-[-1px] top-[-1px] border-l border-t`} aria-hidden />
      <span className={`${common} right-[-1px] top-[-1px] border-r border-t`} aria-hidden />
      <span className={`${common} bottom-[-1px] left-[-1px] border-b border-l`} aria-hidden />
      <span className={`${common} bottom-[-1px] right-[-1px] border-b border-r`} aria-hidden />
    </>
  );
}
