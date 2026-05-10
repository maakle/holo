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
import { serviceAccountStep } from './steps/service-account-step';
import { firstSyncStep } from './steps/first-sync-step';
// Imported from @holo/sync-providers (client-safe constants module) rather
// than @holo/connectors — the connectors barrel pulls the chunker package,
// which transitively requires tree-sitter (a native node module) and breaks
// the browser bundle. The two locations share the same source-of-truth.
import { GOOGLEDRIVE_SCOPES, GOOGLE_CHAT_SCOPES } from '@holo/sync-providers';
import {
  slackChannelsStep,
  slackChannelsInitialState,
  type SlackChannelsState,
} from './steps/slack-channels-step';
import { slackInviteStep } from './steps/slack-invite-step';
import {
  gitlabProjectsStep,
  gitlabProjectsInitialState,
  type GitlabProjectsState,
} from './steps/gitlab-projects-step';

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

const gitlabConfig: ConnectorWizardConfig<GitlabProjectsState> = {
  initialState: gitlabProjectsInitialState,
  steps: [
    {
      id: 'install',
      label: 'Authorize',
      render: (ctx) =>
        oauthInstallStep(ctx, {
          installButtonLabel: 'Authorize GitLab',
        }),
    },
    { id: 'projects', label: 'Pick projects', render: gitlabProjectsStep },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const grainConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'Token',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'Grain Workspace Access Token (or PAT for testing)',
          helpText:
            "A Workspace Access Token grants Holo read access to every recording in your Grain workspace — that's what you want for full coverage. A Personal Access Token works too (identical wire format) but only sees recordings the issuing user has access to, so use it for testing only.",
          helpUrl: 'https://grain.com/app/settings/integrations?tab=api',
          instructions: [
            'Open grain.com → Settings → Integrations → API. (The "Where do I find this?" link below jumps straight there.)',
            'Generate a Workspace Access Token (recommended). Only Grain workspace admins can create one. For testing, a Personal Access Token works the same way but only sees your own meetings.',
            'Copy the token and paste it below. Holo validates it by listing recordings before saving.',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const googleDriveConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'install',
      label: 'Service account',
      render: (ctx) =>
        serviceAccountStep(ctx, {
          scopes: GOOGLEDRIVE_SCOPES,
          impersonationHint: 'admin@yourcompany.com',
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const linearConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'install',
      label: 'Authorize',
      render: (ctx) =>
        oauthInstallStep(ctx, {
          installButtonLabel: 'Authorize Linear',
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
            "Add the scopes below (use the copy buttons to paste each into HubSpot's scope picker).",
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

const mintlifyConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'Docs URL',
      render: (ctx) =>
        apiKeyStep(ctx, {
          kind: 'url',
          placeholder: 'https://docs.example.com',
          helpText:
            'Paste the root URL of any Mintlify-hosted docs site. Holo ingests pages via the auto-published /llms.txt index and pulls the OpenAPI reference if one is available.',
          instructions: [
            'Find the docs site root, e.g. https://docs.kombo.dev or https://docs.linear.app.',
            'Paste it below — no API key needed (Mintlify docs are public).',
            'Connect again later to add more docs sites; each one syncs independently.',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const airtableConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'Personal access token',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'Airtable personal access token (pat…)',
          helpText:
            'Personal access tokens are scoped to a specific list of bases. Holo only sees what you grant the token in Airtable.',
          helpUrl: 'https://airtable.com/create/tokens',
          instructions: [
            'Open airtable.com/create/tokens and click "Create new token". Name it "Holo".',
            "Add the scopes below (use the copy buttons to paste each into Airtable's scope picker).",
            'Under Access, grant the token access to the bases you want Holo to ingest, then copy the token and paste it below.',
          ],
          scopes: {
            required: ['data.records:read', 'schema.bases:read', 'user.email:read'],
          },
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const googleChatConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'install',
      label: 'Service account',
      render: (ctx) =>
        serviceAccountStep(ctx, {
          scopes: GOOGLE_CHAT_SCOPES,
          impersonationHint: 'admin@yourcompany.com',
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const zendeskConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'Help center URL',
      render: (ctx) =>
        apiKeyStep(ctx, {
          kind: 'url',
          placeholder: 'https://help.example.com',
          helpText:
            'Paste the root URL of any public Zendesk help center. Holo ingests articles via Zendesk’s public Help Center API — no API token needed for public help centers.',
          instructions: [
            'Find the help-center root, e.g. https://help.kombo.dev or https://kombo.zendesk.com.',
            'Paste it below — the path (/hc/en-us, /...) is ignored, just the host.',
            'Connect again later to add more help centers; each one syncs independently.',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

// Registry holds heterogeneous configs (each connector has its own state
// shape). Consumers don't introspect the state from the outside — they hand
// the config to <ConnectionWizard> which threads the type through.
//
// Partial: connectors marked `implemented: false` in the registry (the
// "coming soon" tiles surfaced from docs/ROADMAP.md) deliberately have no
// wizard config. The connector row renders them with a "Coming soon" badge
// and no Connect button, so getWizardConfig is never called for them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Partial<Record<ConnectorMeta['id'], ConnectorWizardConfig<any>>> = {
  slack: slackConfig,
  github: githubConfig,
  gitlab: gitlabConfig,
  grain: grainConfig,
  hubspot: hubspotConfig,
  notion: notionConfig,
  pylon: pylonConfig,
  linear: linearConfig,
  mintlify: mintlifyConfig,
  zendesk: zendeskConfig,
  googledrive: googleDriveConfig,
  airtable: airtableConfig,
  'google-chat': googleChatConfig,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getWizardConfig(id: ConnectorMeta['id']): ConnectorWizardConfig<any> | undefined {
  return REGISTRY[id];
}
