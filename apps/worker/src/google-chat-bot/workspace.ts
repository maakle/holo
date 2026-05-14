import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

export interface ChatWorkspaceCreds {
  organizationId: string;
  /**
   * Service account JSON (already-decrypted by drizzle's `encryptedText`).
   * Used to mint the app-level bearer token for outbound Chat API calls.
   * For the shared Holo app, this comes from env. For BYO apps it's pulled
   * from `google_chat_app_configs`.
   */
  serviceAccountJson: string;
}

/**
 * Resolve which Holo organization a Google Workspace `customerNumber`
 * belongs to. Mirrors the Slack `resolveWorkspace` shape: trust the row
 * in `google_chat_workspaces` (written by the connections onboarding
 * flow), and then resolve outbound credentials in one of two ways:
 *
 *   1. BYO path: org has a `google_chat_app_configs` row — use that SA.
 *   2. Shared path: fall back to env-provided shared SA JSON.
 *
 * Returns null if either lookup fails — the handler logs and skips so a
 * misconfigured tenant doesn't crash the worker.
 */
export async function resolveChatWorkspace(
  db: DB,
  customerNumber: string,
  sharedServiceAccountJson: string | undefined,
): Promise<ChatWorkspaceCreds | null> {
  const rows = await db
    .select({ organizationId: schema.googleChatWorkspaces.organizationId })
    .from(schema.googleChatWorkspaces)
    .where(eq(schema.googleChatWorkspaces.customerNumber, customerNumber))
    .limit(1);
  if (!rows[0]) return null;
  const organizationId = rows[0].organizationId;

  const byo = await db
    .select({
      serviceAccountJson: schema.googleChatAppConfigs.serviceAccountJson,
    })
    .from(schema.googleChatAppConfigs)
    .where(eq(schema.googleChatAppConfigs.organizationId, organizationId))
    .limit(1);
  if (byo[0]) {
    return { organizationId, serviceAccountJson: byo[0].serviceAccountJson };
  }

  if (!sharedServiceAccountJson) return null;
  return { organizationId, serviceAccountJson: sharedServiceAccountJson };
}

export async function fetchOrgName(db: DB, organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.name ?? 'this organization';
}
