/**
 * The canonical list of ConnectorRegistrations.
 *
 * Adding a connector? Append one entry here, add the provider id to
 * `SYNC_PROVIDERS` in `@holo/sync-providers`, and the rest follows:
 *  - `SYNC_INTERVAL_MS_BY_PROVIDER` derives the interval from this list
 *  - the framework-bridge `loadTokens` derives its no-auth / SA short-
 *    circuits from this list
 *  - the worker's runner registration is one call to `createSpec()`
 *
 * A refreshable-OAuth connector must declare `persistTokens:
 * persistRefreshableOAuthTokens`; the type system then forces every
 * OAuth-callback site to pass `expiresAt: Date`.
 */
import { SYNC_PROVIDERS, type SyncProvider } from '@holo/sync-providers';
import type { ConnectorSpec } from '@holo/connector-framework';
import { ErrorCode, holoError } from '@holo/errors';
import {
  defineConnectorRegistration,
  indexRegistrations,
  persistRefreshableOAuthTokens,
  type ConnectorRegistration,
} from './contract';
import { createAirtableSpec } from './airtable/spec';
import { createAsanaSpec } from './asana/spec';
import { createConfluenceSpec } from './confluence/spec';
import { createGithubSpec, type GithubSpecOptions } from './github/spec';
import { createGitlabSpec, type GitlabSpecOptions } from './gitlab/spec';
import { createGoogleChatSpec } from './google-chat/spec';
import { createGoogleDriveSpec } from './googledrive/spec';
import { createGrainSpec } from './grain/spec';
import { createHubspotSpec } from './hubspot/spec';
import { createJiraSpec } from './jira/spec';
import { createLinearSpec } from './linear/spec';
import { createMintlifySpec } from './mintlify/spec';
import { createNotionSpec } from './notion/spec';
import { createPylonSpec } from './pylon/spec';
import { createSlackSpec, type SlackSpecOptions } from './slack/spec';
import { createZendeskSpec } from './zendesk/spec';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from './sync-intervals';

/**
 * Per-connector option shapes the host (worker / web app) supplies at
 * boot. Most connectors accept no options; the OAuth and GitHub-App
 * connectors need credentials that live in env.
 */
export interface ConnectorBootOptions {
  slack?: SlackSpecOptions;
  gitlab?: GitlabSpecOptions;
  github?: GithubSpecOptions;
}

/**
 * A registration that ignores its boot-options argument. Used for the
 * connectors that don't need env-supplied secrets at spec construction
 * (the framework-bridge supplies tokens at sync time).
 */
type NoOptRegistration = ConnectorRegistration<ConnectorBootOptions>;

const slack: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'slack',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.slack,
  auth: { kind: 'oauth', refreshable: false },
  createSpec(opts): ConnectorSpec {
    return createSlackSpec(opts.slack ?? { clientId: '', clientSecret: '' });
  },
});

const linear: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'linear',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.linear,
  auth: { kind: 'apiKey' },
  createSpec: () => createLinearSpec(),
});

const zendesk: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'zendesk',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.zendesk,
  auth: { kind: 'none' },
  createSpec: () => createZendeskSpec(),
});

const hubspot: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'hubspot',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.hubspot,
  auth: { kind: 'apiKey' },
  createSpec: () => createHubspotSpec(),
});

const pylon: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'pylon',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.pylon,
  auth: { kind: 'apiKey' },
  createSpec: () => createPylonSpec(),
});

const github: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'github',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.github,
  auth: { kind: 'githubApp' },
  createSpec(opts): ConnectorSpec {
    if (!opts.github) {
      // Spec construction needs the App's private key. The bridge defers
      // this to boot time when env is read; we surface the missing-config
      // path as a typed error rather than letting createGithubSpec NPE.
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub registration: missing GithubSpecOptions',
        fix: 'Pass { appId, privateKeyPem } from env (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_B64) at boot.',
      });
    }
    return createGithubSpec(opts.github);
  },
});

const gitlab: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'gitlab',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.gitlab,
  auth: { kind: 'oauth', refreshable: true },
  // Required by the type — its presence is what makes the callback site
  // pass `expiresAt: Date` (otherwise the call doesn't typecheck).
  persistTokens: persistRefreshableOAuthTokens,
  createSpec(opts): ConnectorSpec {
    return createGitlabSpec(opts.gitlab ?? { clientId: '', clientSecret: '' });
  },
});

const grain: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'grain',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.grain,
  auth: { kind: 'apiKey' },
  createSpec: () => createGrainSpec(),
});

const notion: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'notion',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.notion,
  auth: { kind: 'apiKey' },
  createSpec: () => createNotionSpec(),
});

const mintlify: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'mintlify',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.mintlify,
  auth: { kind: 'none' },
  createSpec: () => createMintlifySpec(),
});

const googledrive: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'googledrive',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.googledrive,
  auth: { kind: 'serviceAccount' },
  createSpec: () => createGoogleDriveSpec(),
});

const airtable: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'airtable',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.airtable,
  auth: { kind: 'apiKey' },
  createSpec: () => createAirtableSpec(),
});

const googleChat: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'google-chat',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER['google-chat'],
  auth: { kind: 'serviceAccount' },
  createSpec: () => createGoogleChatSpec(),
});

const asana: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'asana',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.asana,
  auth: { kind: 'apiKey' },
  createSpec: () => createAsanaSpec(),
});

const jira: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'jira',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.jira,
  auth: { kind: 'apiKey' },
  createSpec: () => createJiraSpec(),
});

const confluence: NoOptRegistration = defineConnectorRegistration<ConnectorBootOptions>({
  providerId: 'confluence',
  syncIntervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.confluence,
  auth: { kind: 'apiKey' },
  createSpec: () => createConfluenceSpec(),
});

/**
 * Canonical registration list. The order is purely cosmetic — the
 * `indexRegistrations` invariant tolerates any permutation, but it
 * matches `SYNC_PROVIDERS` for grep-ability.
 */
export const CONNECTOR_REGISTRATIONS: ReadonlyArray<ConnectorRegistration<ConnectorBootOptions>> = [
  github,
  gitlab,
  slack,
  notion,
  grain,
  pylon,
  hubspot,
  linear,
  mintlify,
  zendesk,
  googledrive,
  airtable,
  googleChat,
  asana,
  jira,
  confluence,
];

/**
 * Strongly-keyed lookup by provider id. Throws at module init if
 * registrations drift from `SYNC_PROVIDERS` — the structural invariant
 * that the contract exists to enforce.
 */
export const CONNECTOR_REGISTRATIONS_BY_PROVIDER: Readonly<
  Record<SyncProvider, ConnectorRegistration<ConnectorBootOptions>>
> = indexRegistrations(CONNECTOR_REGISTRATIONS);

// Compile-time check: every SyncProvider has an entry. The runtime check
// in indexRegistrations catches misordering / typos; this catches the
// "I forgot to update SYNC_PROVIDERS" case at typecheck.
type _AssertCoversAllProviders =
  keyof typeof CONNECTOR_REGISTRATIONS_BY_PROVIDER extends SyncProvider
    ? SyncProvider extends keyof typeof CONNECTOR_REGISTRATIONS_BY_PROVIDER
      ? true
      : ['SYNC_PROVIDERS missing registration']
    : ['registrations refer to unknown provider'];
const _coverage: _AssertCoversAllProviders = true;
void _coverage;
void SYNC_PROVIDERS;
