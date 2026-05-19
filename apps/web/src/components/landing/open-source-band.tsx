import { ArrowRight, Eye, PlugZap, Puzzle } from 'lucide-react';

function IsoArchitecture() {
  return (
    <svg
      viewBox="0 0 520 480"
      width="100%"
      height="100%"
      className="mx-auto block max-w-[520px]"
      aria-hidden
    >
      <defs>
        <pattern
          id="iso-grid"
          width="40"
          height="23"
          patternUnits="userSpaceOnUse"
          patternTransform="translate(0 0)"
        >
          <path
            d="M 0 11.5 L 20 0 L 40 11.5 L 20 23 Z"
            fill="none"
            stroke="#1f1f24"
            strokeWidth="0.7"
          />
        </pattern>
        <linearGradient id="cube-face-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fafaf7" />
          <stop offset="100%" stopColor="#e4e4e7" />
        </linearGradient>
        <linearGradient id="cube-face-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a1a1aa" />
          <stop offset="100%" stopColor="#71717a" />
        </linearGradient>
        <linearGradient id="cube-face-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#71717a" />
          <stop offset="100%" stopColor="#3f3f46" />
        </linearGradient>
        <linearGradient id="cube-accent-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6c73ff" />
          <stop offset="100%" stopColor="#3f47ff" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="520" height="480" fill="url(#iso-grid)" opacity="0.6" />

      {[
        { x: 120, y: 360 },
        { x: 200, y: 380 },
        { x: 280, y: 380 },
        { x: 360, y: 360 },
      ].map((c, i) => (
        <g key={`tool-${i}`} transform={`translate(${c.x} ${c.y})`}>
          <polygon
            points="0,-20 35,0 0,20 -35,0"
            fill="#27272a"
            stroke="#3f3f46"
            strokeWidth="1"
          />
          <polygon
            points="-35,0 0,20 0,55 -35,35"
            fill="#1c1c1e"
            stroke="#3f3f46"
            strokeWidth="1"
          />
          <polygon
            points="35,0 0,20 0,55 35,35"
            fill="#141414"
            stroke="#3f3f46"
            strokeWidth="1"
          />
        </g>
      ))}

      <g transform="translate(260 200)">
        <polygon
          points="0,-70 70,-30 70,30 0,70 -70,30 -70,-30"
          fill="none"
          stroke="#3f47ff"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.4"
        />
        <polygon points="0,-50 75,-7 0,35 -75,-7" fill="url(#cube-accent-top)" />
        <polygon points="-75,-7 0,35 0,110 -75,68" fill="#252660" />
        <polygon points="75,-7 0,35 0,110 75,68" fill="#1a1c4a" />
        <text
          x="0"
          y="-12"
          textAnchor="middle"
          fill="#fff"
          fontFamily="JetBrains Mono"
          fontSize="10"
          fontWeight="600"
          letterSpacing="0.08em"
        >
          HOLO
        </text>
      </g>

      {[
        { x: 140, y: 80 },
        { x: 220, y: 60 },
        { x: 300, y: 60 },
        { x: 380, y: 80 },
      ].map((c, i) => (
        <g key={`agent-${i}`} transform={`translate(${c.x} ${c.y})`}>
          <polygon points="0,-18 32,0 0,18 -32,0" fill="url(#cube-face-top)" />
          <polygon points="-32,0 0,18 0,50 -32,32" fill="url(#cube-face-left)" />
          <polygon points="32,0 0,18 0,50 32,32" fill="url(#cube-face-right)" />
        </g>
      ))}

      <g stroke="#3f47ff" strokeWidth="1" fill="none" opacity="0.6" strokeDasharray="3 3">
        <path d="M 140 120 Q 200 160, 240 195" />
        <path d="M 220 100 Q 240 140, 250 195" />
        <path d="M 300 100 Q 280 140, 270 195" />
        <path d="M 380 120 Q 320 160, 280 195" />
        <path d="M 240 295 Q 200 320, 130 360" />
        <path d="M 250 295 Q 230 340, 200 380" />
        <path d="M 270 295 Q 290 340, 280 380" />
        <path d="M 280 295 Q 330 320, 365 360" />
      </g>
    </svg>
  );
}

type Feature = {
  eyebrow: string;
  title: string;
  body: string;
  Icon: typeof PlugZap;
};

const FEATURES: Feature[] = [
  {
    eyebrow: 'APIs',
    title: 'MCP + REST + OpenAPI.',
    body: 'Same backend, three transports. Every callable tool is reachable from any agent runtime.',
    Icon: PlugZap,
  },
  {
    eyebrow: 'Transparent',
    title: 'Benchmarks in the repo.',
    body: 'We publish reproducible numbers, not marketing tiles. Every retrieval call is logged and replayable.',
    Icon: Eye,
  },
  {
    eyebrow: 'Modular',
    title: 'Connectors are pluggable.',
    body: 'A 90-line interface. 20 connectors today. Ship your own without forking — the kernel stays small.',
    Icon: Puzzle,
  },
];

export function OpenSourceBand() {
  return (
    <section
      id="open-source"
      className="border-b border-[#1f1f24]"
      style={{ background: '#050507', color: '#fafaf7' }}
    >
      <div className="mx-auto grid max-w-[1280px] items-center gap-20 px-8 py-30 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p
            className="caption"
            style={{ color: '#71717a' }}
          >
            Open source · AGPL-3.0
          </p>
          <h2
            className="mt-3.5 font-display font-semibold"
            style={{
              color: '#fafaf7',
              fontSize: 'clamp(40px, 4.6vw, 64px)',
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              textWrap: 'balance',
            }}
          >
            Self-host. Inspect. Extend.
          </h2>
          <p
            className="mt-5 max-w-[440px] text-[15px] leading-[1.6]"
            style={{ color: '#a1a1aa' }}
          >
            Deploy holo on your own infrastructure. Read the source. Submit a connector. The
            community edition ships every primitive — and there is no closed core.
          </p>

          <div className="mt-9 grid">
            {FEATURES.map((f, i) => (
              <div
                key={f.eyebrow}
                className="grid gap-4 py-5"
                style={{
                  gridTemplateColumns: '40px 1fr',
                  borderBottom: i < FEATURES.length - 1 ? '1px solid #1f1f24' : undefined,
                }}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-md"
                  style={{
                    background: '#0d0d0f',
                    border: '1px solid #1f1f24',
                    color: '#a1a1aa',
                  }}
                >
                  <f.Icon className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <p className="caption" style={{ color: '#71717a' }}>
                    {f.eyebrow}
                  </p>
                  <p
                    className="mt-1 font-display text-[17px] font-semibold"
                    style={{ color: '#fafaf7', letterSpacing: '-0.01em' }}
                  >
                    {f.title}
                  </p>
                  <p className="mt-1 text-[13.5px] leading-5" style={{ color: '#a1a1aa' }}>
                    {f.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="https://github.com/maakle/holo#readme"
              className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-[13px] font-medium transition-opacity hover:opacity-90"
              style={{ background: '#fafaf7', color: '#0a0a0a' }}
            >
              Self-host guide
              <ArrowRight className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>

        <div>
          <IsoArchitecture />
        </div>
      </div>
    </section>
  );
}
