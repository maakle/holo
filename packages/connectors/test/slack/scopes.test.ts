import { describe, it, expect } from 'vitest';
import {
  hasSlackBotScopes,
  SLACK_BOT_SCOPES,
  SLACK_INGEST_SCOPES,
} from '../../src/slack';

describe('hasSlackBotScopes', () => {
  it('returns false for null/empty', () => {
    expect(hasSlackBotScopes(null)).toBe(false);
    expect(hasSlackBotScopes(undefined)).toBe(false);
    expect(hasSlackBotScopes('')).toBe(false);
  });

  it('returns false when only ingest scopes are present', () => {
    expect(hasSlackBotScopes(SLACK_INGEST_SCOPES.join(','))).toBe(false);
  });

  it('returns true when bot sentinel scope is present', () => {
    expect(hasSlackBotScopes('app_mentions:read,chat:write')).toBe(true);
  });

  it('returns true when full ingest+bot scope set is present', () => {
    expect(
      hasSlackBotScopes(
        [...SLACK_INGEST_SCOPES, ...SLACK_BOT_SCOPES].join(','),
      ),
    ).toBe(true);
  });

  it('tolerates whitespace around commas', () => {
    expect(hasSlackBotScopes('chat:write,  app_mentions:read , im:write')).toBe(true);
  });

  it('returns false when chat:write is present but mentions are not', () => {
    // chat:write alone is not enough — we use app_mentions:read as the
    // sentinel because chat:write can be granted to a non-interactive
    // notification bot. Mentions imply the full bot install.
    expect(hasSlackBotScopes('chat:write,users:read')).toBe(false);
  });
});
