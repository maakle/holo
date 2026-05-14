import { headers } from 'next/headers';
import { getServerAuth, getServerContext } from '@/lib/server-context';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingHero } from '@/components/landing/landing-hero';
import { AgentsBand } from '@/components/landing/agents-band';
import { PlatformBand } from '@/components/landing/platform-band';
import { BenchmarksBand } from '@/components/landing/benchmarks-band';
import { ConnectorsBand } from '@/components/landing/connectors-band';
import { OpenSourceBand } from '@/components/landing/open-source-band';
import { UseCasesBand } from '@/components/landing/use-cases-band';
import { ObservabilityBand } from '@/components/landing/observability-band';
import { SecurityBand } from '@/components/landing/security-band';
import { FinalCTA } from '@/components/landing/final-cta';
import { LandingFooter } from '@/components/landing/landing-footer';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const auth = await getServerAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const isAuthed = !!session;

  const { env } = await getServerContext();
  const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
  const installCommand = `curl -fsSL ${publicOrigin}/install.sh | bash`;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <LandingHeader isAuthed={isAuthed} />
      <LandingHero isAuthed={isAuthed} installCommand={installCommand} />
      <AgentsBand />
      <PlatformBand />
      <BenchmarksBand />
      <ConnectorsBand />
      <OpenSourceBand />
      <UseCasesBand />
      <ObservabilityBand />
      <SecurityBand />
      <FinalCTA isAuthed={isAuthed} installCommand={installCommand} />
      <LandingFooter />
    </div>
  );
}
