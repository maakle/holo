import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  resolveAnthropicAgentModel,
  resolveAnthropicUtilityModel,
} from '../src/anthropic-models';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAnthropicAgentModel', () => {
  it('defaults to claude-sonnet-4-6 when ANTHROPIC_AGENT_MODEL is unset', () => {
    vi.stubEnv('ANTHROPIC_AGENT_MODEL', '');
    expect(resolveAnthropicAgentModel()).toBe('claude-sonnet-4-6');
  });

  it('returns the env value when set', () => {
    vi.stubEnv('ANTHROPIC_AGENT_MODEL', 'claude-opus-4-7');
    expect(resolveAnthropicAgentModel()).toBe('claude-opus-4-7');
  });

  it('reads env on every call (not cached)', () => {
    vi.stubEnv('ANTHROPIC_AGENT_MODEL', 'claude-sonnet-4-6');
    expect(resolveAnthropicAgentModel()).toBe('claude-sonnet-4-6');
    vi.stubEnv('ANTHROPIC_AGENT_MODEL', 'claude-opus-4-7');
    expect(resolveAnthropicAgentModel()).toBe('claude-opus-4-7');
  });
});

describe('resolveAnthropicUtilityModel', () => {
  it('defaults to claude-haiku-4-5-20251001 when unset', () => {
    vi.stubEnv('ANTHROPIC_UTILITY_MODEL', '');
    expect(resolveAnthropicUtilityModel()).toBe('claude-haiku-4-5-20251001');
  });

  it('returns the env value when set', () => {
    vi.stubEnv('ANTHROPIC_UTILITY_MODEL', 'claude-haiku-4-6');
    expect(resolveAnthropicUtilityModel()).toBe('claude-haiku-4-6');
  });

  it('agent and utility env vars are independent', () => {
    vi.stubEnv('ANTHROPIC_AGENT_MODEL', 'claude-opus-4-7');
    vi.stubEnv('ANTHROPIC_UTILITY_MODEL', 'claude-sonnet-4-6');
    expect(resolveAnthropicAgentModel()).toBe('claude-opus-4-7');
    expect(resolveAnthropicUtilityModel()).toBe('claude-sonnet-4-6');
  });
});
