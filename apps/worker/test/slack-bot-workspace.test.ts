import { describe, it, expect } from 'vitest';
import {
  pickCredentials,
  type CredentialRow,
} from '../src/slack-bot/workspace';

const D = (iso: string) => new Date(iso);

function row(opts: Partial<CredentialRow>): CredentialRow {
  return {
    accessToken: 'xoxb-default',
    slackAppConfigId: null,
    lastRefreshedAt: null,
    connectedAt: D('2025-01-01T00:00:00Z'),
    ...opts,
  };
}

describe('pickCredentials', () => {
  it('returns null when there are no usable rows', () => {
    expect(pickCredentials([], null)).toBeNull();
    expect(pickCredentials([row({ accessToken: null })], null)).toBeNull();
    expect(pickCredentials([row({ accessToken: '' })], null)).toBeNull();
  });

  it('picks the shared-app row when hint is null even if a custom-app row is newer', () => {
    // Reproduces the bug: workspace had both shared + custom installs and we
    // were posting Custom-Bot events with the shared-app token (or vice versa)
    // based purely on recency. Custom is newer here but the inbound event is
    // for the shared app — we must not cross the streams.
    const shared = row({
      accessToken: 'xoxb-shared',
      slackAppConfigId: null,
      lastRefreshedAt: D('2026-01-01T00:00:00Z'),
    });
    const custom = row({
      accessToken: 'xoxb-custom',
      slackAppConfigId: 'cfg-1',
      lastRefreshedAt: D('2026-05-01T00:00:00Z'),
    });
    expect(pickCredentials([shared, custom], null)).toBe('xoxb-shared');
  });

  it('picks the custom-app row when hint matches its config id', () => {
    const shared = row({
      accessToken: 'xoxb-shared',
      slackAppConfigId: null,
      lastRefreshedAt: D('2026-05-01T00:00:00Z'),
    });
    const custom = row({
      accessToken: 'xoxb-custom',
      slackAppConfigId: 'cfg-1',
      lastRefreshedAt: D('2026-01-01T00:00:00Z'),
    });
    expect(pickCredentials([shared, custom], 'cfg-1')).toBe('xoxb-custom');
  });

  it('returns null when hint asks for a config id no row has', () => {
    // Fail closed — never post with the wrong app's token just because some
    // row matched the org. The user sees no reply (which is observable) rather
    // than a reply from the wrong bot (which is confusing).
    const rows = [
      row({ accessToken: 'xoxb-shared', slackAppConfigId: null }),
      row({ accessToken: 'xoxb-other', slackAppConfigId: 'cfg-2' }),
    ];
    expect(pickCredentials(rows, 'cfg-1')).toBeNull();
  });

  it('falls back to recency when there is no hint (legacy in-flight job)', () => {
    const older = row({
      accessToken: 'xoxb-older',
      lastRefreshedAt: D('2026-01-01T00:00:00Z'),
    });
    const newer = row({
      accessToken: 'xoxb-newer',
      lastRefreshedAt: D('2026-05-01T00:00:00Z'),
    });
    expect(pickCredentials([older, newer], undefined)).toBe('xoxb-newer');
  });

  it('within a matching set, prefers the most recently refreshed row', () => {
    // Two humans each installed the custom app under their own user id — same
    // slackAppConfigId, two credential rows. Pick the fresher one in case the
    // older one's token has been rotated out.
    const a = row({
      accessToken: 'xoxb-userA',
      slackAppConfigId: 'cfg-1',
      lastRefreshedAt: D('2026-01-01T00:00:00Z'),
    });
    const b = row({
      accessToken: 'xoxb-userB',
      slackAppConfigId: 'cfg-1',
      lastRefreshedAt: D('2026-05-01T00:00:00Z'),
    });
    expect(pickCredentials([a, b], 'cfg-1')).toBe('xoxb-userB');
  });

  it('falls back to connectedAt when lastRefreshedAt is null', () => {
    const older = row({
      accessToken: 'xoxb-older',
      lastRefreshedAt: null,
      connectedAt: D('2026-01-01T00:00:00Z'),
    });
    const newer = row({
      accessToken: 'xoxb-newer',
      lastRefreshedAt: null,
      connectedAt: D('2026-05-01T00:00:00Z'),
    });
    expect(pickCredentials([older, newer], null)).toBe('xoxb-newer');
  });
});
