import { describe, it, expect } from 'vitest';
import {
  asDirPrefix,
  basename,
  dirname,
  nextSegmentAfter,
  normalizePath,
} from '../src/path';
import { FsError } from '../src/errors';

describe('normalizePath', () => {
  it('accepts a clean absolute path', () => {
    expect(normalizePath('/slack/#engineering/2026-05-14/thread-1.md')).toBe(
      '/slack/#engineering/2026-05-14/thread-1.md',
    );
  });
  it('collapses repeated slashes', () => {
    expect(normalizePath('/slack//#engineering///thread-1.md')).toBe(
      '/slack/#engineering/thread-1.md',
    );
  });
  it('drops single-dot segments', () => {
    expect(normalizePath('/slack/./threads/./.')).toBe('/slack/threads');
  });
  it('returns root for `/`', () => {
    expect(normalizePath('/')).toBe('/');
  });
  it('rejects empty string', () => {
    expect(() => normalizePath('')).toThrow(FsError);
  });
  it('rejects relative paths', () => {
    expect(() => normalizePath('slack/foo')).toThrow(/absolute/);
  });
  it('rejects `..` traversal even when nested', () => {
    expect(() => normalizePath('/slack/../etc/passwd')).toThrow(/traversal/);
  });
  it('rejects control characters', () => {
    const withNul = '/slack/' + String.fromCharCode(0);
    expect(() => normalizePath(withNul)).toThrow(/control/);
    const withTab = '/slack/' + String.fromCharCode(9);
    expect(() => normalizePath(withTab)).toThrow(/control/);
    const withDel = '/slack/' + String.fromCharCode(0x7f);
    expect(() => normalizePath(withDel)).toThrow(/control/);
  });
});

describe('dirname / basename', () => {
  it('dirname strips the last segment', () => {
    expect(dirname('/slack/#engineering/thread-1.md')).toBe('/slack/#engineering');
    expect(dirname('/slack')).toBe('/');
    expect(dirname('/')).toBe('/');
  });
  it('basename returns the last segment', () => {
    expect(basename('/slack/#engineering/thread-1.md')).toBe('thread-1.md');
    expect(basename('/')).toBe('');
  });
});

describe('asDirPrefix', () => {
  it('adds a trailing slash to non-root paths', () => {
    expect(asDirPrefix('/slack')).toBe('/slack/');
    expect(asDirPrefix('/slack/')).toBe('/slack/');
  });
  it('keeps root as `/`', () => {
    expect(asDirPrefix('/')).toBe('/');
  });
});

describe('nextSegmentAfter', () => {
  it('returns the segment immediately after the prefix', () => {
    expect(nextSegmentAfter('/slack/', '/slack/#engineering/2026-05-14/thread-1.md')).toBe(
      '#engineering',
    );
  });
  it('returns the leaf when no further slash', () => {
    expect(nextSegmentAfter('/slack/#engineering/', '/slack/#engineering/thread-1.md')).toBe(
      'thread-1.md',
    );
  });
  it('returns null when path does not start with prefix', () => {
    expect(nextSegmentAfter('/slack/', '/notion/page.md')).toBeNull();
  });
});
