import { Module, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import postgres from 'postgres';
import { createDb, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { QUEUE_NAMES } from './types';
import { createGenericRunner } from './framework-bridge';
import { createTeamsRunner } from './teams-runner';
import {
  createLinearSpec,
  createPylonSpec,
  createHubspotSpec,
  createNotionSpec,
  createGrainSpec,
  createSlackSpec,
  createGithubSpec,
  createGitlabSpec,
  createMintlifySpec,
  createPrismicSpec,
  createWebcrawlSpec,
  createZendeskSpec,
  createGoogleDriveSpec,
  createAirtableSpec,
  createGoogleChatSpec,
  createAsanaSpec,
  createJiraSpec,
  createConfluenceSpec,
  createStripeSpec,
  createSalesforceSpec,
  githubAppConfigFromEnv,
} from '@holo/connectors';
import { setSyncRunner, markRegistrationComplete } from './sync-runner-registry';
import { reconcileOrphanedRuns } from './sync-runs-store';
import type { EmbedJobPayload } from './embed-insert';

let cachedDb: DB | null = null;

function getDb(): DB {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw holoError({
      code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
      problem: 'DATABASE_URL is not set',
      fix: 'Export DATABASE_URL before starting the worker process.',
    });
  }
  cachedDb = createDb(url);
  return cachedDb;
}

// Test seam.
export function __setDbForTests(db: DB | null): void {
  cachedDb = db;
}

@Injectable()
export class SyncRunnersBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncRunnersBootstrap.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMBED) private readonly embedQueue: Queue<EmbedJobPayload>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.registerRunners();
    } finally {
      // Open the startup gate even if a setSyncRunner call threw partway
      // through — otherwise queued jobs would hang forever waiting on a
      // promise that never resolves. With the gate open, anything still
      // wired to the default stub surfaces HOLO_CONNECTOR_NOT_IMPLEMENTED
      // loudly, which is the signal we want.
      markRegistrationComplete();
    }
    // Reap any 'running' rows the previous worker incarnation left behind
    // (crash, OOM, BullMQ stall). Without this, a dead worker's rows stay
    // 'running' forever and pollute the dashboard. 30-min floor inside
    // reconcileOrphanedRuns prevents reaping legitimately long syncs.
    try {
      const url = process.env.DATABASE_URL;
      if (url) {
        const sql = postgres(url, { max: 1, onnotice: () => {} });
        const swept = await reconcileOrphanedRuns(sql);
        await sql.end({ timeout: 5 });
        if (swept > 0) {
          this.logger.log(`reconciled ${swept} orphaned sync_runs row(s) → stalled`);
        }
      }
    } catch (err) {
      this.logger.warn(`sync_runs reconciliation failed: ${(err as Error).message}`);
    }
  }

  private async registerRunners(): Promise<void> {
    const deps = { db: getDb(), embedQueue: this.embedQueue };
    setSyncRunner(
      QUEUE_NAMES.SLACK_SYNC,
      createGenericRunner(
        createSlackSpec({
          // OAuth-only; the worker doesn't initiate OAuth, so empty defaults
          // are fine — the spec only uses clientId/secret on authorize/exchange,
          // not during sync.
          clientId: process.env.SLACK_CONNECTOR_CLIENT_ID ?? '',
          clientSecret: process.env.SLACK_CONNECTOR_CLIENT_SECRET ?? '',
        }),
        deps,
      ),
    );
    setSyncRunner(QUEUE_NAMES.NOTION_SYNC, createGenericRunner(createNotionSpec(), deps));

    // GitHub: one spec, two queue runners. The framework's resources filter
    // sends prose-queue jobs to the `prose` resource and code-queue jobs to
    // the `code` resource on the same createGithubSpec instance. The 'code'
    // shape exposes codeInitial/codeIncremental (matching the existing
    // dispatcher contract).
    if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY_B64) {
      const githubConfig = githubAppConfigFromEnv({
        GITHUB_APP_ID: process.env.GITHUB_APP_ID,
        GITHUB_APP_PRIVATE_KEY_B64: process.env.GITHUB_APP_PRIVATE_KEY_B64,
      });
      const githubSpec = createGithubSpec({
        appId: githubConfig.appId,
        privateKeyPem: githubConfig.privateKeyPem,
      });
      setSyncRunner(
        QUEUE_NAMES.GITHUB_PROSE_SYNC,
        createGenericRunner(githubSpec, deps, { resources: ['prose'] }),
      );
      setSyncRunner(
        QUEUE_NAMES.GITHUB_CODE_SYNC,
        createGenericRunner(githubSpec, deps, { resources: ['code'], shape: 'code' }),
      );
    }
    // GitLab: same one-spec / two-queue shape as GitHub. The framework's
    // `resources` filter drives prose-queue jobs into the `prose` resource
    // and code-queue jobs into the `code` resource on a single spec
    // instance, so the createGitlabSpec call only happens once. OAuth
    // creds are present at boot only when env vars are set; the spec is
    // still registered so the queues exist (a sync job will fail with
    // NOT_IMPLEMENTED if creds are missing, matching the OAuth runners).
    {
      const gitlabSpec = createGitlabSpec({
        clientId: process.env.GITLAB_CONNECTOR_CLIENT_ID ?? '',
        clientSecret: process.env.GITLAB_CONNECTOR_CLIENT_SECRET ?? '',
      });
      setSyncRunner(
        QUEUE_NAMES.GITLAB_PROSE_SYNC,
        createGenericRunner(gitlabSpec, deps, { resources: ['prose'] }),
      );
      setSyncRunner(
        QUEUE_NAMES.GITLAB_CODE_SYNC,
        createGenericRunner(gitlabSpec, deps, { resources: ['code'], shape: 'code' }),
      );
    }
    setSyncRunner(QUEUE_NAMES.GRAIN_SYNC, createGenericRunner(createGrainSpec(), deps));
    setSyncRunner(QUEUE_NAMES.PYLON_SYNC, createGenericRunner(createPylonSpec(), deps));
    setSyncRunner(QUEUE_NAMES.HUBSPOT_SYNC, createGenericRunner(createHubspotSpec(), deps));
    // Linear: personal API key auth, no env credentials required at boot.
    // The token is collected per-user via the connect route and loaded from
    // connector_credentials by the framework's loadTokens.
    setSyncRunner(QUEUE_NAMES.LINEAR_SYNC, createGenericRunner(createLinearSpec(), deps));
    // Jira: basic-auth (email + API token) collected via the connect-route
    // wizard. Per-tenant siteUrl lives on sources.metadata; the spec builds
    // its own HttpClient per sync.
    setSyncRunner(QUEUE_NAMES.JIRA_SYNC, createGenericRunner(createJiraSpec(), deps));
    // Confluence: same shape as Jira (basic-auth, per-tenant siteUrl on
    // sources.metadata). Spec builds its own HttpClient per sync.
    setSyncRunner(
      QUEUE_NAMES.CONFLUENCE_SYNC,
      createGenericRunner(createConfluenceSpec(), deps),
    );
    // Mintlify is fully public — no env credentials required. The per-source
    // base URL lives on `sources.metadata.baseUrl` and the framework's
    // `ctx.sourceMetadata` surfaces it inside the spec.
    setSyncRunner(
      QUEUE_NAMES.MINTLIFY_SYNC,
      createGenericRunner(createMintlifySpec(), deps),
    );
    // Prismic is public-by-default. Per-source state (`repo`, optional `accessToken`
    // for private repos) lives on `sources.metadata`; the spec reads it via
    // ctx.sourceMetadata, same shape as Mintlify and Zendesk.
    setSyncRunner(
      QUEUE_NAMES.PRISMIC_SYNC,
      createGenericRunner(createPrismicSpec(), deps),
    );
    // Zendesk help centers, also fully public — same shape as Mintlify
    // (per-source baseUrl on sources.metadata, none() auth).
    setSyncRunner(
      QUEUE_NAMES.ZENDESK_SYNC,
      createGenericRunner(createZendeskSpec(), deps),
    );
    // Webcrawl runs via Firecrawl. The API key is a single team-owned
    // secret (FIRECRAWL_API_KEY) — not per-org. We register the queue even
    // when the env var is missing so the worker boots cleanly; the sync
    // job throws HOLO_CONNECTOR_NOT_IMPLEMENTED at run time if the key
    // isn't present, surfacing as a clear error in the dashboard.
    setSyncRunner(
      QUEUE_NAMES.WEBCRAWL_SYNC,
      createGenericRunner(
        createWebcrawlSpec({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' }),
        deps,
      ),
    );
    // Google Drive runs against a per-org service account with domain-wide
    // delegation. The framework-bridge loads the SA from
    // connector_service_accounts and mints a delegated access token before
    // each sync — no global OAuth credentials needed at boot.
    setSyncRunner(
      QUEUE_NAMES.GOOGLEDRIVE_SYNC,
      createGenericRunner(createGoogleDriveSpec(), deps),
    );
    // Airtable: API-key (personal access token) auth, no env credentials
    // required at boot. The token is collected per-org via the connect route
    // and loaded from connector_credentials by the framework's loadTokens.
    setSyncRunner(
      QUEUE_NAMES.AIRTABLE_SYNC,
      createGenericRunner(createAirtableSpec(), deps),
    );
    // Google Chat runs against a per-org service account with domain-wide
    // delegation — same shape as Google Drive. The bridge mints delegated
    // tokens before each sync via loadGoogleServiceAccountToken.
    setSyncRunner(
      QUEUE_NAMES.GOOGLE_CHAT_SYNC,
      createGenericRunner(createGoogleChatSpec(), deps),
    );
    // Asana: personal access token auth, same shape as Linear/Airtable. No
    // env credentials required at boot; the token is collected per-org via
    // the connect route and loaded from connector_credentials.
    setSyncRunner(QUEUE_NAMES.ASANA_SYNC, createGenericRunner(createAsanaSpec(), deps));
    // Stripe: secret-key auth, same shape as HubSpot. The key is collected
    // per-org via the connect route and loaded from connector_credentials.
    setSyncRunner(QUEUE_NAMES.STRIPE_SYNC, createGenericRunner(createStripeSpec(), deps));
    // Salesforce: OAuth (refreshable). Same shape as GitLab — env credentials
    // are present at boot only when the Connected App is registered, but the
    // spec is registered unconditionally so the queue exists. A sync job
    // without env credentials fails with NOT_IMPLEMENTED at exchangeCode /
    // refresh time, which only matters when the user actually connects.
    setSyncRunner(
      QUEUE_NAMES.SALESFORCE_SYNC,
      createGenericRunner(
        createSalesforceSpec({
          clientId: process.env.SALESFORCE_CONNECTOR_CLIENT_ID ?? '',
          clientSecret: process.env.SALESFORCE_CONNECTOR_CLIENT_SECRET ?? '',
        }),
        deps,
      ),
    );
    // Microsoft Teams: app-only Graph auth, env-supplied bot creds.
    // Custom runner (not `createGenericRunner`) because Teams' "one
    // connection → many tenants → many channels/chats" doesn't fit the
    // framework's per-source-row resource flow. See teams-runner.ts.
    // Registered unconditionally so the queue exists; jobs without env
    // creds fail with HOLO_ENV_INVALID at runtime, which only matters
    // when the dashboard actually enables ingestion for an org.
    setSyncRunner(
      QUEUE_NAMES.TEAMS_SYNC,
      createTeamsRunner({
        db: deps.db,
        embedQueue: deps.embedQueue,
        appId: process.env.TEAMS_BOT_APP_ID ?? '',
        appSecret: process.env.TEAMS_BOT_APP_SECRET ?? '',
      }),
    );
    this.logger.log(
      'Registered framework SyncRunners for slack, grain, pylon, hubspot, notion, linear, github-prose, github-code, gitlab-prose, gitlab-code, mintlify, zendesk, googledrive, airtable, google-chat, asana, jira, confluence, stripe, salesforce, teams',
    );
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMBED })],
  providers: [SyncRunnersBootstrap],
})
export class SyncRunnersModule {}
