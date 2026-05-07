/**
 * Mintlify record → chunk projection.
 *
 * Two record kinds:
 *   1. `pages` — one chunk batch per Mintlify page (markdown body run
 *      through @holo/chunker's mintlifyPageChunker, which recursive-splits
 *      and prefixes each piece with the breadcrumb + URL).
 *   2. `openapi` — one chunk per (path, method) on the OpenAPI spec via
 *      @holo/chunker's openapiEndpointChunker.
 */
import {
  mintlifyPageChunker,
  openapiEndpointChunker,
  type OpenApiDocument,
} from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import type { LlmsIndexEntry } from './types';

export async function emitPageChunks(
  ctx: ResourceSyncContext<unknown>,
  args: {
    baseUrl: string;
    entry: LlmsIndexEntry;
    markdown: string;
  },
): Promise<void> {
  const sourceArtifactId = `mintlify-page:${args.baseUrl}${args.entry.path}`;
  const rawChunks = await mintlifyPageChunker.chunk(
    {
      baseUrl: args.baseUrl,
      path: args.entry.path,
      title: args.entry.title,
      section: args.entry.section,
      content: args.markdown,
    },
    {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    },
  );

  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: args.entry.path,
      kind: 'mintlify-page',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}

export async function emitOpenApiChunks(
  ctx: ResourceSyncContext<unknown>,
  args: {
    baseUrl: string;
    specUrl: string;
    spec: OpenApiDocument;
  },
): Promise<void> {
  const sourceArtifactId = `mintlify-openapi:${args.specUrl}`;
  const rawChunks = await openapiEndpointChunker.chunk(
    { baseUrl: args.baseUrl, spec: args.spec },
    {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    },
  );

  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: `${c.metadata['method']} ${c.metadata['path']}`,
      kind: 'mintlify-openapi-endpoint',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}
