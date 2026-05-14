---
name: write-postmortem
description: Write a blameless post-incident report after a production incident is resolved
tools:
  - search
  - bash
when_to_use: After a P0 or P1 incident has been resolved and the on-call engineer is ready to document what happened
---

# Procedure

Step 1: Use `bash` (e.g. `cat /slack/#incidents/[date]/thread-[ts].md`) on the incident Slack thread to collect the timeline of events, actions taken, and who was involved.
Step 2: Use `search` to find the PR or deploy that introduced the regression (query: "[affected service] deploy OR migration [date range]").
Step 3: Use `bash` (e.g. `cat /github/[owner]/[repo]/pulls/[number].md`) on the identified change to understand what was modified and why.
Step 4: Draft the postmortem with sections: Summary, Timeline (UTC timestamps), Root Cause, Contributing Factors, Impact (duration, affected accounts), Resolution, Action Items.
Step 5: Each action item must have an owner and a due date; no floating "we should fix X" items.
Step 6: Share the draft in #engineering for 24h async review before publishing to Notion.
Step 7: Use `bash` (e.g. `cat /notion/engineering/postmortem-template.md`) to find the postmortem template and copy its structure; fall back to `search` if the path isn't known.

## Examples

Database connection pool exhaustion caused 45-minute outage. Timeline reconstructed from incident Slack thread; root cause traced to a migration that set pool size to 1. Action items: fix pool config, add pool monitoring alert, add runbook.
