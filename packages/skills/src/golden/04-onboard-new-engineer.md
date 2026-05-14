---
name: onboard-new-engineer
description: Walk a new engineer through their first week setup and orient them to the team's workflows
tools:
  - search
  - bash
when_to_use: When a new engineer joins the team and needs to be set up with access, codebase context, and team processes
---

# Procedure

Step 1: Use `bash` (e.g. `cat /notion/engineering/onboarding-checklist.md`) to pull the latest onboarding checklist; fall back to `search` if the exact path isn't known.
Step 2: Verify the engineer has been granted access to: GitHub org, Slack workspace, Pylon (read-only), Notion workspace, and the staging environment.
Step 3: Use `search` to find the architecture overview document (query: "architecture overview system design").
Step 4: Share the three most recent incident postmortems so they understand the team's failure patterns.
Step 5: Assign a buddy engineer for the first 2 weeks; introduce them in #engineering Slack.
Step 6: Use `bash` (e.g. `cat /slack/#engineering-planning/[date]/thread-[ts].md`) on the last team planning thread to give context on current sprint priorities.
Step 7: Schedule a 30-minute codebase walkthrough for the end of day 2.

## Examples

New backend engineer joins. Gets GitHub + Slack + staging access on day 1; architecture doc shared; paired with the engineer who owns the service they'll work on.

New CS-facing engineer joins. Gets Pylon read-only access in addition to standard stack; introduced to the CS team lead in day-1 standup.
