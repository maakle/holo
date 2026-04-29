# Why Memex exists

Most companies are not knowable by their own software. Decisions live in DMs nobody else can read. Specs sit in docs nobody can find. Tickets reference threads, threads reference tickets, neither references the customer call where the actual decision happened. The information is somewhere, but it's not anywhere.

Search products tried to solve this and built indexes. Wikis tried and built filing systems. Both lost to the gravity of the tools people actually live in: Slack, Linear, GitHub, Notion, Google Workspace, calls. Information stays where work happens. The fix isn't another place to put things; it's a substrate underneath the places things already are.

Agents change the math. An LLM with access to a single Slack message can answer trivial questions. An LLM with access to *the entire substrate* — every thread, PR, issue, doc, call transcript, with provenance and permissions intact — can do real work.

But knowing what was said is not the same as knowing what to do. The hardest knowledge in any company is procedural — how refunds get handled, how on-call works, how a PR actually gets reviewed. That knowledge lives in nobody's head completely; it's an emergent property of how the team has acted across thousands of past artifacts. Memex extracts it. It watches the substrate, identifies the procedures hidden inside, and emits them as executable skills agents can invoke. Skills that stay current as the procedures evolve.

The endpoint is a closed loop. Companies declare what should be happening — sprint goals, OKRs, PRDs. Memex compares stated intent against actual artifacts and flags drift. The team builds, the system watches, the team adjusts. Open loops become closed.

The product is the substrate, the skill layer on top, and the loop that closes between intent and reality. The interface is MCP, because that's what every agent already speaks. The deployment is open-source and self-hostable, because no team should send their entire knowledge base to a third party to make it queryable.

The companies that win the next decade will be the ones that became *legible to themselves* first — and then *operable on themselves* second. The first commit toward that for any team is connecting Memex and watching their company become something an agent can both understand and act upon.

— *Building this in public.*
