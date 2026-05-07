/**
 * Linear API helpers built on the framework's HttpClient.
 *
 * Linear is GraphQL-only and surfaces errors *inside* a 200 envelope as
 * `{ errors: [...] }`. The framework's status-based error handling doesn't
 * trigger for those, so the spec uses `graphql()` here to inspect the
 * envelope and convert errors into HoloErrors uniformly.
 */
import { ErrorCode, holoError } from '@holo/errors';
import type { HttpClient } from '@holo/connector-framework';
import type { GraphqlEnvelope } from './types';

const GRAPHQL_PATH = '/graphql';

export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer {
      id
      name
      email
      organization {
        id
        name
        urlKey
      }
    }
  }
`;

export const ISSUES_QUERY = /* GraphQL */ `
  query Issues($after: String, $since: DateTimeOrDuration) {
    issues(
      first: 50
      after: $after
      filter: { updatedAt: { gte: $since } }
      orderBy: updatedAt
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        title
        description
        url
        priority
        priorityLabel
        createdAt
        updatedAt
        state {
          id
          name
          type
        }
        assignee {
          id
          name
          email
        }
        team {
          id
          name
          key
        }
        project {
          id
          name
        }
        labels {
          nodes {
            id
            name
          }
        }
      }
    }
  }
`;

export async function graphql<T>(
  api: HttpClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const envelope = await api.post<GraphqlEnvelope<T>>(GRAPHQL_PATH, {
    query,
    variables,
  });
  if (envelope.errors && envelope.errors.length > 0) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `Linear GraphQL: ${envelope.errors.map((e) => e.message).join('; ')}`,
      fix: 'If this persists, check Linear app permissions and OAuth scope.',
    });
  }
  if (!envelope.data) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: 'Linear GraphQL response had no `data` field',
      fix: 'Retry the sync; if it persists, check Linear status.',
    });
  }
  return envelope.data;
}
