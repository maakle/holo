import { describe, it, expect } from 'vitest';
import { processIssue, processProject } from '../../src/jira/chunking';
import type {
  JiraIssue,
  JiraProject,
} from '../../src/jira/types';
import type { ChunkUpsert, ResourceSyncContext } from '@holo/connector-framework';

function makeCtx() {
  const upserts: ChunkUpsert[] = [];
  const ctx = {
    organizationId: 'org-1',
    upsert: async (chunk: ChunkUpsert) => {
      upserts.push(chunk);
    },
  } as unknown as ResourceSyncContext<unknown>;
  return { ctx, upserts };
}

const issueWithComment: JiraIssue = {
  id: '10001',
  key: 'ENG-1',
  self: 'https://acme.atlassian.net/rest/api/3/issue/10001',
  fields: {
    summary: 'Hook up retrieval health endpoint',
    description: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Wire the dashboard to /api/health.' }],
        },
      ],
    },
    status: {
      id: '1',
      name: 'In Progress',
      statusCategory: { key: 'indeterminate', name: 'In Progress' },
    },
    issuetype: { id: '10001', name: 'Story' },
    priority: { id: '3', name: 'Medium' },
    assignee: { accountId: 'u-jane', displayName: 'Jane Doe' },
    reporter: { accountId: 'u-mike', displayName: 'Mike Smith' },
    project: { id: 'p-1', key: 'ENG', name: 'Engineering' },
    labels: ['backend', 'p1'],
    created: '2026-05-01T09:00:00.000+0000',
    updated: '2026-05-09T15:22:00.000+0000',
    comment: {
      total: 1,
      comments: [
        {
          id: 'c-100',
          author: { accountId: 'u-jane', displayName: 'Jane Doe' },
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Should we cache the result?' }],
              },
            ],
          },
          created: '2026-05-09T14:00:00.000+0000',
          updated: '2026-05-09T14:00:00.000+0000',
        },
      ],
    },
  },
};

const issueNoDescriptionNoComments: JiraIssue = {
  id: '10002',
  key: 'ENG-2',
  self: 'https://acme.atlassian.net/rest/api/3/issue/10002',
  fields: {
    summary: 'Document the worker queue topology',
    description: null,
    status: {
      id: '10',
      name: 'Done',
      statusCategory: { key: 'done', name: 'Done' },
    },
    issuetype: { id: '10002', name: 'Task' },
    priority: null,
    assignee: null,
    reporter: { accountId: 'u-mike', displayName: 'Mike Smith' },
    project: { id: 'p-1', key: 'ENG', name: 'Engineering' },
    labels: [],
    created: '2026-05-02T09:00:00.000+0000',
    updated: '2026-05-08T12:00:00.000+0000',
    comment: { total: 0, comments: [] },
  },
};

const project: JiraProject = {
  id: 'p-1',
  key: 'ENG',
  name: 'Engineering',
  projectTypeKey: 'software',
  description: 'Backend & infra.',
  lead: { accountId: 'u-jane', displayName: 'Jane Doe' },
};

describe('processIssue', () => {
  it('emits one issue chunk and one comment chunk for an issue with one comment', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts).toHaveLength(2);
    expect(upserts[0].kind).toBe('jira-issue');
    expect(upserts[1].kind).toBe('jira-comment');
  });

  it('issue chunk content has the bracketed key, summary, meta row, and description', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    const [issueChunk] = upserts;
    expect(issueChunk.content).toContain('[ENG-1] Hook up retrieval health endpoint');
    expect(issueChunk.content).toContain('Status: In Progress');
    expect(issueChunk.content).toContain('Type: Story');
    expect(issueChunk.content).toContain('Priority: Medium');
    expect(issueChunk.content).toContain('Assignee: Jane Doe');
    expect(issueChunk.content).toContain('Project: Engineering');
    expect(issueChunk.content).toContain('Labels: backend, p1');
    expect(issueChunk.content).toContain('Wire the dashboard to /api/health.');
  });

  it('uses jira:project:{id} and jira:org as ACL subjects', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts[0].aclSubjects).toEqual(['org:org-1', 'jira:project:p-1', 'jira:org']);
    expect(upserts[1].aclSubjects).toEqual(['org:org-1', 'jira:project:p-1', 'jira:org']);
  });

  it('comment chunk shares the parent issue sourceArtifactId so cascades work', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts[1].sourceArtifactId).toBe('jira-issue:10001');
    expect(upserts[1].externalId).toBe('10001:c-100');
  });

  it('issue metadata includes browse URL built from the site URL', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts[0].metadata.url).toBe('https://acme.atlassian.net/browse/ENG-1');
  });

  it('handles an issue with no description, no assignee, no priority, no comments', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueNoDescriptionNoComments, 'https://acme.atlassian.net');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].kind).toBe('jira-issue');
    expect(upserts[0].content).toContain('[ENG-2] Document the worker queue topology');
    expect(upserts[0].content).not.toContain('Priority:');
    expect(upserts[0].content).not.toContain('Assignee:');
    expect(upserts[0].content).not.toContain('Labels:');
  });
});

describe('processProject', () => {
  it('emits a jira-project chunk with key, name, lead, description', async () => {
    const { ctx, upserts } = makeCtx();
    await processProject(ctx, project, 'https://acme.atlassian.net');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].kind).toBe('jira-project');
    expect(upserts[0].content).toContain('[ENG] Engineering');
    expect(upserts[0].content).toContain('Type: software');
    expect(upserts[0].content).toContain('Lead: Jane Doe');
    expect(upserts[0].content).toContain('Backend & infra.');
    expect(upserts[0].aclSubjects).toEqual(['org:org-1', 'jira:org']);
    expect(upserts[0].metadata.url).toBe('https://acme.atlassian.net/jira/projects/ENG');
  });
});
