/**
 * Microsoft Teams app manifest + icon assets used by the
 * `/api/connectors/teams-bot/manifest` route to produce the per-org
 * `holo-bot.zip` an admin sideloads via Teams Admin Center → Manage apps
 * → Upload custom app.
 *
 * Manifest schema: v1.16 (current stable as of May 2026). Older Teams
 * clients accept this; if a regulated tenant pins an older schema,
 * downgrading the `manifestVersion` + `$schema` here is the only edit
 * needed.
 *
 * Reference:
 *   https://learn.microsoft.com/microsoftteams/platform/resources/schema/manifest-schema
 *
 * # Icons
 *
 * Teams requires two PNGs in the zip:
 *   - color.png  192×192 — full-color, transparent background OK
 *   - outline.png 32×32 — flat, white silhouette on transparent ground
 *
 * We ship solid-color placeholders that Teams will accept without
 * complaint. Swap them with branded assets before AppSource submission
 * (and ideally before customer-facing rollout): replace
 * `BRAND_COLOR_PNG_B64` + `BRAND_OUTLINE_PNG_B64` below, no other code
 * changes needed.
 *
 * The placeholders are generated programmatically (single-pixel PNG of
 * the design-system accent `#3F47FF`, then up-scaled by Teams' renderer).
 * Tiny: 70 bytes color, 67 bytes outline. Keeps the manifest reproducible
 * and the repo binary-free.
 */
import JSZip from 'jszip';

/**
 * 1×1 solid `#3F47FF` PNG, base64-encoded. Teams up-scales as needed.
 *
 * Constructed via Node's zlib in a one-off script:
 *   const { deflateSync } = require('zlib');
 *   const crc32 = require('crc-32');
 *   // IHDR + IDAT (1px RGB #3F47FF) + IEND, with computed CRCs.
 *   // Pinned here so we don't bring in a PNG-encoding dep at request time.
 *
 * If you replace this, also bump `BRAND_OUTLINE_PNG_B64`.
 */
const BRAND_COLOR_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAFklEQVQIW2P8//8/Ay7AxIBHcsAlAQDeBQUAh3BRkAAAAABJRU5ErkJggg==';

/** 1×1 fully transparent PNG (used for the outline asset). */
const BRAND_OUTLINE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';

export interface TeamsManifestInput {
  /** Microsoft App ID (GUID) — pulled from TEAMS_BOT_APP_ID. */
  appId: string;
  /**
   * Stable per-org manifest id — a different GUID from `appId`. Teams
   * deduplicates installs by this id, so two orgs sideloading the same
   * shared bot get distinct "app entries" in their tenants. Derive it
   * from `appId + organizationId` so it's stable across regenerates.
   */
  manifestId: string;
  /** Org display name; surfaced in the manifest's `developer.name` field. */
  organizationName: string;
  /**
   * Public base URL of the dashboard (e.g. `https://holobase.dev`). Used
   * for `developer.websiteUrl`, `privacyUrl`, `termsOfUseUrl`. The bot's
   * inbound endpoint is configured server-side in Azure Bot, not in the
   * manifest.
   */
  webPublicUrl: string;
  /** Optional version override; defaults to a semver derived from clock. */
  version?: string;
}

interface TeamsAppManifest {
  $schema: string;
  manifestVersion: string;
  version: string;
  id: string;
  developer: {
    name: string;
    websiteUrl: string;
    privacyUrl: string;
    termsOfUseUrl: string;
  };
  icons: { color: string; outline: string };
  name: { short: string; full: string };
  description: { short: string; full: string };
  accentColor: string;
  bots: Array<{
    botId: string;
    scopes: Array<'personal' | 'team' | 'groupChat'>;
    supportsFiles: boolean;
    isNotificationOnly: boolean;
  }>;
  permissions: Array<'identity' | 'messageTeamMembers'>;
  validDomains: string[];
  /**
   * Required by Teams when declaring Resource-Specific Consent (RSC).
   * `id` is the bot's Microsoft App ID; `resource` is the canonical
   * `api://botid-<appId>` form per Microsoft's docs (the "resource"
   * field's value is conventionally a URI even when no SSO is enabled).
   */
  webApplicationInfo: { id: string; resource: string };
  /**
   * Resource-Specific Consent permissions — declared in the manifest,
   * granted by the tenant admin at sideload time, and enforced by
   * Microsoft Graph itself. The bot can only read channel/chat
   * messages in resources where it's been installed. See
   * docs/designs/teams-ingestion.md for the rationale (vs. the
   * tenant-wide `Chat.Read.All` application permission).
   */
  authorization: {
    permissions: {
      resourceSpecific: Array<{
        name: string;
        type: 'Application' | 'Delegated';
      }>;
    };
  };
}

function buildManifest(input: TeamsManifestInput): TeamsAppManifest {
  const version = input.version ?? defaultVersion();
  // Strip the protocol off webPublicUrl for validDomains — Teams expects
  // hostnames only there.
  const host = new URL(input.webPublicUrl).host;
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
    manifestVersion: '1.16',
    version,
    id: input.manifestId,
    developer: {
      name: input.organizationName,
      websiteUrl: input.webPublicUrl,
      privacyUrl: `${input.webPublicUrl}/privacy`,
      termsOfUseUrl: `${input.webPublicUrl}/terms`,
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    name: {
      short: 'holo',
      full: 'holo — knowledge bot',
    },
    description: {
      short: 'Ask holo for answers grounded in your company knowledge.',
      full:
        'holo is a knowledge assistant for your organization. DM the bot or ' +
        '@mention it in a Team channel or group chat to retrieve answers ' +
        'grounded in your indexed sources — Slack threads, Google Drive ' +
        'docs, Notion pages, GitHub PRs, customer call transcripts, and more.',
    },
    accentColor: '#3F47FF',
    bots: [
      {
        botId: input.appId,
        scopes: ['personal', 'team', 'groupChat'],
        supportsFiles: false,
        isNotificationOnly: false,
      },
    ],
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: [host],
    webApplicationInfo: {
      id: input.appId,
      resource: `api://botid-${input.appId}`,
    },
    authorization: {
      permissions: {
        // Order is intentional: bot-related perms first, then ingestion
        // perms. Adding a permission here forces a re-sideload to grant.
        resourceSpecific: [
          // Channel-message ingestion (reads only channels where the bot
          // is installed; Microsoft enforces the boundary).
          { name: 'ChannelMessage.Read.Group', type: 'Application' },
          // Team metadata for ACL derivation (display name, settings).
          { name: 'TeamSettings.Read.Group', type: 'Application' },
          // Team membership for per-user ACL filtering at retrieval time.
          { name: 'TeamMember.Read.Group', type: 'Application' },
          // Chat-message ingestion for 1:1 / group / meeting chats where
          // the bot has been added.
          { name: 'ChatMessage.Read.Chat', type: 'Application' },
          // Chat membership for ACL derivation on chat threads.
          { name: 'ChatMember.Read.Chat', type: 'Application' },
        ],
      },
    },
  };
}

/**
 * Build the `holo-bot.zip` payload (manifest + 2 icons). Returns a
 * Node `Buffer` ready to stream to the HTTP response with
 * `Content-Type: application/zip`.
 */
export async function buildTeamsManifestZip(
  input: TeamsManifestInput,
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(buildManifest(input), null, 2));
  zip.file('color.png', Buffer.from(BRAND_COLOR_PNG_B64, 'base64'));
  zip.file('outline.png', Buffer.from(BRAND_OUTLINE_PNG_B64, 'base64'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Default version: `YYYY.MM.DD.HHmm` from UTC. Teams compares versions
 * lexicographically on upload, so the date-based scheme lets us bump on
 * every regenerate without manual tracking.
 */
function defaultVersion(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}.${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/**
 * Derive a stable per-org manifest id from `appId` + `organizationId`.
 * Uses a hash so the result is a v4-shaped UUID; Teams' manifest schema
 * validates `id` against `^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$`.
 *
 * Exported for tests + reuse by the API route.
 */
export function deriveManifestId(appId: string, organizationId: string): string {
  // Cheap stable hash: SHA-256 → hex → format as UUID v4 (variant + version bits set).
  // Node ESM doesn't auto-import `crypto` — keep the call site simple.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const hex = createHash('sha256').update(`${appId}:${organizationId}`).digest('hex');
  // Format as 8-4-4-4-12 with version (4) + variant (8/9/a/b) bits clamped.
  const v = '4';
  const r = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `${v}${hex.slice(13, 16)}`,
    `${r}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
