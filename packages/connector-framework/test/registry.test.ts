import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { defineConnector } from '../src/define-connector';
import { apiKey } from '../src/auth/api-key';
import {
  registerSpecs,
  getSpec,
  listSpecs,
  __resetRegistryForTests,
} from '../src/registry';

const a = defineConnector({
  id: 'a',
  displayName: 'A',
  sync: { intervalMs: 60_000 },
  auth: apiKey(),
  async testConnection() {
    return { externalId: '', name: '' };
  },
  resources: [
    {
      id: 'r',
      cursorSchema: z.object({}).default({}),
      async sync() {
        return {};
      },
    },
  ],
});
const b = defineConnector({ ...a, id: 'b', displayName: 'B' });

describe('registry', () => {
  beforeEach(() => __resetRegistryForTests());

  it('registers and looks up specs by id', () => {
    registerSpecs([a, b]);
    expect(getSpec('a')).toBe(a);
    expect(getSpec('b')).toBe(b);
    expect(listSpecs()).toHaveLength(2);
  });

  it('throws on unknown id', () => {
    registerSpecs([a]);
    expect(() => getSpec('missing')).toThrow();
  });

  it('is idempotent for the same spec object', () => {
    registerSpecs([a]);
    registerSpecs([a]);
    expect(listSpecs()).toHaveLength(1);
  });

  it('rejects a colliding id with a different object', () => {
    registerSpecs([a]);
    const aPrime = defineConnector({ ...a });
    expect(() => registerSpecs([aPrime])).toThrow();
  });
});
