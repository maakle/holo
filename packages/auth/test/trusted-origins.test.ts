import { describe, it, expect } from 'vitest';
import { parseTrustedOrigins } from '../src/server';

describe('parseTrustedOrigins', () => {
  it('returns [] when undefined', () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
  });

  it('returns [] when empty string', () => {
    expect(parseTrustedOrigins('')).toEqual([]);
  });

  it('parses a single origin', () => {
    expect(parseTrustedOrigins('http://localhost:3000')).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('parses comma-separated origins', () => {
    expect(
      parseTrustedOrigins('http://localhost:3000,https://abc.ngrok-free.dev'),
    ).toEqual(['http://localhost:3000', 'https://abc.ngrok-free.dev']);
  });

  it('trims whitespace around entries', () => {
    expect(
      parseTrustedOrigins('  http://localhost:3000 , https://abc.ngrok-free.dev '),
    ).toEqual(['http://localhost:3000', 'https://abc.ngrok-free.dev']);
  });

  it('strips trailing slashes', () => {
    expect(parseTrustedOrigins('http://localhost:3000/')).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('dedupes entries that differ only in trailing slash', () => {
    expect(
      parseTrustedOrigins('http://localhost:3000,http://localhost:3000/'),
    ).toEqual(['http://localhost:3000']);
  });

  it('drops empty segments from trailing or doubled commas', () => {
    expect(parseTrustedOrigins('http://localhost:3000,,')).toEqual([
      'http://localhost:3000',
    ]);
  });
});
