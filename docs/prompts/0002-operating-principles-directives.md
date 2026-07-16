---
title: "PROMPT 0002. Operating-Principles Directives — tenet-source statements"
date: 2026-07-16
author: goga
type: prompt
captured_by: granite (fleet orchestrator)
note: "Verbatim directives given across the 2026-07-16 vision-uplift session, gathered because Goga asked that 'some of what i said needs to become tenets or part of the north star vision.' Source for the NORTH-STAR tenet amendments. See PROMPT 0001 for the kickoff."
---

Verbatim statements (chronological, session of 2026-07-16):

1. "for now this is our own tool and product, and we are the only users, no need to
   maintain legacy code or write new code with backwards compatible mindset, write new
   code and potentially uplift and cleanup legacy code."

2. "remote and d1 storage is descoped, as part of my vision I am much more driven to
   push the local first architecture. Even if i host remotely i will host inside vps
   with local storage instead of using workers or d1 like db. This doesn't mean to
   eradicate existing code, but deprioritize it for now. Local first is the north star
   vision."

3. "I would love to explore Loro as well but I don't want to lose the .md files in the
   file system any time soon as a source of truth."

4. "lets make sure to not over engineer during and after audits, sometimes after doing
   audits we end up looping into audit/fix loop and forget the north star vision.
   I dont want that to happen."

5. "we are high level agents, we should allow our fleet to use subagents too."

6. "i am kinda falling into the idea that backlog-mcp bolts on top of the existing
   projects, i feel like that makes it such an easy adoption product, like a no
   brainer. And it solves so many of my problems and internal conflicts, like i have
   reduced my own usage of backlog-mcp because i had to write ADR docs in the repo and
   i didn't want to duplicate same tasks, artifacts and md files in the repo and in
   the global backlog directory."

7. On the write boundary (write_resource vs native Edit): "i don't like that
   backlog-mcp is just an alternative tool to what already exists, aka Edit file. All
   the agentic harnesses already come with the Edit tool natively… we will get rid of
   the wasted tokens… but at the same time… write_resource actually protects and
   enforces the substrate's schema validity… That introduces lots of heurestics and i
   kinda don't like that… And it mutate's user's files… Maybe its a problem we
   shouldn't solve and just leave it alone." (unresolved — ADR 0117 explores)

8. "the remoteness can be achieved by synchronization, i want all the data to be
   private and local, remote can be achieved by syncing."

9. From the article prompts (gkoreli.com/one-hundred-pull-requests/prompts, PROMPT 8):
   "build something that solves the problem start using, uncover new problems, address
   those, keep using them, mostly never anticipated or over-engineered solutions to
   un-existing or potential theoretical problems."

10. From article PROMPT 12: "you need to make sure that context is explored on-demand
    and lazily instead of eagerly pushing too much context inside agent."

11. From article PROMPT 10, on organization: "folders natively come out of the box with
    some kinda pre-determined routing/organizing strategies… Pretty much decided ahead
    of time instead of after the fact, because after the fact organizing is quite
    complicated and slow."
