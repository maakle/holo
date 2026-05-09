import { describe, it, expectTypeOf } from 'vitest';
import type { Embedder } from '../src/contract';

describe('Embedder contract', () => {
  it('exposes model + dimensions readonly fields and an embed method', () => {
    expectTypeOf<Embedder>().toMatchTypeOf<{
      readonly model: 'openai-3-small' | 'voyage-code-3';
      readonly dimensions: 1024;
      embed(texts: string[]): Promise<number[][]>;
    }>();
  });
});
