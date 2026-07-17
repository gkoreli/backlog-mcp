---
title: "PROMPT 0008 — Memory Placement, Scoping Defaults, and the Identity Tension (verbatim)"
date: 2026-07-17
status: Captured verbatim
author: goga
relates_to:
  - ../proposals/memory-placement-2026-07.md
  - 0003-worktree-lattice-vision-drop.md
  - 0006-first-person-memory-capture-law.md
---

# PROMPT 0008 — verbatim

> we need to also think about agentic smart defaults, like whenever lets say
> search or memory recall is triggered, does it answer from local or global by
> default? is it explicitly known and easy to understand or differentiate?
> Should we bake this information or should we follow our progressive disclosure
> tenet somehow here as well? I am unsure how to make these decisions but
> definitely conflicted and unsure how to make this decision? is there a way to
> sidestep this problem? I guess not, lets say we have thousands of files and
> memories across global, or workspace level, when agent tries to recall what
> about its own agent identity memory? workspace memory? or a global memory?
> does it even make sense at all that we have this kinda differentiation?
> ideally its nice to have it because we will end up commiting memories to the
> same git repo where everything now belongs to, and global memory is the place
> where data belongs that have nothing to do with the project. I am also a
> little torn, what if some kinda memory is meant for both global and local
> project? Like i did something so meaningful in local repo that i want this
> memory to be persisted globally as well? Also Agent's memory is about
> identity, and identity scoped right? Its different kind of problem entirely,
> like scoping memory to identity, but it also creates lots of conflicts, like
> is one agent not allowed to read another agent's memory? that kinda defeats
> the purpose, what if one agent truly finds lots of meaningful things to be
> memorized, then the other agent can't see those that will help improve the
> project? I am torn and self conflicted, like I don't want to bombard agents
> with unnecessary context, but also i don't want to create a tunnel vision,
> and tunnel memory islands. Maybe the identity just help's with the memory
> qrels? or will it hinder the query relevance? I am not even sure. Some of
> these ideas need research and experimentation and we need some cross
> references and rationale. Maybe at least having global access to memories but
> allowing to narrow down with filters is better, than restricting and not
> allowing to access full memory? Maybe local memory always gets written
> locally and globally both, and gets de-duplicated and synchronized? But thats
> kinda annoying as well... We are duplicating the same artifacts in two
> places, which causes some new technical challenges. I am ideating about
> duplication because i don't want the agent to waste turns on oh leet me save
> this memory locally and globally, and consume 2 turns and additional context
> on memory management, while we should be allocating tokens towards the real
> work and all of a sudden we added all this accounting and all this jargons,
> and orchestration. Are we increasing signal per token or decreasing in the
> long run? We should be concious about that. Also maybe its better to use 2
> turns and conciously write different memory artifacts for different home
> locations, like locally this memory is differently meaningful than
> globally... but i am torn here, we need some prior art, but i already
> definitely feel this tension. Maybe there are ways to sidestep or uplift in a
> way that this conflicts disappear?

Distilled into: `docs/proposals/memory-placement-2026-07.md` (the dissolution:
fused reads always, one-line placement rule, usage-driven promotion, identity
as provenance never a wall).
