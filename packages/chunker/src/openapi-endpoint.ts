import type { Chunk, ChunkContext, Chunker } from './contract.js';

/**
 * One chunk per (path, method) on an OpenAPI 3.x document. Keeping each
 * endpoint as its own retrievable unit means an agent answering "how do I
 * create a user?" gets the full POST /users definition + body schema +
 * response schema in a single chunk, instead of fragments scattered across
 * a long markdown wall.
 */
export interface OpenApiEndpointInput {
  /** Site root (used in metadata for deep linking back to the docs page). */
  baseUrl: string;
  /** OpenAPI 3.x document — already parsed JSON. */
  spec: OpenApiDocument;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, OpenApiPathItem>;
}

interface OpenApiPathItem {
  // Method-keyed operations. We only emit chunks for the standard verbs.
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  parameters?: OpenApiParameter[];
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    description?: string;
    required?: boolean;
    content?: Record<string, { schema?: unknown; example?: unknown }>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: unknown }> }
  >;
  deprecated?: boolean;
}

interface OpenApiParameter {
  name?: string;
  in?: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: { type?: string };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export const openapiEndpointChunker: Chunker<OpenApiEndpointInput> = {
  kind: 'openapi-endpoint',
  embeddingModel: 'openai-3-large',
  async chunk(input: OpenApiEndpointInput, ctx: ChunkContext): Promise<Chunk[]> {
    const out: Chunk[] = [];
    const aclSubjects = [`org:${ctx.organizationId}`];
    const apiTitle = input.spec.info?.title ?? 'API';
    const serverUrl = input.spec.servers?.[0]?.url ?? '';

    const paths = input.spec.paths ?? {};
    for (const [path, item] of Object.entries(paths)) {
      const pathParams = item.parameters ?? [];
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        if (op.deprecated) continue;

        const lines: string[] = [];
        lines.push(`${method.toUpperCase()} ${path}`);
        if (apiTitle) lines.push(`API: ${apiTitle}`);
        if (op.tags?.length) lines.push(`Tags: ${op.tags.join(', ')}`);
        if (op.summary) lines.push(`Summary: ${op.summary}`);
        if (op.description) {
          lines.push('');
          lines.push(op.description);
        }

        const allParams = [...pathParams, ...(op.parameters ?? [])];
        if (allParams.length > 0) {
          lines.push('');
          lines.push('Parameters:');
          for (const p of allParams) {
            const required = p.required ? ' (required)' : '';
            const where = p.in ? ` [${p.in}]` : '';
            const type = p.schema?.type ? `: ${p.schema.type}` : '';
            const desc = p.description ? ` — ${p.description}` : '';
            lines.push(`  - ${p.name ?? '?'}${type}${where}${required}${desc}`);
          }
        }

        const reqBody = op.requestBody;
        if (reqBody) {
          lines.push('');
          lines.push(
            `Request body${reqBody.required ? ' (required)' : ''}${
              reqBody.description ? `: ${reqBody.description}` : ''
            }`,
          );
          // Inline a JSON-schema preview so retrieval can match field names.
          const json = reqBody.content?.['application/json'];
          if (json?.schema) {
            const preview = JSON.stringify(json.schema, null, 2).slice(0, 1500);
            lines.push('```json');
            lines.push(preview);
            lines.push('```');
          }
        }

        const responses = op.responses ?? {};
        const responseLines: string[] = [];
        for (const [status, resp] of Object.entries(responses)) {
          const desc = resp.description ? `: ${resp.description}` : '';
          responseLines.push(`  - ${status}${desc}`);
        }
        if (responseLines.length > 0) {
          lines.push('');
          lines.push('Responses:');
          lines.push(...responseLines);
        }

        const operationId =
          op.operationId ?? `${method}_${path.replace(/\W+/g, '_')}`;
        out.push({
          content: lines.join('\n'),
          parentExternalId: ctx.sourceArtifactId,
          metadata: {
            operation_id: operationId,
            method: method.toUpperCase(),
            path,
            api_title: apiTitle,
            server_url: serverUrl,
            tags: op.tags ?? [],
            summary: op.summary ?? null,
          },
          aclSubjects,
        });
      }
    }

    return out;
  },
};
