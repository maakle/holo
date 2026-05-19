import { describe, it, expect } from 'vitest';
import { shouldIndex, extToLanguage } from '../src/code-skip';

const text = Buffer.from('hello world\n');
const binary = Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]); // contains null byte

describe('shouldIndex', () => {
  it('accepts a normal TypeScript file', () => {
    expect(shouldIndex('src/index.ts', 100, text)).toBe(true);
  });

  it('accepts a Python file', () => {
    expect(shouldIndex('lib/app.py', 100, text)).toBe(true);
  });

  it('accepts README.md', () => {
    expect(shouldIndex('README.md', 100, text)).toBe(true);
  });

  it('accepts a YAML config file', () => {
    expect(shouldIndex('.github/workflows/ci.yml', 100, text)).toBe(true);
  });

  it('rejects node_modules', () => {
    expect(shouldIndex('node_modules/lodash/index.js', 100, text)).toBe(false);
  });

  it('rejects dist directory', () => {
    expect(shouldIndex('dist/bundle.js', 100, text)).toBe(false);
  });

  it('rejects __pycache__', () => {
    expect(shouldIndex('app/__pycache__/foo.pyc', 100, text)).toBe(false);
  });

  it('rejects package-lock.json', () => {
    expect(shouldIndex('package-lock.json', 100, text)).toBe(false);
  });

  it('rejects pnpm-lock.yaml', () => {
    expect(shouldIndex('pnpm-lock.yaml', 100, text)).toBe(false);
  });

  it('rejects go.sum', () => {
    expect(shouldIndex('go.sum', 100, text)).toBe(false);
  });

  it('rejects file over 1MB', () => {
    expect(shouldIndex('src/big.ts', 1_100_000, text)).toBe(false);
  });

  it('rejects binary file (null byte)', () => {
    expect(shouldIndex('image.png', 100, binary)).toBe(false);
  });

  it('rejects .png extension', () => {
    expect(shouldIndex('assets/logo.png', 100, text)).toBe(false);
  });

  it('rejects unknown extension', () => {
    expect(shouldIndex('src/foo.xyz', 100, text)).toBe(false);
  });

  it('accepts file with no extension (e.g. Makefile)', () => {
    expect(shouldIndex('Makefile', 100, text)).toBe(true);
  });

  it('accepts deeply nested TypeScript file', () => {
    expect(shouldIndex('apps/worker/src/queues/sync.ts', 500, text)).toBe(true);
  });

  it('rejects .venv directory', () => {
    expect(shouldIndex('.venv/lib/python3.11/site-packages/foo.py', 100, text)).toBe(false);
  });
});

describe('extToLanguage', () => {
  it('maps .ts to typescript', () => expect(extToLanguage('foo.ts')).toBe('typescript'));
  it('maps .tsx to tsx', () => expect(extToLanguage('comp.tsx')).toBe('tsx'));
  it('maps .py to python', () => expect(extToLanguage('app.py')).toBe('python'));
  it('maps .go to go', () => expect(extToLanguage('main.go')).toBe('go'));
  it('maps .rs to rust', () => expect(extToLanguage('lib.rs')).toBe('rust'));
  it('maps unknown to text', () =>
    expect(extToLanguage('something.unknownext')).toBe('text'));
  it('maps .sql to sql', () => expect(extToLanguage('schema.sql')).toBe('sql'));
  it('maps .yaml to yaml', () => expect(extToLanguage('config.yaml')).toBe('yaml'));
  it('maps Dockerfile (no ext) to dockerfile', () =>
    expect(extToLanguage('services/web/Dockerfile')).toBe('dockerfile'));
  it('maps Makefile (no ext) to makefile', () =>
    expect(extToLanguage('Makefile')).toBe('makefile'));
});
