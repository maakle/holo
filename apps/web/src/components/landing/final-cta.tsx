import { GithubMark } from '@/components/landing/brand-marks';
import { TrackedLink } from '@/components/landing/tracked-link';

const GITHUB_URL = 'https://github.com/maakle/holo';

export function FinalCTA({
  isAuthed,
  installCommand,
}: {
  isAuthed: boolean;
  installCommand: string;
}) {
  const QUICKSTART = `# 1. install & boot
${installCommand}

# 2. connect a tool
open http://localhost:3000

# 3. point your agent
export MCP_URL=http://localhost:3000/mcp`;
  return (
    <section
      id="start"
      className="relative overflow-hidden border-b border-border"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, var(--border) 0, var(--border) 1px, transparent 1px, transparent 14px)',
          WebkitMaskImage: 'linear-gradient(to top right, black 0%, transparent 70%)',
          maskImage: 'linear-gradient(to top right, black 0%, transparent 70%)',
        }}
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-[1280px] items-center gap-16 px-8 py-30 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="caption text-text-subtle">Start your context layer</p>
          <h2
            className="mt-3.5 font-display font-semibold text-text"
            style={{
              fontSize: 'clamp(40px, 5vw, 72px)',
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              textWrap: 'balance',
            }}
          >
            One brain. Every agent. Self-hostable.
          </h2>
          <p className="mt-5 max-w-[480px] text-[16px] leading-[1.55] text-text-muted">
            The shared context layer that makes your agents coherent. Star the repo, run it
            locally, or sign in.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <TrackedLink
              href={isAuthed ? '/dashboard' : '/sign-in'}
              event="cta"
              location="final"
              isAuthed={isAuthed}
              className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              {isAuthed ? 'Open dashboard' : 'Get started'}
            </TrackedLink>
            <TrackedLink
              href={GITHUB_URL}
              external
              event="github"
              location="final"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 text-[14px] font-medium text-text transition-colors hover:border-border-strong"
            >
              <GithubMark className="h-4 w-4" />
              View on GitHub
            </TrackedLink>
          </div>
        </div>

        <div>
          <div className="overflow-hidden rounded-lg border border-border bg-code-bg">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="font-mono text-[12px] text-text-subtle">quickstart.sh</span>
              <span className="ml-auto rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                shell
              </span>
            </div>
            <pre className="m-0 overflow-x-auto px-5 py-4.5 font-mono text-[13px] leading-[1.6] text-text">
              <code>{QUICKSTART}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
