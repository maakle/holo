#!/bin/sh
# Usage: echo-tool.sh [argv...]
# Prints each argv on its own line, then a separator, then selected env vars.
for a in "$@"; do
  printf '%s\n' "$a"
done
printf -- '---ENV---\n'
printf 'CUSTOM_TOOLS_TEST_FOO=%s\n' "${CUSTOM_TOOLS_TEST_FOO-}"
printf 'CUSTOM_TOOLS_TEST_BAR=%s\n' "${CUSTOM_TOOLS_TEST_BAR-}"
printf 'CUSTOM_TOOLS_TEST_SECRET=%s\n' "${CUSTOM_TOOLS_TEST_SECRET-}"
