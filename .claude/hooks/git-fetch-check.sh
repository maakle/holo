#!/usr/bin/env bash
# SessionStart hook: warn when the local working branch is behind its upstream.
# Silent when up-to-date. Always exits 0 so a network/git failure can't block the
# session from starting.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Best-effort fetch — don't block the session on slow networks.
git fetch origin --quiet 2>/dev/null

AHEAD=$(git log --oneline HEAD..@{upstream} 2>/dev/null | head -10)

if [ -n "$AHEAD" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null)
  echo "⚠️  $UPSTREAM is ahead of local $BRANCH:"
  echo "$AHEAD"
  echo ""
  echo "Run: git pull --ff-only"
fi

exit 0
