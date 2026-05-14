---
name: technical-interview-prep
description: Prepare structured interview questions and evaluation criteria for a technical role candidate
tools:
  - search
  - bash
when_to_use: In the 24 hours before a technical interview for an engineering or data role
---

# Procedure

Step 1: Use `bash` (e.g. `cat /notion/people/job-descriptions/[role].md`) to pull the job description and the team's interview rubric; fall back to `search` if the path isn't known.
Step 2: Use `search` to find notes from previous interviews for the same role (query: "interview notes [role] [year]").
Step 3: Use `bash` (e.g. `cat /grain/[date]/[title]-[id].md`) on the recruiter screen recording if available to understand what was already assessed.
Step 4: Draft 3 technical problem statements calibrated to the seniority level (junior: concrete + guided, senior: open-ended + system design).
Step 5: Define evaluation criteria for each problem: what a strong answer looks like, what a red flag looks like.
Step 6: Add 2 behavioral questions drawn from the team's working-style rubric.
Step 7: Share the prepared interview guide with all interviewers 2+ hours before the interview.

## Examples

Senior backend engineer interview: system design question (design a rate limiter), coding question (LRU cache), behavioral (tell me about a time you disagreed with a technical decision).

Junior data analyst interview: SQL problem (top-N query), take-home analysis interpretation, behavioral (walk me through a project you're proud of).
