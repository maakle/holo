import type { DB } from '@holo/db';
import { schema } from '@holo/db';

export type AuditEventType =
  | 'skill_run.started'
  | 'skill_run.completed'
  | 'skill_run.failed'
  | 'api_token.created'
  | 'api_token.revoked'
  | 'skill.published'
  | 'skill.synthesized'
  | 'member.invited';

export interface EmitAuditEventInput {
  db: DB;
  organizationId: string;
  userId?: string;
  eventType: AuditEventType;
  resourceType: string;
  resourceId?: string;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget audit event emit. Never throws — errors are swallowed. */
export function emitAuditEvent(input: EmitAuditEventInput): void {
  const { db, organizationId, userId, eventType, resourceType, resourceId, meta } = input;
  db.insert(schema.auditEvents)
    .values({
      organizationId,
      userId: userId ?? null,
      eventType,
      resourceType,
      resourceId: resourceId ?? null,
      meta: meta ?? {},
    })
    .catch(() => {
      // audit failures are non-fatal
    });
}
