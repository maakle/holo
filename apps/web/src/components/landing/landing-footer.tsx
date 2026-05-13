import Link from 'next/link';
import { HoloLogo } from '@/components/logo';
import { GithubMark, LinkedinMark, TwitterMark } from '@/components/landing/brand-marks';
import type { ReactElement, SVGProps } from 'react';

const GITHUB_URL = 'https://github.com/maakle/holo';

const FOOTER_GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Connectors', href: '#connectors' },
      { label: 'MCP gateway', href: '#platform' },
      { label: 'Procedures', href: '#platform' },
      { label: 'Observability', href: '#observability' },
      { label: 'Security', href: '#security' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'Sales enablement', href: '#use-cases' },
      { label: 'Customer support', href: '#use-cases' },
      { label: 'Security reviews', href: '#use-cases' },
      { label: 'Company search', href: '#use-cases' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Docs', href: `${GITHUB_URL}#readme` },
      { label: 'Benchmarks', href: `${GITHUB_URL}/blob/main/docs/BENCHMARKS.md` },
      { label: 'Roadmap', href: `${GITHUB_URL}/blob/main/docs/ROADMAP.md` },
      { label: 'Architecture', href: `${GITHUB_URL}/blob/main/docs/ARCHITECTURE.md` },
    ],
  },
  {
    title: 'Compare',
    links: [
      { label: 'vs Glean', href: '#' },
      { label: 'vs Onyx', href: '#' },
      { label: 'vs Dust', href: '#' },
      { label: 'vs PipesHub', href: '#' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: GITHUB_URL },
      { label: 'Contact', href: `${GITHUB_URL}/discussions` },
      { label: 'Licensing', href: `${GITHUB_URL}/blob/main/LICENSING.md` },
    ],
  },
];

const SOCIALS: {
  Icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
  href: string;
  label: string;
}[] = [
  { Icon: GithubMark, href: GITHUB_URL, label: 'GitHub' },
  { Icon: TwitterMark, href: '#', label: 'Twitter' },
  { Icon: LinkedinMark, href: '#', label: 'LinkedIn' },
];

export function LandingFooter() {
  return (
    <footer className="bg-bg">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-8 pb-8 pt-16 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(5,1fr)]">
        <div>
          <Link href="/" aria-label="holo home" className="text-text">
            <HoloLogo wordmarkClassName="text-[20px]" logoClassName="h-6 w-6" />
          </Link>
          <p className="mt-3.5 max-w-[280px] text-[13px] leading-[1.55] text-text-muted">
            The agent context layer. Open source · MIT · self-hostable.
          </p>
          <div className="mt-4.5 flex gap-2.5">
            {SOCIALS.map(({ Icon, href, label }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text"
              >
                <Icon className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        </div>
        {FOOTER_GROUPS.map((g) => (
          <div key={g.title}>
            <p className="caption text-text-subtle">{g.title}</p>
            <ul className="mt-3.5 flex flex-col gap-2.5">
              {g.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="text-[13px] text-text-muted transition-colors hover:text-text"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-8 py-5">
          <p className="text-[12px] text-text-subtle">
            © {new Date().getFullYear()} holo · Community Edition · MIT
          </p>
          <p className="inline-flex items-center gap-2 text-[12px] text-text-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            All systems normal
          </p>
        </div>
      </div>
    </footer>
  );
}
