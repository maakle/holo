---
name: escalate-critical-bug
description: Escalate a production bug report from a customer to the engineering team with full context
tools:
  - search
  - get_ticket
  - get_thread
when_to_use: When a customer reports a bug that causes data loss, complete feature unavailability, or affects more than one account
---

# Procedure

Step 1: Use `get_ticket` to read the full bug report including reproduction steps and affected account details.
Step 2: Use `search` to check for duplicate reports (query: "[error message or feature name] bug OR broken OR not working").
Step 3: Use `get_thread` on the customer's most recent Slack support thread to gather any additional context shared there.
Step 4: Classify severity: P0 (data loss or full outage), P1 (major feature broken for 1+ customers), P2 (degraded but workaround exists).
Step 5: For P0/P1, page the on-call engineer via Slack #incidents with the ticket URL, affected accounts, and severity classification.
Step 6: For P2, create a GitHub issue in the correct repo with the [Bug] label and link it in the ticket.
Step 7: Reply to the customer with the incident number and a status page link; do not give ETAs without eng confirmation.

## Examples

Customer reports that CSV exports contain empty rows for all records since yesterday's deploy. Affects 3 enterprise accounts. P1 — page on-call, open incident channel.

Customer reports a button label is wrong in a rarely-used settings panel. P2 — file GitHub issue, reply with tracking number.
