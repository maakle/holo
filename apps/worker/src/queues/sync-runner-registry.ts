import { holoError, ErrorCode } from '@holo/errors';
import type { SyncRunner } from './sync-dispatch';

// Each queue owns one SyncRunner. Connector packages currently expose stubs
// (Phase 8 fullSync/incrementalSync throw HOLO_CONNECTOR_NOT_IMPLEMENTED), so
// this registry returns NOT_IMPLEMENTED runners by default. When a connector
// lands, replace the relevant entry with a real wiring (load tokens, call
// createXConnector(), invoke fullSync/incrementalSync).
//
// Tests inject their own runners via setSyncRunner() to exercise dispatch.

// Startup gate. BullMQ workers are constructed (and start pulling jobs from
// Redis) during Nest's onModuleInit, but SyncRunnersBootstrap doesn't replace
// the stubs with real runners until onApplicationBootstrap — a few hundred ms
// later. Without this gate, any sync job already in Redis at restart races
// the bootstrap and gets dispatched against the stub, failing with
// HOLO_CONNECTOR_NOT_IMPLEMENTED. Processors await registrationReady() before
// looking up a runner; bootstrap resolves it once every setSyncRunner call
// has run.
let resolveReady: (() => void) | null = null;
const registrationReady: Promise<void> = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export function markRegistrationComplete(): void {
  resolveReady?.();
  resolveReady = null;
}

export function awaitRegistrationReady(): Promise<void> {
  return registrationReady;
}

// Test seam: tests that call SyncProcessorBase.process() directly don't run
// the bootstrap, so they open the gate themselves. Tests that exercise
// runSyncJob() lower-level don't touch the gate at all.
export function __markReadyForTests(): void {
  markRegistrationComplete();
}

const stubRunner = (label: string): SyncRunner => {
  const fail = async (): Promise<never> => {
    throw holoError({
      code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
      problem: `${label} connector sync is not yet wired into the worker`,
      fix: 'Implement the connector and replace the stub via setSyncRunner().',
    });
  };
  return { full: fail, incremental: fail, codeInitial: fail, codeIncremental: fail };
};

const registry: Record<string, SyncRunner> = {
  'github-code-sync': stubRunner('github-code'),
  'github-prose-sync': stubRunner('github-prose'),
  'gitlab-code-sync': stubRunner('gitlab-code'),
  'gitlab-prose-sync': stubRunner('gitlab-prose'),
  'slack-sync': stubRunner('slack'),
  'notion-sync': stubRunner('notion'),
  'grain-sync': stubRunner('grain'),
  'pylon-sync': stubRunner('pylon'),
  'hubspot-sync': stubRunner('hubspot'),
  'linear-sync': stubRunner('linear'),
  'mintlify-sync': stubRunner('mintlify'),
  'prismic-sync': stubRunner('prismic'),
  'zendesk-sync': stubRunner('zendesk'),
  'webcrawl-sync': stubRunner('webcrawl'),
  'googledrive-sync': stubRunner('googledrive'),
  'airtable-sync': stubRunner('airtable'),
  'stripe-sync': stubRunner('stripe'),
};

export function getSyncRunner(queue: string): SyncRunner {
  const runner = registry[queue];
  if (!runner) {
    throw holoError({
      code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
      problem: `No SyncRunner registered for queue ${queue}`,
      fix: 'Register a runner via setSyncRunner() during worker bootstrap.',
    });
  }
  return runner;
}

export function setSyncRunner(queue: string, runner: SyncRunner): void {
  registry[queue] = runner;
}
