const { RuleTester } = require('eslint');
const rule = require('../rules/no-bare-throw-error.js');

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

tester.run('no-bare-throw-error', rule, {
  valid: [
    "throw holoError({ code: 'X', problem: 'p', fix: 'f' });",
    "throw new TypeError('not Error');",
    "function f() { return new Error('ok in non-throw'); }",
  ],
  invalid: [
    { code: "throw new Error('boom');", errors: [{ messageId: 'bareError' }] },
    { code: "if (true) { throw new Error('x'); }", errors: [{ messageId: 'bareError' }] },
  ],
});

console.log('no-bare-throw-error tests passed');
