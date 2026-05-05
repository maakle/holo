// packages/discovery/src/__tests__/propose.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proposeProcedureName } from '../propose.js';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

describe('proposeProcedureName', () => {
  beforeEach(() => mockCreate.mockReset());

  it('parses slug, name, and summary from Claude output', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: 'slug: handle-enterprise-refund\nname: Handle Enterprise Refund\nsummary: Customer requests refund, sales reviews HubSpot deal, support replies on Slack.',
        },
      ],
    });

    const result = await proposeProcedureName({
      apiKey: 'k',
      artifacts: [
        { kind: 'slack.message', content: 'customer asking about refund' },
        { kind: 'hubspot.deal', content: 'Acme Corp - $50k' },
        { kind: 'grain.meeting', content: 'Discussed refund options' },
      ],
    });

    expect(result.proposedSlug).toBe('handle-enterprise-refund');
    expect(result.proposedName).toBe('Handle Enterprise Refund');
    expect(result.summary).toContain('refund');
  });

  it('throws if Claude output is truncated', async () => {
    mockCreate.mockResolvedValue({ stop_reason: 'max_tokens', content: [] });
    await expect(
      proposeProcedureName({ apiKey: 'k', artifacts: [{ kind: 'x', content: 'y' }] }),
    ).rejects.toThrow();
  });
});
