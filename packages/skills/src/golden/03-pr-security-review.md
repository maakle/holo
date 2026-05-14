---
name: pr-security-review
description: Run a focused security review on a pull request before it is merged to main
tools:
  - search
  - bash
when_to_use: When a PR touches authentication, authorization, payment processing, data export, or third-party API integrations
---

# Procedure

Step 1: Use `bash` (e.g. `cat /github/[owner]/[repo]/pulls/[number].md`) to read the full diff, PR description, and reviewer comments.
Step 2: Check for hardcoded secrets, API keys, or credentials in the diff — flag any string that looks like a key pattern.
Step 3: Verify that new API endpoints enforce authentication (session check or API key validation) before any data access.
Step 4: Check that user-supplied inputs are validated and sanitized before use in SQL queries, shell commands, or file paths.
Step 5: Use `search` to find similar code patterns in the codebase that may have the same vulnerability (query: "the vulnerable pattern").
Step 6: Check that new third-party integrations do not log tokens or secrets to stdout/stderr.
Step 7: Document findings in the PR review comment with severity (Critical/High/Medium/Low) and the specific line reference.

## Examples

PR adds a new webhook endpoint. Review finds no authentication on the route — flag Critical, block merge until fixed.

PR adds an export feature that constructs a file path from a user-supplied field. Flag potential path traversal — High severity, require sanitization.
