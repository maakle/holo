import { describe, it, expect } from 'vitest';
import {
  buildSlackManifest,
  SLACK_BOT_SCOPES,
  SLACK_INGEST_SCOPES,
} from '../../src/slack';

const baseOpts = {
  displayName: 'Acme Holo Bot',
  oauthRedirectUrl: 'https://example.test/api/connectors/slack/callback',
  eventsRequestUrl: 'https://gw.example.test/slack/events/org-abc',
  slashCommandsUrl: 'https://gw.example.test/slack/commands/org-abc',
};

describe('buildSlackManifest', () => {
  it('includes every scope from SLACK_INGEST_SCOPES + SLACK_BOT_SCOPES', () => {
    const yaml = buildSlackManifest(baseOpts);
    // Guards against future scope additions silently drifting from the
    // manifest — if you add to SLACK_BOT_SCOPES, this test fails until the
    // builder picks it up automatically (which it does via spread).
    for (const scope of [...SLACK_INGEST_SCOPES, ...SLACK_BOT_SCOPES]) {
      expect(yaml).toContain(`      - ${scope}`);
    }
  });

  it('interpolates the URLs verbatim', () => {
    const yaml = buildSlackManifest(baseOpts);
    expect(yaml).toContain(`- ${baseOpts.oauthRedirectUrl}`);
    expect(yaml).toContain(`request_url: ${baseOpts.eventsRequestUrl}`);
    expect(yaml).toContain(`url: ${baseOpts.slashCommandsUrl}`);
  });

  it('defaults the slash command to /holo and honors overrides', () => {
    expect(buildSlackManifest(baseOpts)).toContain('command: /holo');
    expect(
      buildSlackManifest({ ...baseOpts, slashCommand: '/acme' }),
    ).toContain('command: /acme');
  });

  it('uses displayName for both the app name and the bot user', () => {
    const yaml = buildSlackManifest(baseOpts);
    expect(yaml).toContain(`name: ${baseOpts.displayName}`);
    expect(yaml).toContain(`display_name: ${baseOpts.displayName}`);
  });

  it('subscribes to the bot events the gateway actually handles', () => {
    // Mirrors apps/gateway/src/slack/events.ts — app_mention + message.im.
    const yaml = buildSlackManifest(baseOpts);
    expect(yaml).toContain('- app_mention');
    expect(yaml).toContain('- message.im');
  });

  it('enables the Messages tab so DMs to the bot work', () => {
    // Without features.app_home.messages_tab_enabled, Slack disables the DM
    // composer ("Sending messages to this app has been turned off") AND
    // silently drops message.im events — even though they're subscribed.
    const yaml = buildSlackManifest(baseOpts);
    expect(yaml).toContain('messages_tab_enabled: true');
    expect(yaml).toContain('messages_tab_read_only_enabled: false');
  });

  it('disables interactivity by default for back-compat', () => {
    // Existing installs that haven't enabled the interactivity URL would
    // otherwise see Slack reject their manifest re-import.
    const yaml = buildSlackManifest(baseOpts);
    expect(yaml).toContain('is_enabled: false');
    expect(yaml).not.toMatch(/interactivity:[^]*request_url:/);
  });

  it('enables interactivity and emits the request_url when interactivityUrl is provided', () => {
    // Required for the "Show sources" button on agent answers — without
    // request_url, Slack tells the user the app is not configured for
    // interactive responses.
    const interactivityUrl = 'https://gw.example.test/slack/interactivity/org-abc';
    const yaml = buildSlackManifest({ ...baseOpts, interactivityUrl });
    expect(yaml).toContain('is_enabled: true');
    expect(yaml).toContain(`request_url: ${interactivityUrl}`);
  });
});
