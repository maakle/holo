/**
 * Per-connector wizard step definitions. Each connector's "Connect" button
 * opens the generic <ConnectionWizard> driven by the config registered here.
 *
 * Patterns:
 * - OAuth-only:        [oauthInstall, firstSync]
 * - API-key-only:      [apiKey,       firstSync]
 * - Multi-step (Slack): [oauthInstall, channels, invite, firstSync]
 *
 * Add a new connector:
 *   1. Register it in apps/web/src/lib/connector-registry.ts.
 *   2. Add a config below.
 *   3. Done — the row picks it up automatically via the connect button.
 *
 * See ./README.md for details.
 */
import type { ConnectorMeta } from '@/lib/connector-registry';
import type { ConnectorWizardConfig } from './types';
import { oauthInstallStep } from './steps/oauth-install-step';
import { apiKeyStep } from './steps/api-key-step';
import { firstSyncStep } from './steps/first-sync-step';
import {
  slackChannelsStep,
  slackChannelsInitialState,
  type SlackChannelsState,
} from './steps/slack-channels-step';
import { slackInviteStep } from './steps/slack-invite-step';

const slackConfig: ConnectorWizardConfig<SlackChannelsState> = {
  initialState: slackChannelsInitialState,
  steps: [
    {
      id: 'install',
      label: 'Install',
      render: (ctx) =>
        oauthInstallStep(ctx, {
          installButtonLabel: 'Install Slack app',
          permissions: [
            'Read messages from channels you select (no DMs)',
            'Auto-join public channels you pick so we can index them',
            'Disconnect any time from this page',
          ],
        }),
    },
    { id: 'channels', label: 'Pick channels', render: slackChannelsStep },
    { id: 'invite', label: 'Invite bot', render: slackInviteStep },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const githubConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'install',
      label: 'Install app',
      render: (ctx) =>
        oauthInstallStep(ctx, {
          installButtonLabel: 'Install GitHub app',
          permissions: [
            'Read code, pull requests, issues, and markdown docs',
            'Repository access scoped via GitHub’s "Select repositories" UI',
            'Webhooks for incremental updates so we don’t over-fetch',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const grainConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'install',
      label: 'Authorize',
      render: (ctx) =>
        oauthInstallStep(ctx, {
          installButtonLabel: 'Authorize Grain',
          permissions: [
            'Read meeting recordings + transcripts',
            'Read participant + summary metadata',
            'Disconnect any time from this page',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const hubspotConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'install',
      label: 'Authorize',
      render: (ctx) =>
        oauthInstallStep(ctx, {
          installButtonLabel: 'Authorize HubSpot',
          permissions: [
            'Read CRM contacts, deals, companies',
            'Read engagement timelines (calls, emails, notes)',
            'Disconnect any time from this page',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const notionConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'API key',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'Notion integration token (secret_…)',
          helpText:
            'Notion integrations are read-only and only see pages you explicitly share with them — Holo cannot read your full workspace.',
          helpUrl: 'https://www.notion.so/profile/integrations',
          instructions: [
            'Open notion.so/profile/integrations and click "New integration". Name it "Holo". Under Connection capabilities, enable only "Read content" — uncheck "Insert content" and "Update content".',
            'Copy the Internal Integration Token (starts with secret_ or ntn_) and paste it below.',
            'Open the integration → "Access to content" tab → "Edit access" → tick the top-level pages you want indexed (use "Select all" under Shared / Private to grant everything at once). Sub-pages are included automatically.',
          ],
          permissions: [
            'Read pages and databases you share with the integration',
            'No write, comment, or user-management access',
            'Disconnect any time from this page',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const pylonConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'API key',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'Pylon API key',
          helpText: 'Create an API key in Pylon (Settings → API) and paste it here.',
          helpUrl: 'https://app.usepylon.com/settings/api-keys',
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

// Registry holds heterogeneous configs (each connector has its own state
// shape). Consumers don't introspect the state from the outside — they hand
// the config to <ConnectionWizard> which threads the type through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<ConnectorMeta['id'], ConnectorWizardConfig<any>> = {
  slack: slackConfig,
  github: githubConfig,
  grain: grainConfig,
  hubspot: hubspotConfig,
  notion: notionConfig,
  pylon: pylonConfig,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getWizardConfig(id: ConnectorMeta['id']): ConnectorWizardConfig<any> {
  return REGISTRY[id];
}
