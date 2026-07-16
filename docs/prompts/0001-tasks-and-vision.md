---
title: "PROMPT 0001. Tasks and Vision — memory uplift, substrates, docs-native backlog"
date: 2026-07-16
author: goga
type: prompt
captured_by: granite (fleet orchestrator)
note: "Verbatim human prompt that kicked off the vision-uplift batch (NORTH-STAR.md, ADR 0112/0113/0114, naming proposal). Human prompts are candidate material for a native prompt substrate — see ADR 0113 thread."
---

you know how aime works? you have 3 engineers to delegate to, use aime cli. you have 5 engineers in total actually you can allocate the roles as you wish. pane 2 is gpt 5.6 med, pane 3 is gpt 5.6 high, pane 4 is fable med, pane 5 is gpt-5.6-sol xhigh, pane 6 is Opus 4.8 high. We are working on the backlog-mcp. I want to uplift the
  backlog-mcp's memory. Btw the name backlog-mcp and some of the things are quite outdated, the vision of backlog-mcp is much bigger and
  much more robust. Substrates are the core architectural breakthrough, we can express lots of data objects with substrates and
  Progressive disclosure is one of the key architectural shifts with agentic engineering and we have built it into the core. We need to
  capture some of this in the north star document, we need to update our vision. Backlog-mcp (we direly need a better name) was context
  engineering for your agents, know its context and memory engineering, another way to put it is that your backlog is your agent's memory.
  I have been using the backlog's memory heavily and it proved to be really useful and successful, I used it much much more times than
  those tools that we built for context engineering - which i feel like still has value but I dont know how to extract value fully, maybe
  memory ergonomics are much better than what we built for context engineering. Or maybe the lines are so blurried its hard to
  differentiate when to use context retrieval tools vs memory retrieval tools. Should we remove the context related tools or no? I am
  slightly torn, i am inclined to simplify and uplift, but at the same time i feel like context engineering has merit and we just need to
  figure out how to extract value out of it. we need to uplift the ergonomics as well, for example i am heavily using ADR driven
  engineering a lot, but then it creates conflict in me like now i have backlog-mcp where i store tasks, artifacts and what not, and then
  i have ADRs which kinda do the similar thing. So i have a new idea, what if we have project level .backlog or maybe direct backlog
  straight to the docs folder, imagine like you can start using the backlog-mcp with day 0, its fully backwards compatible it just bolts
  on top of your docs folder? Then you end up having a global backlog in the root ~/.backlog and per project level backlog like ./.backlog
  or ./docs per project. The reason i like this a lot is because adoption becomes much easier, secondly the reason we must have ADRs is
  because they need to exist in the repo itself, they must be commited here. What I am thinking is that ADR is just yet another substrate,
  we can have ./docs/substrates/ADR.json - which defines the ADR substrate json schema definition and backlog-mcp just bolts on top of it
  and now knows how to work with ADRs, but we could just natively build ADRs, but I feel like ADRs are just artifacts. However, I created
  the concept of ADR-number.threadNumber-slug.md kinda naming i like the unique identifier number, threads, slugs in the name instead of
  just like TASK-0004, its hard to figure out what this is lets say for someone that doesn't use backlog-mcp. Also I feel like with the
  project level scoping, we can have memories stored in the project where they belong as well similarly numbered and threaded like ADRs,
  so that anyone with not only backlog-mcp can read and work with it. At the end of the day its all just frontmatter markdown documents. I
  feel like this kinda ergonomics will increase usage of memory, context engineering and adoption of backlog-mcp drastically. Like
  adoption is 0 effort it just bolts on top of your project. Maybe we don't even need to specify the "/docs" folder as home? Maybe it just
  auto-explores and finds all the .md artifacts and uses ./.backlog as home? but i feel like if we want the docs and all the artifacts to
  be fluidly explorable and what not even if someone doesn't use backlog-mcp then hidden folder like .backlog is not ideal, maybe we
  should embrace it like instead of using hidden folder naming like .backlog, embrace fully open folders and documents, even the tasks and
  all the backlog artifacts will get organized here. Idea is that these artifacts belong to the project in which you are working on. Then
  instead of everything going into one folder, we can have folders for each substrate like docs/tasks docs/memories, docs/artifacts,
  docs/adrs? or maybe an ADR is extension of artifact, or adr is just an artifact? but we have particular semantics with ADRs that is not
  expressed with current substrates, like supercedes, proposed, accepted and what not. Like look at aime's project's docs:
  /Users/goga/Documents/goga/aime/docs , aime is much more recent project, and i have drastically evolved with my ADR driven engineering.
  Like overall using Aime, delegating to fleet of engineers makes ADR driven engineering much more valuable, at the same time requires
  some new properties to the substrate and new types of substrates like requirements from human, like product requirements that need to be
  met. Because besides architecture there is north star vision and product requirements that should be respected, sometimes during
  architecture work some product features and vision might get derailed and lost, which is not ideal.
  