/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow bare 'throw new Error(...)'; use holoError() from '@holo/errors' instead.",
    },
    schema: [],
    messages: {
      bareError:
        "Bare 'throw new Error()' is forbidden in holo. Use holoError() from '@holo/errors'.",
    },
  },
  create(ctx) {
    return {
      ThrowStatement(node) {
        const arg = node.argument;
        if (!arg) return;
        if (
          arg.type === 'NewExpression' &&
          arg.callee &&
          arg.callee.type === 'Identifier' &&
          arg.callee.name === 'Error'
        ) {
          ctx.report({ node, messageId: 'bareError' });
        }
      },
    };
  },
};
