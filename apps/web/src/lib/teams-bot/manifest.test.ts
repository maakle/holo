import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildTeamsManifestZip, deriveManifestId } from './manifest';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const ORG_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

async function unpackManifest(
  zipBytes: Buffer,
): Promise<{
  manifest: Record<string, unknown>;
  hasColor: boolean;
  hasOutline: boolean;
}> {
  const zip = await JSZip.loadAsync(zipBytes);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('manifest.json missing from zip');
  const manifest = JSON.parse(await manifestFile.async('string')) as Record<
    string,
    unknown
  >;
  return {
    manifest,
    hasColor: zip.file('color.png') !== null,
    hasOutline: zip.file('outline.png') !== null,
  };
}

describe('buildTeamsManifestZip', () => {
  it('produces a zip with manifest.json + both icons', async () => {
    const zip = await buildTeamsManifestZip({
      appId: APP_ID,
      manifestId: deriveManifestId(APP_ID, ORG_ID),
      organizationName: 'Test Co',
      webPublicUrl: 'https://holobase.dev',
    });
    const { manifest, hasColor, hasOutline } = await unpackManifest(zip);
    expect(hasColor).toBe(true);
    expect(hasOutline).toBe(true);
    expect(manifest['manifestVersion']).toBe('1.16');
  });

  it('points the bot at the configured app id', async () => {
    const zip = await buildTeamsManifestZip({
      appId: APP_ID,
      manifestId: deriveManifestId(APP_ID, ORG_ID),
      organizationName: 'Test Co',
      webPublicUrl: 'https://holobase.dev',
    });
    const { manifest } = await unpackManifest(zip);
    const bots = manifest['bots'] as Array<{ botId: string }>;
    expect(bots[0]?.botId).toBe(APP_ID);
  });

  it('declares the five RSC permissions required by Teams ingestion', async () => {
    // Ingestion needs Microsoft to enforce the per-resource boundary at
    // the Graph layer rather than us filtering in code. These five
    // permissions are what the manifest must declare for that to work;
    // if any is missing, Graph rejects with 403 the first time the
    // ingestion sync runs in a re-consented tenant.
    const zip = await buildTeamsManifestZip({
      appId: APP_ID,
      manifestId: deriveManifestId(APP_ID, ORG_ID),
      organizationName: 'Test Co',
      webPublicUrl: 'https://holobase.dev',
    });
    const { manifest } = await unpackManifest(zip);
    const auth = manifest['authorization'] as {
      permissions: {
        resourceSpecific: Array<{ name: string; type: string }>;
      };
    };
    const names = auth.permissions.resourceSpecific.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        'ChannelMessage.Read.Group',
        'ChatMember.Read.Chat',
        'ChatMessage.Read.Chat',
        'TeamMember.Read.Group',
        'TeamSettings.Read.Group',
      ].sort(),
    );
    // All five must be `Application` type. `Delegated` would change the
    // consent model entirely (per-user OAuth instead of admin sideload).
    expect(
      auth.permissions.resourceSpecific.every((p) => p.type === 'Application'),
    ).toBe(true);
  });

  it('includes webApplicationInfo with the bot app id', async () => {
    // Required by Teams when declaring RSC permissions; Teams Admin
    // Center will reject the upload otherwise.
    const zip = await buildTeamsManifestZip({
      appId: APP_ID,
      manifestId: deriveManifestId(APP_ID, ORG_ID),
      organizationName: 'Test Co',
      webPublicUrl: 'https://holobase.dev',
    });
    const { manifest } = await unpackManifest(zip);
    const info = manifest['webApplicationInfo'] as {
      id: string;
      resource: string;
    };
    expect(info.id).toBe(APP_ID);
    expect(info.resource).toBe(`api://botid-${APP_ID}`);
  });
});

describe('deriveManifestId', () => {
  it('produces a stable v4-shaped GUID for the same inputs', () => {
    const a = deriveManifestId(APP_ID, ORG_ID);
    const b = deriveManifestId(APP_ID, ORG_ID);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('produces different ids for different orgs', () => {
    const a = deriveManifestId(APP_ID, ORG_ID);
    const b = deriveManifestId(APP_ID, 'ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(a).not.toBe(b);
  });

  it('produces different ids for different app ids', () => {
    const a = deriveManifestId(APP_ID, ORG_ID);
    const b = deriveManifestId('22222222-3333-4444-5555-666666666666', ORG_ID);
    expect(a).not.toBe(b);
  });
});
