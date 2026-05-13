import { headers } from 'next/headers';
import { getServerAuth } from '@/lib/server-context';
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

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <LandingHeader isAuthed={isAuthed} />
      <LandingHero isAuthed={isAuthed} />
      <AgentsBand />
      <PlatformBand />
      <BenchmarksBand />
      <ConnectorsBand />
      <OpenSourceBand />
      <UseCasesBand />
      <ObservabilityBand />
      <SecurityBand />
      <FinalCTA isAuthed={isAuthed} />
      <LandingFooter />
    </div>
  );
}
