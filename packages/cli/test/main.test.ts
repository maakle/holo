import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/main.js';

describe('holo CLI', () => {
  it('builds a program with name "holo"', () => {
    const program = buildProgram();
    expect(program.name()).toBe('holo');
  });

  it('registers allowlist subcommand', () => {
    const program = buildProgram();
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain('allowlist');
  });

  it('registers sync subcommand', () => {
    const program = buildProgram();
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain('sync');
  });

  it('allowlist subcommand has add/remove/list children', () => {
    const program = buildProgram();
    const allowlist = program.commands.find((c) => c.name() === 'allowlist');
    expect(allowlist).toBeDefined();
    const sub = allowlist!.commands.map((c) => c.name());
    expect(sub).toEqual(expect.arrayContaining(['add', 'remove', 'list']));
  });
});
