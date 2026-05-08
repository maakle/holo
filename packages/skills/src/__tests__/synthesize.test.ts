import { describe, it, expect } from 'vitest';
import { synthesizeSkill } from '../synthesize';

describe('synthesizeSkill', () => {
  it('throws HOLO_INVALID_INPUT when fewer than 2 artifacts provided', async () => {
    await expect(
      synthesizeSkill({
        skillSlug: 'test-skill',
        labeledArtifacts: [{ artifactId: 'a1', kind: 'thread', content: 'content' }],
        apiKey: 'sk-ant-fake',
      }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });

  it('throws HOLO_INVALID_INPUT when zero artifacts provided', async () => {
    await expect(
      synthesizeSkill({
        skillSlug: 'test-skill',
        labeledArtifacts: [],
        apiKey: 'sk-ant-fake',
      }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });
});
