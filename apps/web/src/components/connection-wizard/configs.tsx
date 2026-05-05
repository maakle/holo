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
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const hubspotConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'Service Key',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'HubSpot Service Key',
          helpText:
            'Service Keys (beta) give Holo portal-wide read access without an OAuth dance. Generate one in your HubSpot developer account → Keys → Service Keys.',
          helpUrl:
            'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys',
          instructions: [
            'In HubSpot, open your developer account → Development → Keys → Service Keys (beta), then click "Create service key".',
            'Add the scopes below (use the copy buttons to paste each into HubSpot\'s scope picker).',
            'Copy the generated key and paste it below.',
          ],
          scopes: {
            required: [
              'crm.objects.contacts.read',
              'crm.objects.deals.read',
              'crm.objects.companies.read',
              'crm.objects.owners.read',
              'sales-email-read',
            ],
            optional: [
              'crm.objects.notes.read',
              'crm.objects.calls.read',
              'crm.objects.meetings.read',
              'crm.objects.tasks.read',
            ],
          },
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
          helpUrl: 'https://docs.usepylon.com/pylon-docs/developer/api',
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
