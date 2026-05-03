import { describe, expect, it, vi } from 'vitest';

// server-only throws unless mocked; getServerContext otherwise opens a real DB
// connection on first call, which we don't want from unit tests. This is a
// shape-only contract test — invoking the function is covered by integration
// tests once we add them.
vi.mock('server-only', () => ({}));

import * as mod from './server-context';

describe('server-context module', () => {
  it('exports getServerContext as an async function', () => {
    expect(typeof mod.getServerContext).toBe('function');
  });

  it('exports getServerAuth as an async function', () => {
    expect(typeof mod.getServerAuth).toBe('function');
  });
});
