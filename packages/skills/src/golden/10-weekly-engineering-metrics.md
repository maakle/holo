---
name: weekly-engineering-metrics
description: Compile the weekly engineering health report covering deploy frequency, incident count, and open P0/P1 issues
tools:
  - search
  - bash
when_to_use: Every Monday morning to prepare the engineering weekly report shared with leadership
---

# Procedure

Step 1: Use `search` to find all PRs merged to main in the past 7 days (query: "merged last week main branch").
Step 2: Use `search` to find all incidents opened and resolved in the past 7 days (query: "incident P0 OR P1 last 7 days").
Step 3: Use `bash` (e.g. `cat /slack/#incidents/[date]/thread-[ts].md`) on any open incident threads to get current status.
Step 4: Count: PRs merged, deploys to production, P0 incidents, P1 incidents, mean time to resolve (MTTR) for resolved incidents.
Step 5: Use `search` to find any open GitHub issues labeled [P0] or [P1] that are not yet resolved.
Step 6: Draft the weekly report: deploy frequency, incident summary, open critical issues, one engineering highlight, one risk to flag.
Step 7: Post the report to #engineering-leadership before the Monday standup.

## Examples

Week of Apr 28: 23 PRs merged, 4 production deploys, 0 P0s, 1 P1 (resolved in 2h), 2 open P2s. Highlight: shipped improved CSV export. Risk: database migration scheduled for Thursday during peak hours.
