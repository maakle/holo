---
name: handle-churn-risk
description: Identify and respond to a customer showing churn signals before their renewal date
tools:
  - search
  - bash
when_to_use: When a customer shows churn signals — reduced engagement, negative NPS, competitor mentions, or escalated support activity — within 90 days of renewal
---

# Procedure

Step 1: Use `search` to gather all recent tickets and call recordings for the customer (query: "[customer name] last 90 days").
Step 2: Use `bash` (e.g. `cat /pylon/tickets/[ticket id].md`) on any tickets referencing cancellation, competitor, or dissatisfaction to read the full context.
Step 3: Use `bash` (e.g. `cat /grain/[date]/[title]-[id].md`) on the most recent call recording to understand their current sentiment and stated pain points.
Step 4: Score churn risk: High (3+ negative signals), Medium (1–2 signals), Low (single anomalous signal).
Step 5: For High risk: schedule an executive call within 5 business days with the AE and VP CS present.
Step 6: For Medium risk: assign a save play — a targeted outreach from the AE with a specific value prop or roadmap preview.
Step 7: Document the save strategy in the CRM deal note with expected renewal outcome and next action date.

## Examples

MrWork has opened 4 tickets in 30 days, NPS dropped to 4, and a Grain call shows them mentioning a competitor. High risk — schedule exec call this week, prepare concession options.
