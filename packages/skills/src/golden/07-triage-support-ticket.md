---
name: triage-support-ticket
description: Triage an incoming support ticket — classify severity, assign owner, and send acknowledgement
tools:
  - search
  - get_ticket
  - get_thread
when_to_use: When a new support ticket arrives in Pylon and needs initial triage within the SLA window
---

# Procedure

Step 1: Use `get_ticket` to read the full ticket body, subject, and any attachments.
Step 2: Check the customer's contract tier from ticket metadata (Enterprise SLA: 2h first response; SMB SLA: 8h).
Step 3: Use `search` to check if this is a known issue or duplicate (query: "[error text or feature] known issue OR duplicate").
Step 4: Classify severity: P0 (data loss or full service down), P1 (major feature broken), P2 (degraded, workaround available), P3 (question or cosmetic issue).
Step 5: If duplicate of a known issue, reply with the known-issue template and link to the tracking ticket.
Step 6: If novel, assign to the team member who owns the affected area and add [P0]/[P1]/[P2]/[P3] label.
Step 7: Send acknowledgement reply within the SLA window confirming receipt and expected next update.

## Examples

Enterprise customer reports login failures for all users. P0 — immediately page on-call, reply within 15 minutes with incident tracking number.

SMB customer asks how to export data in a format they can import to Excel. P3 — reply with documentation link, no escalation needed.
