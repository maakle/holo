import { z } from 'zod';
import { pylonTicketChunker } from '@holo/chunker';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type HttpClient,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';

export interface PylonSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

interface PylonIssue {
  id: string;
  number: number;
  title: string;
  body_html: string;
  type: 'conversation' | 'ticket';
  state: string;
  source: string;
  created_at: string;
  updated_at: string;
  link: string;
  assignee?: { id: string; email: string };
  requester?: { id: string; email: string };
  tags: string[];
}

interface PylonMessage {
  id: string;
  thread_id: string;
  message_html: string;
  is_private: boolean;
  source: string;
  timestamp: string;
  file_urls: string[];
  author: {
    name: string;
    avatar_url: string;
    user?: { id: string; email: string };
    contact?: { id: string; email: string };
  };
}

interface IssuesPage {
  data: PylonIssue[];
  pagination: { cursor: string | null; has_next_page: boolean };
}

interface MessagesPage {
  data: PylonMessage[];
  pagination: { cursor: string | null; has_next_page: boolean };
}

const ticketsCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent ticket we've ingested. */
    latestUpdatedAt: z.string().optional(),
  })
  .default({});

type TicketsCursor = z.infer<typeof ticketsCursorSchema>;

function deriveAuthorType(author: PylonMessage['author']): 'agent' | 'customer' | 'bot' {
  if (author.user) return 'agent';
  if (author.contact) return 'customer';
  return 'bot';
}

async function fetchAllMessages(api: HttpClient, issueId: string): Promise<PylonMessage[]> {
  const out: PylonMessage[] = [];
  let cursor: string | undefined;
  do {
    const query: Record<string, string | number> = { limit: 100 };
    if (cursor) query['cursor'] = cursor;
    const page = await api.get<MessagesPage>(`/issues/${issueId}/messages`, { query });
    out.push(...(page.data ?? []));
    cursor =
      page.pagination?.has_next_page && page.pagination.cursor
        ? page.pagination.cursor
        : undefined;
  } while (cursor);
  return out;
}

export function createPylonSpec(_opts: PylonSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'pylon',
    displayName: 'Pylon',

    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.usepylon.com',
      defaultHeaders: { Accept: 'application/json' },
      // Pylon doesn't publish a hard rate limit; the framework's default
      // exponential backoff on 429/5xx is sufficient.
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const raw = await ctx.api.get<{ data: { id: string; name: string } }>('/me');
      return {
        externalId: raw.data.id,
        name: raw.data.name,
        raw: { org_id: raw.data.id, org_name: raw.data.name },
      };
    },

    resources: [
      {
        id: 'tickets',
        displayName: 'Tickets',
        cursorSchema: ticketsCursorSchema,
        async sync(ctx: ResourceSyncContext<TicketsCursor>): Promise<TicketsCursor> {
          let cursor: string | undefined;
          let highestUpdatedAt = ctx.cursor.latestUpdatedAt;
          let pageNum = 0;

          do {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching tickets · page ${pageNum}`,
            });

            const body: Record<string, unknown> = { limit: 100 };
            if (cursor) body['cursor'] = cursor;
            if (ctx.cursor.latestUpdatedAt) {
              body['filter'] = {
                updated_at: { time_is_after: ctx.cursor.latestUpdatedAt },
              };
            }

            const page: IssuesPage = await ctx.api.post<IssuesPage>('/issues/search', body);

            for (const issue of page.data ?? []) {
              ctx.signal?.throwIfAborted();

              // Failures fetching messages should not abort the whole sync —
              // a single ticket with broken messages can still be indexed
              // with title + body. Mirrors legacy behavior.
              let messages: PylonMessage[] = [];
              try {
                messages = await fetchAllMessages(ctx.api, issue.id);
              } catch {
                /* skip messages for this ticket */
              }

              const ticketInput = {
                ticketId: issue.id,
                issueNumber: issue.number,
                title: issue.title,
                status: issue.state,
                priority: undefined,
                createdAt: new Date(issue.created_at),
                updatedAt: new Date(issue.updated_at),
                customerName: issue.requester?.email,
                customerEmail: issue.requester?.email,
                companyName: undefined,
                assigneeName: issue.assignee?.email,
                tags: issue.tags ?? [],
                messages: messages.map((m) => ({
                  id: m.id,
                  author: m.author.name,
                  authorType: deriveAuthorType(m.author),
                  createdAt: new Date(m.timestamp),
                  body: m.message_html,
                })),
              };

              const rawChunks = await pylonTicketChunker.chunk(ticketInput, {
                organizationId: ctx.organizationId,
                sourceId: ctx.sourceId,
                sourceArtifactId: `pylon-ticket:${issue.id}`,
              });

              for (const c of rawChunks) {
                await ctx.upsert({
                  externalId: issue.id,
                  kind: 'pylon-ticket',
                  content: c.content,
                  metadata: c.metadata,
                  aclSubjects: c.aclSubjects,
                });
              }

              if (!highestUpdatedAt || issue.updated_at > highestUpdatedAt) {
                highestUpdatedAt = issue.updated_at;
              }
            }

            cursor =
              page.pagination?.has_next_page && page.pagination.cursor
                ? page.pagination.cursor
                : undefined;
          } while (cursor);

          return { latestUpdatedAt: highestUpdatedAt };
        },
      },
    ],

    ui: {
      description: 'Customer support tickets and message threads.',
      category: 'support',
    },
  });
}
