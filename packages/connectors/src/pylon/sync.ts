import { pylonTicketChunker } from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import type { PylonApiClient } from './api-client';

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
      let messages: Awaited<ReturnType<PylonApiClient['getIssueMessages']>> = [];
      try {
        messages = await input.client.getIssueMessages(issue.id);
      } catch (err) {
        logger.warn(`pylon: skipping messages for ${issue.id}: ${(err as Error).message}`);
      }

      const ticketInput = {
        ticketId: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        customerName: issue.customer?.name,
        customerEmail: issue.customer?.email,
        companyName: issue.company?.name,
        assigneeName: issue.assignee?.name,
        tags: issue.tags ?? [],
        messages: messages.map((m) => ({
          id: m.id,
          author: m.author,
          authorType: m.author_type,
          createdAt: new Date(m.created_at),
          body: m.body,
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
