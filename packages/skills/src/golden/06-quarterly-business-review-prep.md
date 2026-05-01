---
name: quarterly-business-review-prep
description: Prepare a customer QBR deck by gathering usage data, support history, and success metrics
tools:
  - search
  - get_ticket
  - get_call
when_to_use: In the two weeks before a scheduled QBR meeting with an Enterprise customer
---

# Procedure

Step 1: Use `search` to pull all support tickets for the customer in the past quarter (query: "[customer name] tickets").
Step 2: Use `get_ticket` on each P0/P1 ticket to summarize the incident, resolution time, and customer impact.
Step 3: Use `search` to find Grain call recordings with this customer (query: "[customer name] call").
Step 4: Use `get_call` on the most recent 2–3 calls to extract key themes: feature requests, complaints, praise.
Step 5: Compile: tickets opened, tickets resolved, avg resolution time, feature requests made, NPS if available.
Step 6: Draft a "What went well / What we'll improve" slide from the support and call data.
Step 7: Identify 1–2 expansion opportunities from call notes where the customer mentioned unmet needs.

## Examples

EGYM QBR prep: 3 tickets in Q1 (2 P2, 1 P1 resolved in 4h). Two calls where they mentioned needing better CSV export. Expansion opportunity: premium data export add-on.
