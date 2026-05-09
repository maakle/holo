import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveOpenAiModel, OPENAI_MODELS } from '../src/openai-models';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveOpenAiModel', () => {
  it('defaults to text-embedding-3-small when OPENAI_EMBEDDING_MODEL is unset', () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', '');
    expect(resolveOpenAiModel()).toEqual({
      api: 'text-embedding-3-small',
      tag: 'openai-3-small',
      dimensions: 1024,
    });
  });

  it('returns -small config when env=text-embedding-3-small', () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
    expect(resolveOpenAiModel()).toEqual({
      api: 'text-embedding-3-small',
      tag: 'openai-3-small',
      dimensions: 1024,
    });
  });

  it('returns -large config when env=text-embedding-3-large', () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large');
    expect(resolveOpenAiModel()).toEqual({
      api: 'text-embedding-3-large',
      tag: 'openai-3-large',
      dimensions: 1024,
    });
  });

  it('throws HOLO_ENV_INVALID on an unsupported model', () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-ada-002');
    expect(() => resolveOpenAiModel()).toThrow(
      expect.objectContaining({ code: 'HOLO_ENV_INVALID' }),
    );
  });

  it('throws HOLO_ENV_INVALID on a typo (case-sensitive)', () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'TEXT-EMBEDDING-3-SMALL');
    expect(() => resolveOpenAiModel()).toThrow(
      expect.objectContaining({ code: 'HOLO_ENV_INVALID' }),
    );
  });

  it('every entry in OPENAI_MODELS resolves cleanly', () => {
    for (const apiModel of Object.keys(OPENAI_MODELS)) {
      vi.stubEnv('OPENAI_EMBEDDING_MODEL', apiModel);
      const resolved = resolveOpenAiModel();
      expect(resolved.api).toBe(apiModel);
      expect(resolved.dimensions).toBe(1024);
      expect(resolved.tag).toBe(OPENAI_MODELS[apiModel as keyof typeof OPENAI_MODELS].tag);
    }
  });

  it('reads env on every call (not cached)', () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
    expect(resolveOpenAiModel().tag).toBe('openai-3-small');
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large');
    expect(resolveOpenAiModel().tag).toBe('openai-3-large');
  });
});
