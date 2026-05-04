import { holoError, ErrorCode } from '@holo/errors';
import type { SyncRunner } from './sync-dispatch';

// Each queue owns one SyncRunner. Connector packages currently expose stubs
// (Phase 8 fullSync/incrementalSync throw HOLO_CONNECTOR_NOT_IMPLEMENTED), so
// this registry returns NOT_IMPLEMENTED runners by default. When a connector
// lands, replace the relevant entry with a real wiring (load tokens, call
// createXConnector(), invoke fullSync/incrementalSync).
//
// Tests inject their own runners via setSyncRunner() to exercise dispatch.

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
  'slack-sync': stubRunner('slack'),
  'notion-sync': stubRunner('notion'),
  'grain-sync': stubRunner('grain'),
  'pylon-sync': stubRunner('pylon'),
  'hubspot-sync': stubRunner('hubspot'),
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
