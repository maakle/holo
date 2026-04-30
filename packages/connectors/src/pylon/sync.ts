import { pylonTicketChunker } from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import type { PylonApiClient, PylonMessage } from './api-client';

export type PylonChunkPayload = {
  kind: 'pylon-ticket';
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  contentHash: string;
  sourceArtifactId: string;
  provider: 'pylon';
  sourceId: string;
  organizationId: string;
};

export type PylonEmbedEnqueueFn = (payload: {
  issueId: string;
  chunks: PylonChunkPayload[];
  organizationId: string;
  sourceId: string;
}) => Promise<void>;

export interface RunPylonSyncInput {
  client: PylonApiClient;
  updatedAfter?: string;
  organizationId: string;
  sourceId: string;
  existingHashes: Set<string>;
  enqueueEmbed: PylonEmbedEnqueueFn;
  logger?: { warn(msg: string): void };
}

export interface RunPylonSyncOutput {
  artifactCount: number;
  latestUpdatedAt: string | null;
}

function deriveAuthorType(author: PylonMessage['author']): 'agent' | 'customer' | 'bot' {
  if (author.user) return 'agent';
  if (author.contact) return 'customer';
  return 'bot';
}

export async function runPylonSync(input: RunPylonSyncInput): Promise<RunPylonSyncOutput> {
  const logger = input.logger ?? { warn: () => {} };
  let cursor: string | undefined;
  let totalArtifacts = 0;
  let latestUpdatedAt: string | null = null;

  do {
    const page = await input.client.listIssues({
      updatedAfter: input.updatedAfter,
      cursor,
    });

    for (const issue of page.issues) {
      const artifactId = `pylon-ticket:${issue.id}`;
      let messages: PylonMessage[] = [];
      try {
        messages = await input.client.getIssueMessages(issue.id);
      } catch (err) {
        logger.warn(`pylon: skipping messages for ${issue.id}: ${(err as Error).message}`);
      }

      const ticketInput = {
        ticketId: issue.id,
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
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        sourceArtifactId: artifactId,
      });

      const newChunks: PylonChunkPayload[] = [];
      for (const c of rawChunks) {
        const hash = chunkHash('pylon-ticket', c.content);
        if (input.existingHashes.has(hash)) continue;
        input.existingHashes.add(hash);
        newChunks.push({
          kind: 'pylon-ticket',
          content: c.content,
          metadata: c.metadata,
          aclSubjects: c.aclSubjects,
          contentHash: hash,
          sourceArtifactId: artifactId,
          provider: 'pylon',
          sourceId: input.sourceId,
          organizationId: input.organizationId,
        });
      }

      if (newChunks.length > 0) {
        await input.enqueueEmbed({
          issueId: issue.id,
          chunks: newChunks,
          organizationId: input.organizationId,
          sourceId: input.sourceId,
        });
      }

      totalArtifacts++;
      if (!latestUpdatedAt || issue.updated_at > latestUpdatedAt) {
        latestUpdatedAt = issue.updated_at;
      }
    }

    cursor = page.nextCursor;
  } while (cursor);

  return { artifactCount: totalArtifacts, latestUpdatedAt };
}
