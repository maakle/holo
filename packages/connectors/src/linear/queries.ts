/**
 * GraphQL query strings for the Linear connector. Kept as separate exports
 * so they can be inspected at build time and reused from tests.
 *
 * Linear's GraphQL API uses the Connection pattern for pagination:
 *   { pageInfo: { hasNextPage, endCursor }, nodes: [...] }
 *
 * Incremental syncs filter by `updatedAt: { gte: $since }` and order by
 * `updatedAt` so we can advance the cursor monotonically.
 */

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
  query Issues($after: String, $since: DateTime) {
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
