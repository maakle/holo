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
import { jiraCredentialsStep } from './steps/jira-credentials-step';
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
import {
  googleChatSpacesStep,
  googleChatSpacesInitialState,
  type GoogleChatSpacesState,
} from './steps/google-chat-spaces-step';
import {
  googleDriveDrivesStep,
  googleDriveDrivesInitialState,
  type GoogleDriveDrivesState,
} from './steps/googledrive-drives-step';

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

const googleDriveConfig: ConnectorWizardConfig<GoogleDriveDrivesState> = {
  initialState: googleDriveDrivesInitialState,
  steps: [
    {
      id: 'install',
      label: 'Service account',
      render: (ctx) =>
        serviceAccountStep(ctx, {
          scopes: GOOGLEDRIVE_SCOPES,
          impersonationHint: 'holo@yourcompany.com',
          apiToEnable: { label: 'Google Drive API', host: 'drive.googleapis.com' },
        }),
    },
    {
      id: 'drives',
      label: 'Pick content',
      size: 'wide',
      render: googleDriveDrivesStep,
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

const linearConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'API key',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'Linear personal API key (lin_api_…)',
          helpText:
            'Personal API keys grant Holo read access to every issue, project, and team you can see in Linear. Connect from a workspace admin (or a service-style user with broad team access) to mirror the full workspace.',
          helpUrl: 'https://linear.app/settings/account/security',
          instructions: [
            'Open linear.app → Settings → Security & access → Personal API keys, then click "New API key".',
            'Label it "Holo" and create the key. Copy the lin_api_… value (you can\'t see it again after closing the dialog).',
            'Paste it below. Holo validates it by calling the viewer query before saving.',
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

const salesforceConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'install',
      label: 'Authorize',
      render: (ctx) =>
        oauthInstallStep(ctx, {
          installButtonLabel: 'Authorize Salesforce',
          permissions: [
            'Read accounts, contacts, and opportunities',
            'Read tasks, events, and notes attached to those records',
            'Stay connected via refresh token (no re-auth needed)',
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

const stripeConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'Secret key',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'Stripe restricted key (rk_live_… or sk_live_…)',
          helpText:
            'Use a restricted key with read-only access to Customers, Subscriptions, Invoices, and Charges. Secret keys also work but grant full account access — restricted is preferred.',
          helpUrl: 'https://dashboard.stripe.com/apikeys/create',
          instructions: [
            'Open the Stripe dashboard → Developers → API keys → "Create restricted key".',
            'Name it "Holo" and grant Read access to Customers, Subscriptions, Invoices, and Charges. Leave everything else None.',
            'Copy the key (it\'s only shown once) and paste it below.',
          ],
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

const asanaConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'apikey',
      label: 'Personal access token',
      render: (ctx) =>
        apiKeyStep(ctx, {
          placeholder: 'Asana personal access token',
          helpText:
            "Personal access tokens grant Holo read access to every workspace, project, and task the issuing user can see in Asana. Connect from a workspace admin (or a service-style user with broad project access) to mirror the full workspace.",
          helpUrl: 'https://app.asana.com/0/my-apps',
          instructions: [
            'Open app.asana.com → My Profile → My Apps → Personal access tokens, then click "Create new token".',
            'Label it "Holo" and create the token. Copy the value — Asana only shows it once.',
            'Paste it below. Holo validates it by calling /users/me before saving.',
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

const googleChatConfig: ConnectorWizardConfig<GoogleChatSpacesState> = {
  initialState: googleChatSpacesInitialState,
  steps: [
    {
      id: 'install',
      label: 'Service account',
      render: (ctx) =>
        serviceAccountStep(ctx, {
          scopes: GOOGLE_CHAT_SCOPES,
          impersonationHint: 'holo@yourcompany.com',
          apiToEnable: { label: 'Google Chat API', host: 'chat.googleapis.com' },
          extraSteps: [
            {
              label: 'Configure a Chat app',
              href: 'https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat',
              body:
                'Open the Configuration tab. Uncheck "Build as a Workspace Add-on". App name: "Holo". Avatar URL: https://raw.githubusercontent.com/maakle/holo/main/apps/web/public/logo.png. Description (≤40 chars): "Read-only ingestion for Holo". Turn OFF Interactive Features — Holo only reads via service account, no triggers needed. App status: "LIVE — available to users in your domain". Save. Full field-by-field guide: docs/connectors/google-chat.md.',
            },
          ],
        }),
    },
    {
      id: 'spaces',
      label: 'Pick spaces',
      size: 'wide',
      render: googleChatSpacesStep,
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

const jiraConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'credentials',
      label: 'Connect',
      render: (ctx) =>
        jiraCredentialsStep(ctx, {
          helpText:
            'Holo authenticates via Atlassian basic auth: your email + an API token. Connect from a workspace admin (or service-style user) to mirror the full workspace.',
          helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
          instructions: [
            'Open id.atlassian.com/manage-profile/security/api-tokens, click "Create API token", label it "Holo", and copy the value (you can\'t see it again after closing the dialog).',
            'Paste your Jira site URL (e.g. https://yourcompany.atlassian.net), the email of the Atlassian account that owns the token, and the token below.',
            'Holo validates the credentials by calling /rest/api/3/myself before saving.',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};

// Confluence shares the Atlassian basic-auth shape with Jira — same site URL,
// same email + API token. We reuse jiraCredentialsStep (which derives the
// button label and placeholder from meta.displayName) and only the helper
// copy + the connect route path differ.
const confluenceConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'credentials',
      label: 'Connect',
      render: (ctx) =>
        jiraCredentialsStep(ctx, {
          helpText:
            'Holo authenticates via Atlassian basic auth: your email + an API token. The same token works for both Jira and Confluence. Connect from a workspace admin (or service-style user) to mirror every space the account can view.',
          helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
          instructions: [
            'Open id.atlassian.com/manage-profile/security/api-tokens, click "Create API token", label it "Holo", and copy the value (you can\'t see it again after closing the dialog).',
            'Paste your Atlassian site URL (e.g. https://yourcompany.atlassian.net), the email of the Atlassian account that owns the token, and the token below.',
            'Holo validates the credentials by calling /wiki/rest/api/user/current before saving.',
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
  salesforce: salesforceConfig,
  notion: notionConfig,
  pylon: pylonConfig,
  linear: linearConfig,
  mintlify: mintlifyConfig,
  zendesk: zendeskConfig,
  googledrive: googleDriveConfig,
  airtable: airtableConfig,
  'google-chat': googleChatConfig,
  asana: asanaConfig,
  jira: jiraConfig,
  confluence: confluenceConfig,
  stripe: stripeConfig,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getWizardConfig(id: ConnectorMeta['id']): ConnectorWizardConfig<any> | undefined {
  return REGISTRY[id];
}
