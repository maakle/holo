---
name: handle-refund-request
description: Process a customer refund or credit request end-to-end through the support queue
tools:
  - search
  - bash
when_to_use: When a customer contacts support requesting a full or partial refund, service credit, or billing dispute resolution
---

# Procedure

Step 1: Use `search` to pull the customer's full ticket history (query: "[customer name] refund OR credit OR billing").
Step 2: Use `bash` (e.g. `cat /pylon/tickets/[ticket id].md`) on the most recent open ticket to read the stated reason and attached context.
Step 3: Check contract tier from ticket metadata — Enterprise customers can receive credits up to 30 days without manager approval; SMB customers cap at 7 days.
Step 4: If the refund amount is ≤ $500, process directly in Pylon and reply with the confirmation template.
Step 5: If the refund amount is > $500 or involves a disputed contract clause, escalate to the AE who owns the account.
Step 6: Update the ticket status to "Refund Processed" or "Escalated" and add an internal note with reasoning.

## Examples

Customer reports they were charged for a seat their employee left 3 months ago. Credit of 3 months × seat price = $297 — under $500 threshold — process directly.

Customer claims service was down for 2 weeks and wants a full month refund ($4,200 Enterprise contract). Escalate to AE + VP CS; draft acknowledgement reply but do not commit to amount.
