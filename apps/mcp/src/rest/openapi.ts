export const openApiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'Holo REST API',
    version: '0.1.0',
    description: 'Agent context layer REST surface',
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'holo_<hex>',
      },
    },
    schemas: {
      Skill: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
          version: { type: 'integer' },
          status: { type: 'string', enum: ['draft', 'active', 'archived'] },
          description: { type: 'string' },
        },
        required: ['id', 'name', 'slug', 'version', 'status'],
      },
      SkillDetail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
          version: { type: 'integer' },
          status: { type: 'string', enum: ['draft', 'active', 'archived'] },
          content: { type: 'string' },
        },
        required: ['id', 'name', 'slug', 'version', 'status', 'content'],
      },
      SearchResult: {
        type: 'object',
        properties: {
          chunk_id: { type: 'string' },
          content: { type: 'string' },
          score: { type: 'number' },
          source: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              artifact_kind: { type: 'string' },
              metadata: { type: 'object' },
            },
            required: ['provider', 'artifact_kind', 'metadata'],
          },
          snippet_url: { type: 'string', format: 'uri' },
        },
        required: ['chunk_id', 'content', 'score', 'source'],
      },
      Error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['code', 'problem', 'fix'],
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/v1/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check',
        description: 'Returns service health status. No authentication required.',
        security: [],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    version: { type: 'string', example: '0.1' },
                  },
                  required: ['status', 'version'],
                },
              },
            },
          },
        },
      },
    },
    '/v1/skills': {
      get: {
        operationId: 'listSkills',
        summary: 'List skills',
        description: 'Returns active skills for the authenticated organization.',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['draft', 'active', 'archived'],
              default: 'active',
            },
            description: 'Filter by skill status',
          },
        ],
        responses: {
          '200': {
            description: 'List of skills',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    skills: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Skill' },
                    },
                  },
                  required: ['skills'],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/v1/skills/{slug}': {
      get: {
        operationId: 'getSkill',
        summary: 'Get skill by slug',
        description: 'Returns a single skill by its slug.',
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Skill slug',
          },
        ],
        responses: {
          '200': {
            description: 'Skill detail',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    skill: {
                      oneOf: [
                        { $ref: '#/components/schemas/SkillDetail' },
                        { type: 'null' },
                      ],
                    },
                  },
                  required: ['skill'],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '404': {
            description: 'Skill not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/v1/search': {
      post: {
        operationId: 'search',
        summary: 'Search context',
        description: 'Semantic search across ingested context for the authenticated organization.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  query: { type: 'string', minLength: 1 },
                  limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
                },
                required: ['query'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SearchResult' },
                    },
                  },
                  required: ['results'],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
  },
};
