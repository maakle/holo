import { describe, it, expect } from 'vitest';
import { createCustomTool } from '../src/repository.js';

describe('createCustomTool name validation', () => {
  // We never reach the DB — the name check throws first, so a stub `db` is fine.
  const fakeDb = {} as Parameters<typeof createCustomTool>[0];
  const baseInput = {
    organizationId: '00000000-0000-0000-0000-000000000001',
    createdBy: '00000000-0000-0000-0000-000000000002',
    description: 'd',
    command: 'echo',
    argsTemplate: [] as string[],
    inputSchema: { type: 'object' as const },
    envAllowlist: [] as string[],
    scope: null,
    readOnly: true,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  };

  it.each([
    'search',
    'get_pr',
    'get_thread',
    'get_doc',
    'get_call',
    'get_ticket',
    'list_skills',
    'get_skill',
    'execute_skill',
  ])('rejects built-in tool name %s', async (name) => {
    await expect(createCustomTool(fakeDb, { ...baseInput, name })).rejects.toThrow(/built-in/i);
  });

  it('rejects invalid name shape', async () => {
    await expect(
      createCustomTool(fakeDb, { ...baseInput, name: 'Has-Caps' }),
    ).rejects.toThrow(/invalid/i);
    await expect(createCustomTool(fakeDb, { ...baseInput, name: 'ab' })).rejects.toThrow(
      /invalid/i,
    ); // too short
  });

  it('rejects timeout above ceiling', async () => {
    await expect(
      createCustomTool(fakeDb, { ...baseInput, name: 'fine_name', timeoutMs: 70_000 }),
    ).rejects.toThrow(/60000/);
  });
});
