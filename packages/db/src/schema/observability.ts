import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user, organization } from './auth';

/**
 * Unified event log for agent activity. Despite the legacy table name,
 * this stores not just MCP tool calls but every persistable event: LLM
 * calls, Slack messages, agent steps, etc — discriminated by `kind`.
 *
 * Group events by `trace_id` to reconstruct a full interaction (e.g.
 * one Slack thread → llm_call → tool_call → mcp_call). `parent_id`
 * captures fine-grained nesting within a trace.
 */
export const agentEventKind = [
  'mcp_call',
  'mcp_list',
  'llm_call',
  'slack_message',
  'agent_step',
  'tool_call',
  'connector_sync',
  'rest_call',
] as const;
export type AgentEventKind = (typeof agentEventKind)[number];

export const mcpInvocations = pgTable(
  'mcp_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    kind: text('kind').notNull().default('mcp_call').$type<AgentEventKind>(),
    traceId: uuid('trace_id'),
    parentId: uuid('parent_id'),
    agentIdentity: text('agent_identity'),
    toolName: text('tool_name').notNull(),
    inputJson: jsonb('input_json').$type<Record<string, unknown>>().notNull(),
    outputJson: jsonb('output_json').$type<Record<string, unknown>>(),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index('mcp_invocations_org_created_idx').on(t.organizationId, t.createdAt),
    orgToolIdx: index('mcp_invocations_org_tool_idx').on(t.organizationId, t.toolName),
    orgTraceIdx: index('mcp_invocations_org_trace_idx').on(
      t.organizationId,
      t.traceId,
      t.createdAt,
    ),
    orgKindCreatedIdx: index('mcp_invocations_org_kind_created_idx').on(
      t.organizationId,
      t.kind,
      t.createdAt,
    ),
  }),
);

/** Forward-compatible alias. Prefer this in new code. */
export const agentEvents = mcpInvocations;

/**
 * One row per time a user opens an MCP-invocation replay page. Used as the
 * "per-CTO replay" metric (CP2 from /plan-ceo-review): a proxy that the
 * OS-tomorrow framing is landing — we want to know how many distinct users
 * have actually clicked into and reviewed at least one replay. Multiple
 * views by the same user on the same invocation are kept as an audit trail
 * (no unique constraint); aggregation queries use COUNT DISTINCT.
 */
export const replayViews = pgTable(
  'replay_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mcpInvocationId: uuid('mcp_invocation_id')
      .notNull()
      .references(() => mcpInvocations.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgViewedIdx: index('replay_views_org_viewed_idx').on(t.organizationId, t.viewedAt),
    orgUserIdx: index('replay_views_org_user_idx').on(t.organizationId, t.userId),
  }),
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id').references(() => user.id),
    eventType: text('event_type').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedAtIdx: index('audit_events_org_created_at_idx').on(t.organizationId, t.createdAt.desc()),
    eventTypeIdx: index('audit_events_event_type_idx').on(t.organizationId, t.eventType),
  }),
);
