# 0015. Ralph Wiggum Loop for Autonomous Agent Orchestration

**Date**: 2026-01-24
**Status**: Proposed
**Related Epic**: EPIC-0007 (Studio Agents CLI)

## Context

### The Fundamental Problem: Context Rot Kills Agent Autonomy

AI agents face a critical limitation that prevents true autonomy: **context windows fill up and degrade**.

**What happens in traditional agent workflows**:
1. Agent starts with fresh context (170k-200k tokens)
2. Reads files, makes tool calls, accumulates conversation history
3. Context window fills with irrelevant information
4. Model performance degrades (Anthropic research confirms this)
5. Agent gets confused, makes mistakes, or stops making progress
6. Human must intervene, restart, or manually clean up

**This is why current delegation fails**:
- Single-shot delegation: Agent completes work and exits (no iteration)
- Long-running agents: Context accumulates, quality degrades, agent gets lost
- Manual iteration: Human must restart with feedback (loses momentum, requires judgment)
- Multi-agent systems: Non-deterministic agents communicating = "red hot mess"

**The core insight**: LLM context windows only grow—add tokens, never delete. Wrong turns, failed attempts, hallucinations accumulate. This is called **context rot**.

### The Real-World Impact

**Current state of studio-agents delegation**:
1. Delegate research task to research-agent
2. Agent produces artifact in single context window
3. Artifact has gaps, could be improved, needs refinement
4. Agent exits—context is lost
5. Must manually restart with feedback
6. No mechanism for autonomous iteration until "done enough"

**What we actually need**: Agents that can work for hours, not minutes. Agents that iterate autonomously until quality thresholds are met. Agents that don't degrade over time.

### The Ralph Wiggum Technique: A Paradigm Shift

The Ralph Wiggum Loop is not just an iteration pattern—it's a **fundamental rethinking of how AI agents should work**.

**Created by**: Geoffrey Huntley, open source developer
**Proven with**: CURSED programming language (complete compiler built over 3 months of autonomous operation)
**Named after**: Ralph Wiggum from The Simpsons—lovably forgetful, earnest but mistake-prone, persistently optimistic

**The core mechanism**:
```bash
while :; do 
  cat PROMPT.md | agent
done
```

**But this is NOT just a bash loop**. The technique embodies a profound philosophical shift:

### The Three Pillars of Ralph

#### 1. **Stateless Resampling** (Fresh Context Per Iteration)

**The fundamental mechanism**: Each iteration spawns a **completely new agent process** with a **fresh context window**.

When the iteration exits, the context is **gone**. No conversation history. No accumulated confusion. No context rot.

**Geoff's philosophy**: "One context window, one activity, one goal."

**Why this works**:
- No context degradation over time
- Consistent quality across all iterations
- Predictable failures (deterministic mistakes)
- Model performs best with fresh context (Anthropic research)

**What everyone gets wrong**: Anthropic's Ralph Wiggum plugin runs in a single persistent context that eventually compacts and loses information. That's NOT the real Ralph technique. The real technique cannot compact because each iteration starts fresh.

#### 2. **Deterministic State Through Filesystem**

Memory persists **only** through external files, not conversation history:

- **`PROMPT.md`** - The instructions (what to do, never changes)
- **`fix_plan.md`** - Dynamic task list (what's done, what's next, what's broken)
- **`AGENT.md`** - Project conventions and "signs" (learnings about how to build/run)
- **`specs/*`** - Specifications (what should be built, one file per feature)
- **Git commits** - The actual code changes

Each iteration:
1. Fresh agent process spawns
2. Reads state from files (fix_plan.md, AGENT.md, specs)
3. Picks ONE item to work on
4. Implements the change
5. Updates fix_plan.md with results
6. Commits to git
7. **Process exits** → context destroyed → fresh iteration begins

**The key insight**: Software is now clay on the pottery wheel. If something isn't right, throw it back on the wheel to address items that need resolving.

#### 3. **One Task Per Loop** (Monolithic, Not Microservices)

**Geoff's principle**: "Ralph is monolithic. Ralph works autonomously in a single repository as a single process that performs **one task per loop**."

**Why one task**:
- Context window preservation (170k tokens, quality degrades near limits)
- Focused work, no context pollution
- Faster validation cycles
- Smaller, easier-to-fix failures
- Better quality per change

**What this means**: Don't ask Ralph to "implement auth and add tests and refactor the database." Ask Ralph to do ONE thing. Ralph decides what's most important from fix_plan.md and does that one thing. Next iteration, Ralph (fresh context) picks the next most important thing.

**The anti-pattern**: Multi-agent systems with agent-to-agent communication. "Consider microservices and all the complexities that come with them. Now, consider what microservices would look like if the microservices (agents) themselves are non-deterministic—a red hot mess."

### Why "Ralph Wiggum"?

The name captures the philosophy perfectly:

**Ralph Wiggum characteristics**:
- **Lovably forgetful** → Fresh context each time (no memory of previous attempts)
- **Earnest but mistake-prone** → Needs validation/backpressure to catch errors
- **Persistently optimistic** → Keeps trying despite setbacks
- **"I'm helping!"** → Actually does help, despite chaos

**Geoff's insight**: "Ralph is deterministically bad in a non-deterministic world."

Ralph makes mistakes in **predictable, repeatable ways**. Unlike chaotic multi-agent systems, Ralph's failures follow patterns you can anticipate and guard against with "signs" (instructions in AGENT.md). That consistency makes it debuggable, tunable, and ultimately reliable.

**The deeper philosophy**: "Dumb things can work surprisingly well, so what could we expect from a smart version?"

### Proven Results

**CURSED programming language**:
- Complete compiler (lexer, parser, LLVM codegen, stdlib)
- Built over 3 months of autonomous operation
- Language didn't exist in training data

**YC Hackathon case study**:
- 6 repositories shipped overnight
- ~1,100 commits total
- ~$800 cost ($10.50/hour per agent)
- 90% automated, 10% human cleanup

**$50k contract**:
- Completed for $297 in API costs
- Used Ralph technique throughout

**Geoff's claim**: "Software can now be developed cheaper than the wage of a burger flipper at McDonald's and it can be built autonomously whilst you are AFK."

### The Mindset Shift

**Geoff's philosophy**: "Ralph isn't just about forwards (building autonomously) or reverse mode (clean rooming) it's also a mindset that these computers can be indeed programmed."

**Old way**: Build software vertically brick by brick—like Jenga
**New way**: Everything is a loop. Software is clay on the pottery wheel.

**The role of the engineer**: "I'm there as an engineer just as I was in the brick by brick era but instead am programming the loop, automating my job function."

**Critical practice**: "It's important to *watch the loop* as that is where your personal development and learning will come from. When you see a failure domain—put on your engineering hat and resolve the problem so it never happens again."

This means:
- Running the loop manually via prompting, OR
- Running with automation but with pauses (press CTRL+C to progress)
- Adding "signs" to AGENT.md when failures occur
- Tuning Ralph like a guitar

**Geoff's mantra**: "Never blame the model—always be curious about what's going on."

### The Governance Challenge: Ralph Needs a Principal Skinner

**The risk**: Ralph runs in YOLO mode (`--dangerously-skip-permissions`). This means unrestricted shell access. A confused or compromised agent can:
- Delete databases
- Exfiltrate environment variables
- Modify security settings
- Cause production outages

**The failure mode**: "Overbaking"—if you leave Ralph running too long, you end up with bizarre emergent behavior (like post-quantum cryptography support when you just wanted basic auth).

**The solution**: A "Principal Skinner harness"—deterministic control plane that:
- Monitors agent behavior in real-time
- Enforces organizational rules at infrastructure level
- Blocks high-risk commands before execution
- Provides distinct agent identity for git attribution
- Implements behavioral circuit breakers
- Uses adversarial simulation to discover toxic flows

**Key insight**: "We must stop 'asking' the model to be safe in the prompt. Instead, builders need to leverage their inner Skinner and build a harness to ensure Ralph stays on the paved road from the very first step."

**The distinction**: 
- `max-iterations` = financial circuit breaker (prevents excessive API costs)
- Behavioral controls = security guardrails (prevents dangerous actions)

Both are necessary. Iteration limits alone are not governance.

### Critical Anti-Patterns: What Breaks Ralph

#### Anti-Pattern 1: Reading Agent Logs in Wiggum Loop

**The violation**: Agent N reads Agent N-1's process logs (thinking, reasoning, tool calls).

**Why it breaks Ralph**: Agent logs contaminate fresh context. When Agent 3 reads Agent 1's log saying "I'm a studio-engineer agent implementing Phase 1," Agent 3 thinks it **has memory** of implementing Phase 1, even though it's a fresh process with no memory.

**The illusion**: Reading logs gives the agent the illusion of continuity, breaking stateless resampling.

**Real-world failure**:
```
Agent 1 log: "I'm a studio-engineer agent. I implemented Phase 1. I created ADR 0009."
Agent 3 reads this log → thinks: "I must BE that agent who did Phase 1!"
Result: Agent 3 acts like it has memory, violates fresh context principle
```

**The fix**: Review OUTPUT, not PROCESS.

✅ **What to read** (artifacts):
- Code (the implementation)
- ADRs (design decisions)
- Commits (what changed)
- Test results (validation)
- Documentation (deliverables)
- `fix_plan.md` (what needs work)

❌ **What NOT to read** (process):
- Agent logs (thinking process)
- Previous agent's reasoning
- Tool call traces
- Conversation history
- Internal deliberation

**Why this matters**: The whole point of Wiggum is **stateless resampling**. Each agent has **no memory** of previous iterations. Memory persists **only through artifacts** (code, ADRs, commits), not through process logs.

**The principle**: "One context window, one activity, one goal." Reading process logs violates this by giving the agent false memory.

#### Anti-Pattern 2: Multiple Tasks Per Loop

**The violation**: Asking agent to "implement auth AND add tests AND refactor database" in one iteration.

**Why it breaks Ralph**: Context window pollution. Agent tries to do too much, quality suffers, validation becomes unclear.

**The fix**: ONE task per loop. Agent picks ONE item from `fix_plan.md`, implements it, exits. Next iteration (fresh context) picks next item.

#### Anti-Pattern 3: Persistent Context (Not Fresh)

**The violation**: Running agent in single continuous session with conversation history.

**Why it breaks Ralph**: This is what Anthropic's plugin does—it's NOT the real Ralph technique. Context accumulates, gets compacted, loses information, degrades over time.

**The fix**: Each iteration spawns **new agent process**. When process exits, context is **destroyed**. No conversation history carried over.

#### Anti-Pattern 4: Blaming the Model

**The violation**: "The agent is stupid, it keeps making the same mistake."

**Why it breaks Ralph**: Ralph makes **deterministic mistakes**. If agent keeps failing the same way, it's because the "signs" aren't clear enough.

**The fix**: "Never blame the model—always be curious about what's going on." Add a "sign" to `AGENT.md` explaining what went wrong and what to do differently.

**Geoff's mantra**: "Any problem created by AI can be resolved through a different series of prompts."

#### Anti-Pattern 5: No Human Watching Loop

**The violation**: Start loop, walk away, come back when it's done.

**Why it breaks Ralph**: "It's important to *watch the loop* as that is where your personal development and learning will come from."

**The fix**: Watch iterations (at least initially). Identify failure domains. Add "signs" when failures occur. Tune the loop like a guitar.

**The practice**: Run loop manually via prompting, OR run with automation but with pauses (press CTRL+C to progress). This is still Ralphing—the pattern is about context engineering, not full automation.

#### Anti-Pattern 6: Vague Specifications

**The violation**: "Make the artifact better" without defining what "better" means.

**Why it breaks Ralph**: Agent has no clear target. `fix_plan.md` becomes vague. Iterations don't converge.

**The fix**: Declarative specifications. Define what "done" looks like:
- "The artifact should have verifiable evidence for all claims"
- "Recommendations should include specific steps with code examples"
- "All sections from template must be present and substantive"

**The principle**: Tell agent WHAT good looks like, not HOW to achieve it.

#### Anti-Pattern 7: Ignoring Backpressure

**The violation**: No validation after iterations. Agent says "I'm done" and you accept it.

**Why it breaks Ralph**: Without validation, agent can claim completion without actually improving quality.

**The fix**: Backpressure = validation. Run quality metrics after each iteration. If quality doesn't improve, add "sign" explaining what went wrong.

**The types of backpressure**:
- Type systems (compilation errors)
- Tests (automated validation)
- Linters (style enforcement)
- Quality metrics (completeness, verification, clarity)
- Human review (optional checkpoints)

#### Anti-Pattern 8: Treating Ralph as a Plugin

**The violation**: Implementing Ralph as a feature within existing agent harness (single session).

**Why it breaks Ralph**: "If you're implementing Ralph as part of the agent harness via skill/command/etc you are missing the point of Ralph which is to use always a fresh context."

**The fix**: Ralph is a **separate loop** that spawns **new agent processes**. It's not a mode or feature—it's a different execution model.

**The distinction**:
- Plugin: Single session, conversation history, context accumulates
- Ralph: Fresh process per iteration, no history, context destroyed after each loop

### Key Insights: What Makes Ralph Work

#### Insight 1: Deterministically Bad in a Non-Deterministic World

**Geoff's principle**: "Ralph is deterministically bad in a non-deterministic world."

**What this means**: Ralph makes mistakes in **predictable, repeatable ways**. Unlike chaotic multi-agent systems, Ralph's failures follow patterns you can anticipate and guard against.

**Why this is good**: Predictable failures are debuggable. You can add "signs" to prevent the same failure next time.

**The implication**: Don't expect Ralph to be perfect. Expect Ralph to fail predictably, and tune the loop to handle those failures.

#### Insight 2: Software is Clay on the Pottery Wheel

**Geoff's metaphor**: "Software is now clay on the pottery wheel. If something isn't right, throw it back on the wheel to address items that need resolving."

**What this means**: Don't try to get it perfect in one pass. Iterate. Each loop refines the work.

**The shift**: From "build it right the first time" to "iterate until it's right."

**The practice**: Delete `fix_plan.md` and regenerate it fresh when agent goes off track. Throw the work back on the wheel.

#### Insight 3: LLMs Are Amplifiers of Operator Skill

**Geoff's principle**: "LLMs are amplifiers of operator skill."

**What this means**: The quality of Ralph's output depends on the quality of your specifications, prompts, and "signs."

**The implication**: If Ralph produces bad output, improve your specifications. If Ralph makes the same mistake twice, add a "sign."

**The role shift**: You're not writing code anymore. You're programming the loop.

#### Insight 4: Each Time Ralph Fails, Ralph Gets Tuned

**Geoff's principle**: "Each time Ralph does something bad, Ralph gets tuned—like a guitar."

**What this means**: Failures are learning opportunities. Add "signs" to `AGENT.md` when failures occur.

**The practice**: 
1. Watch loop
2. See failure
3. Add sign explaining what went wrong and what to do differently
4. Next iteration (fresh context) reads the sign and avoids the failure

**The accumulation**: Over time, `AGENT.md` accumulates wisdom. Ralph gets better at the specific task.

#### Insight 5: The Pattern is Generic

**Geoff's insight**: "Ralph is about getting the most out of how the underlying models work through context engineering and that pattern is GENERIC and can be used for ALL TASKS."

**What this means**: Ralph isn't just for coding. It's for any task that benefits from iteration:
- Research (refine findings)
- Design (iterate on proposals)
- Debugging (identify and fix issues)
- Refactoring (improve code incrementally)
- Testing (write tests one at a time)
- Documentation (improve clarity iteratively)

**The unifying principle**: Fresh context per iteration, deterministic state through filesystem, one task per loop.

#### Insight 6: Watch the Loop for Learning

**Geoff's practice**: "It's important to *watch the loop* as that is where your personal development and learning will come from."

**What this means**: Don't just start the loop and walk away. Watch iterations. See what works, what fails, what patterns emerge.

**The learning**: 
- How does the agent prioritize?
- What mistakes does it make?
- What "signs" are needed?
- When does quality plateau?

**The practice**: Run loop manually (prompting) or with pauses (CTRL+C to progress). This is still Ralphing—the pattern is about context engineering, not full automation.

#### Insight 7: Monolithic, Not Microservices

**Geoff's principle**: "Ralph is monolithic. Ralph works autonomously in a single repository as a single process that performs one task per loop."

**What this means**: Don't build multi-agent systems with agent-to-agent communication. That's "a red hot mess."

**The anti-pattern**: Microservices architecture for agents. Non-deterministic agents communicating = chaos.

**The pattern**: Single agent, single repository, single process. One task per loop. Deterministic state through filesystem.

**Why this works**: Simplicity. Debuggability. Predictability.

#### Insight 8: Evolutionary Software is the Goal

**Geoff's vision**: "I'm going for a level 9 where autonomous loops evolve products and optimize automatically for revenue generation. Evolutionary software—also known as a software factory."

**What this means**: Ralph isn't the end goal. It's a step toward software that evolves itself.

**The demonstration**: "The Weaving Loom"—infrastructure where autonomous loops auto-heal, auto-verify, auto-deploy. "Something incredible just happened here—perhaps first evolutionary software auto heal. I was running the system under a ralph system loop test. It identified a problem with a feature, then it studied the codebase, fixed it, deployed it automatically, verified that it worked."

**The trajectory**: 
1. Manual coding (old way)
2. AI-assisted coding (current)
3. Ralph loops (autonomous iteration)
4. Evolutionary software (self-improving systems)

**Where we're headed**: Not just autonomous coding, but autonomous software factories.

### Vision: Ralph Wiggum Loop in Studio Agents CLI

**The transformation we're enabling**:

**Before (Current State)**:
```
User → delegate research → Agent 1 produces artifact → exits
     → Manual review → gaps found → manual restart with feedback
     → Agent 2 (new context) → produces improved artifact → exits
     → Manual review → still needs work → manual restart again
     → ...human in the loop every cycle...
```

**After (Ralph Wiggum Integration)**:
```
User → delegate research --wiggum → Agent 1 produces artifact → exits
     → Wiggum loop starts automatically:
        → Agent 2 (fresh context) reads artifact + fix_plan.md
        → Critically reviews Agent 1's work
        → Picks ONE improvement from fix_plan.md
        → Implements improvement
        → Updates fix_plan.md
        → Commits → exits
        → Agent 3 (fresh context) continues...
        → ...autonomous iteration until quality threshold...
     → Final artifact ready
```

**The key difference**: No human in the loop. No context rot. No manual restarts. Just autonomous iteration with fresh context each time until the work is "done enough."

### The Holistic Vision: Everything is a Ralph Loop

**Geoff's insight**: "Ralph isn't just a technique—it's a mindset. Everything is a ralph loop."

**What this means for studio-agents CLI**:

1. **Delegation is a Ralph loop** - Research, design, implementation—all loops
2. **Debugging is a Ralph loop** - Identify issue, fix, verify, repeat
3. **Refactoring is a Ralph loop** - Improve one thing, commit, repeat
4. **Testing is a Ralph loop** - Write test, run, fix, repeat
5. **Documentation is a Ralph loop** - Write, review, improve, repeat

**The pattern is GENERIC and can be used for ALL TASKS.**

**The studio-agents CLI becomes**: An orchestrator for Ralph loops. Each subcommand is a specialized loop:
- `studio-agents delegate` - Delegation loop
- `studio-agents wiggum` - Refinement loop
- `studio-agents debug` - Debugging loop (future)
- `studio-agents refactor` - Refactoring loop (future)
- `studio-agents test` - Testing loop (future)

**The unifying principle**: Fresh context per iteration, deterministic state through filesystem, one task per loop.

### Why This Matters for Studio Agents

**Alignment with EPIC-0007 vision**:
- **On-demand capabilities** - Wiggum loop loads when needed, not upfront
- **Lean memory** - No tools in LLM context until loop starts
- **Composable** - Each loop is a focused capability
- **Discoverable** - Skills teach agent when/how to use loops
- **Maintainable** - Single pattern for all autonomous work

**The competitive advantage**:
- **Better than MCP** - No JSONRPC overhead, no upfront memory cost, no context rot
- **Better than single-shot** - Autonomous iteration until quality threshold
- **Better than long-running agents** - Fresh context prevents degradation
- **Better than multi-agent** - Monolithic, deterministic, debuggable

**The team transformation**:
- Engineers program loops, not write code
- Agents do the work autonomously
- Humans watch loops, tune when failures occur
- "Software development is dead, software engineering is more alive than ever"

### The Philosophical Foundation

**What we're really building**: A new way to program computers.

**Geoff's vision**: "LLMs are a new form of programmable computer. We need software engineers who understand this."

**The shift**:
- **Old**: Write code → test → deploy
- **New**: Write specifications → program loop → watch it build

**The role of the engineer**:
- Define what "done" looks like (specifications)
- Program the loop (PROMPT.md, AGENT.md, exit conditions)
- Watch the loop (identify failure domains)
- Tune the loop (add "signs" when failures occur)
- Remove the need to hire humans for implementation

**The ultimate goal**: "Evolutionary software"—autonomous loops that evolve products and optimize automatically for outcomes.

**Geoff's demonstration**: "The Weaving Loom"—infrastructure for evolutionary software where autonomous loops auto-heal, auto-verify, auto-deploy. "Something incredible just happened here—perhaps first evolutionary software auto heal. I was running the system under a ralph system loop test. It identified a problem with a feature, then it studied the codebase, fixed it, deployed it automatically, verified that it worked."

**This is where we're headed**: Not just autonomous coding, but autonomous software factories.

---

## Proposed Solutions

### The Core Question

How do we integrate the Ralph Wiggum technique into studio-agents CLI while preserving its fundamental principles?

**Non-negotiable principles**:
1. **Fresh context per iteration** - Must spawn new agent process each loop
2. **Deterministic state** - Memory only through filesystem (fix_plan.md, AGENT.md, git)
3. **One task per loop** - Agent picks ONE improvement, implements it, exits
4. **Monolithic process** - Single agent, single repository, no agent-to-agent communication
5. **Human watches loop** - Engineer monitors, tunes, adds "signs" when failures occur

### Option 1: Wiggum as Separate Subcommand (Recommended)

```bash
# Start Wiggum loop on existing artifact
studio-agents wiggum start research-topic \
  --artifact-path ~/Documents/goga/.backlog/artifacts/research-topic-2026-01-24 \
  --max-iterations 10 \
  --quality-threshold 0.85

# Watch the loop (critical for learning)
studio-agents wiggum watch research-topic

# Stop loop
studio-agents wiggum stop research-topic

# Check status
studio-agents wiggum status research-topic
```

**Pros**:
- Separation of concerns (delegate = create, wiggum = refine)
- Can be used independently of delegation
- Works with any artifact (not just delegations)
- Composable (chain with other commands)
- Aligns with "everything is a ralph loop" philosophy
- Clear mental model

**Cons**:
- More commands to learn
- Requires understanding of artifact paths

### Option 2: Wiggum Mode as Delegation Flag

```bash
# Delegate with automatic Wiggum loop
studio-agents delegate start research-topic task.md --wiggum --max-iterations 10
```

**Pros**:
- Simple integration
- One command does everything
- Easy to understand

**Cons**:
- Mixes two concerns (delegation + iteration)
- Less composable
- Doesn't work with existing artifacts
- Violates "one task per loop" principle (delegation + refinement = two tasks)

### Option 3: Skill-Based Discovery (Future)

```bash
# Skill loads when relevant, teaches agent about Wiggum
# Agent learns: "To refine this artifact, run studio-agents wiggum start"
```

**Pros**:
- On-demand knowledge (aligns with EPIC-0007)
- No upfront memory cost
- Agent discovers capability when needed

**Cons**:
- Requires skill system maturity
- Less discoverable for humans initially

---

## Decision

**Choose Option 1: Separate Wiggum Subcommand with Watch Capability**

**Rationale**:

1. **Preserves Ralph principles**: Separate command = separate loop = monolithic process
2. **"Everything is a ralph loop"**: Delegation is one loop, Wiggum is another loop
3. **Composability**: Works with any artifact, not just delegations
4. **Human watches loop**: `studio-agents wiggum watch` enables critical learning
5. **Separation of concerns**: Delegate = create, Wiggum = refine (two different loops)
6. **Aligns with CLI vision**: Each subcommand is a focused capability
7. **Future-proof**: Can add more loop types (debug, refactor, test) as separate commands

**Implementation path**:
- **Phase 1**: `studio-agents wiggum` subcommand (standalone loop)
- **Phase 2**: `studio-agents wiggum watch` (human monitors loop for learning)
- **Phase 3**: Skill that teaches agent when/how to use Wiggum
- **Phase 4**: Optional `--then-wiggum` flag for delegation (convenience, chains two loops)

**The key insight**: Wiggum is not a feature of delegation. Wiggum is its own loop. Delegation produces an artifact. Wiggum refines that artifact through autonomous iteration. These are two separate loops that can be chained but should not be conflated.

---

## Architecture: The Real Ralph Loop

### Core Principles (Non-Negotiable)

1. **Fresh Context Per Iteration**
   - Each iteration spawns a **new agent process**
   - When process exits, context is **destroyed**
   - No conversation history carried over
   - Agent reads state from files only

2. **Deterministic State Through Filesystem**
   - Memory persists **only** through files
   - No in-memory state between iterations
   - Git commits provide history
   - Files are the single source of truth

3. **One Task Per Loop**
   - Agent picks ONE improvement from fix_plan.md
   - Implements that one thing
   - Updates fix_plan.md
   - Commits
   - Exits
   - Next iteration (fresh context) picks next item

4. **Monolithic Process**
   - Single agent, single repository
   - No agent-to-agent communication
   - No multi-agent orchestration
   - "What's the opposite of microservices? A monolithic application."

5. **Human Watches Loop**
   - Engineer monitors iterations
   - Identifies failure domains
   - Adds "signs" to AGENT.md when failures occur
   - Tunes the loop like a guitar
   - "Never blame the model—always be curious"

### File Structure

```
~/Documents/goga/.backlog/artifacts/research-topic-2026-01-24/
├── artifact.md              # Original artifact from Agent 1
├── wiggum/
│   ├── iteration-001/
│   │   ├── review.md        # Agent 2's critique
│   │   ├── improvements.md  # What was changed
│   │   └── artifact.md      # Updated artifact
│   ├── iteration-002/
│   │   ├── review.md
│   │   ├── improvements.md
│   │   └── artifact.md
│   ├── PROMPT.md            # Instructions for each iteration
│   ├── fix_plan.md          # Dynamic task list (what needs improvement)
│   └── AGENT.md             # Project conventions and "signs"
└── final/
    └── artifact.md          # Final refined artifact
```

### Loop Mechanism

Each Wiggum iteration:

1. **Read state** - Load `fix_plan.md` to see what needs improvement
2. **Pick ONE item** - Agent decides most important improvement
3. **Load context** - Read previous iteration's artifact
4. **Review** - Critically analyze previous work
5. **Improve** - Make ONE focused improvement
6. **Document** - Update `fix_plan.md` with findings
7. **Commit** - Save iteration artifacts
8. **Fresh context** - Session ends, loop repeats

### Quality Threshold

Loop continues until:
- Max iterations reached (safety limit)
- Quality threshold met (configurable metric)
- `fix_plan.md` is empty (no more improvements)
- Manual stop via `studio-agents wiggum stop`

**Quality metrics** (configurable):
- Completeness score (all sections present)
- Verification score (claims backed by evidence)
- Clarity score (readability, structure)
- Custom validation script

---

## Key Principles from Ralph Wiggum Technique

### 1. Fresh Context Per Iteration

Each loop starts a **new agent session** with fresh context window.

**Why**: Avoids context rot, maintains consistent quality, predictable failures.

**Implementation**: 
- Spawn new agent process each iteration
- No conversation history carried over
- Agent reads state from files only

### 2. External Memory Through Files

All state lives externally:

- **`PROMPT.md`** - Instructions (what to do)
- **`fix_plan.md`** - Dynamic task list (what needs improvement)
- **`AGENT.md`** - Project conventions and "signs"
- **Previous iterations** - What was already done

### 3. One Improvement Per Loop

Counterintuitive but critical: only do ONE thing per iteration.

**Why**: 
- Context window preservation
- Faster validation cycles
- Smaller, easier-to-fix failures
- Better quality per change

### 4. Declarative Specifications

Don't tell agent HOW to improve. Tell it WHAT good looks like.

**Bad**: "First add more evidence, then improve structure, then..."

**Good**: "The artifact should have verifiable evidence for all claims and clear section structure."

### 5. Trust Agent to Prioritize

Agent reads `fix_plan.md` and decides what's most important to improve next.

**Philosophy**: "Full hands-off vibe coding" - trust the agent's reasoning about priority.

### 6. Backpressure = Validation

Validation forces agent to fix mistakes:
- Quality metrics (completeness, verification, clarity)
- Custom validation scripts
- Human review checkpoints (optional)

---

## Implementation Plan

### Phase 1: Core Wiggum Loop (MVP)

**Goal**: Basic loop that iterates on artifacts

```bash
studio-agents wiggum start research-topic \
  --artifact-path ~/Documents/goga/.backlog/artifacts/research-topic-2026-01-24 \
  --max-iterations 5
```

**Features**:
- Read artifact from path
- Generate initial `fix_plan.md` (what needs improvement)
- Loop: review → improve → update plan → commit
- Stop on max iterations or empty plan
- Save iterations to `wiggum/` directory

**Deliverables**:
- `studio-agents wiggum start` command
- `studio-agents wiggum status` command
- `studio-agents wiggum stop` command
- Basic iteration tracking

### Phase 2: Quality Thresholds

**Goal**: Stop when "good enough"

**Features**:
- Configurable quality metrics
- Custom validation scripts
- Automatic threshold detection
- Quality score tracking per iteration

**Deliverables**:
- `--quality-threshold` flag
- `--validation-script` flag
- Quality score in status output

### Phase 3: Skill Integration

**Goal**: Agent discovers Wiggum capability on-demand

**Features**:
- Skill that teaches agent about Wiggum
- Loads when artifact quality is questionable
- Provides usage instructions
- No upfront memory cost

**Deliverables**:
- `wiggum-loop` skill
- Skill trigger conditions
- Usage documentation

### Phase 4: Delegation Integration

**Goal**: Seamless delegation → Wiggum workflow

```bash
# Delegate, then automatically start Wiggum loop
studio-agents delegate start research-topic task.md --then-wiggum

# Or chain manually
studio-agents delegate start research-topic task.md && \
studio-agents wiggum start research-topic --artifact-path $(studio-agents delegate artifact-path research-topic)
```

**Features**:
- `--then-wiggum` flag for delegation
- Automatic artifact path detection
- Unified status reporting

**Deliverables**:
- `--then-wiggum` flag
- Artifact path helper
- Combined status view

---

## Consequences

### Positive

1. **Iterative refinement** - Agents can improve their own work
2. **Higher quality** - Multiple review cycles catch gaps
3. **Less human intervention** - Loop runs until quality threshold
4. **Proven pattern** - Ralph Wiggum technique has real-world success
5. **Composable** - Works with any artifact, not just delegations
6. **Aligns with CLI vision** - On-demand capability, lean memory

### Negative

1. **Complexity** - More moving parts than single-shot delegation
2. **Cost** - Multiple iterations = more API calls
3. **Time** - Takes longer than single pass
4. **Monitoring required** - Must watch for drift/loops
5. **New concept** - Team needs to learn Wiggum pattern

### Risks & Mitigations

**Risk**: Agent loops infinitely without improvement
**Mitigation**: Max iterations limit, quality threshold, manual stop

**Risk**: Agent drifts from original goal
**Mitigation**: `PROMPT.md` keeps goal clear, `fix_plan.md` tracks scope

**Risk**: Expensive API costs
**Mitigation**: Configurable iteration limits, cost tracking, budget alerts

**Risk**: Team doesn't understand when to use Wiggum
**Mitigation**: Clear documentation, skill-based discovery, examples

---

## Success Criteria

1. **Functional**:
   - `studio-agents wiggum start` successfully iterates on artifacts
   - Quality improves measurably across iterations
   - Loop stops appropriately (threshold or max iterations)

2. **Usable**:
   - Team understands when to use Wiggum vs single-shot
   - Clear status reporting shows progress
   - Easy to stop/restart if needed

3. **Efficient**:
   - One improvement per iteration (focused changes)
   - Fresh context prevents degradation
   - Reasonable API costs (<$10 per loop)

4. **Integrated**:
   - Works seamlessly with delegation
   - Skill teaches agent when/how to use
   - Fits into existing workflows

---

## References

### Ralph Wiggum Technique

- [Geoffrey Huntley - Ralph Wiggum Technique](https://ghuntley.com/ralph/)
- [ZeroSync - Ralph Loop Technical Deep Dive](https://zerosync.co/blog/ralph-loop-technical-deep-dive)
- [HumanLayer - Brief History of Ralph](https://www.humanlayer.dev/blog/brief-history-of-ralph)
- [CURSED Programming Language](https://github.com/ghuntley/cursed) - Flagship demo

### Case Studies

- [YC Hackathon - 6 Repos Overnight](https://github.com/repomirrorhq/repomirror/blob/main/repomirror.md)
- [VentureBeat - Ralph Wiggum in AI](https://venturebeat.com/technology/how-ralph-wiggum-went-from-the-simpsons-to-the-biggest-name-in-ai-right-now)

### Related ADRs

- [EPIC-0007: Studio Agents CLI](../../../backlog/epics/EPIC-0007.md)
- [ADR-0001: Writable Resources](./0001-writable-resources-design.md) - URI addressing pattern

---

## Open Questions

1. **Quality metrics**: What defines "good enough" for different artifact types?
2. **Agent selection**: Same agent for all iterations, or different agents per iteration?
3. **Human checkpoints**: Should there be mandatory human review at certain iterations?
4. **Cost controls**: What's the budget limit per loop? Per iteration?
5. **Artifact types**: Does this work for all artifact types, or just research?
6. **Parallel loops**: Can multiple Wiggum loops run simultaneously?

---

## Detailed Specifications for Implementation

### File Format Specifications

#### `PROMPT.md` - The Loop Instructions

**Purpose**: Instructions fed to agent each iteration (never changes during loop)

**Structure**:
```markdown
# Task: Refine Research Artifact

You are in a Ralph Wiggum loop. Your goal is to iteratively improve a research artifact until it meets quality standards.

## Your Process (ONE improvement per iteration)

1. Read `fix_plan.md` to see what needs improvement
2. Pick the SINGLE most important item (you decide priority)
3. Read the current artifact at `iteration-{N}/artifact.md`
4. Make ONE focused improvement
5. Update `fix_plan.md` (mark item complete, add new issues found)
6. Save improved artifact to `iteration-{N+1}/artifact.md`
7. Write `iteration-{N+1}/review.md` explaining what you changed and why
8. Exit (fresh context next iteration)

## Quality Standards

The artifact should have:
- **Completeness**: All required sections present and substantive
- **Verification**: Claims backed by evidence (links, logs, code references)
- **Clarity**: Clear structure, readable, well-organized
- **Actionability**: Specific recommendations with concrete steps

## Signs (Learnings from Previous Failures)

{This section gets populated as loop runs and failures occur}

## Exit Conditions

Exit when:
- `fix_plan.md` is empty (no more improvements needed)
- Quality threshold met (all metrics > 0.85)
- Max iterations reached

DO NOT try to do multiple improvements in one iteration.
DO NOT add placeholder content.
DO NOT skip updating fix_plan.md.
```

#### `fix_plan.md` - The Dynamic Task List

**Purpose**: What needs improvement, what's done, what's broken

**Structure**:
```markdown
# Improvement Plan

## Status
- Iteration: 3
- Quality Score: 0.72 (target: 0.85)
- Items Remaining: 4

## Incomplete Items

### HIGH PRIORITY
- [ ] Add evidence links for "Monarch logs show 18 errors" claim
- [ ] Expand "Root Cause" section with technical details

### MEDIUM PRIORITY
- [ ] Improve structure of "Findings" section (too dense)
- [ ] Add "What We Could Not Verify" section

### LOW PRIORITY
- [ ] Fix typos in Executive Summary

## Completed Items
- [x] Add Executive Summary (iteration 1)
- [x] Organize findings into clear sections (iteration 2)
- [x] Add Isengard log links (iteration 3)

## Issues Discovered During Loop
- Iteration 2: Found missing IAM policy details
- Iteration 3: Realized customer account ID not verified

## Quality Metrics (Current)
- Completeness: 0.80 (8/10 sections present)
- Verification: 0.65 (13/20 claims have evidence)
- Clarity: 0.75 (readable but could be better organized)
- Actionability: 0.70 (recommendations present but not specific enough)
```

#### `AGENT.md` - Project Conventions and Signs

**Purpose**: How to work with this artifact, learnings from failures

**Structure**:
```markdown
# Agent Conventions for Research Artifact Refinement

## Artifact Type
Research artifact from research-agent delegation

## File Locations
- Current artifact: `iteration-{N}/artifact.md`
- Previous iteration: `iteration-{N-1}/artifact.md`
- Original artifact: `../artifact.md`

## How to Validate
Run: `studio-agents validate-research iteration-{N}/artifact.md`
Returns quality scores (0.0-1.0) for each metric

## How to Commit
```bash
git add wiggum/iteration-{N}/*
git commit -m "Wiggum iteration {N}: {brief description}"
```

## Signs (Learnings from Failures)

### Sign 1: Always verify evidence links
**Why**: Iteration 2 added broken Isengard links
**Fix**: Test each link before adding to artifact

### Sign 2: Don't rewrite entire sections
**Why**: Iteration 4 rewrote "Findings" and lost important details
**Fix**: Make surgical edits, preserve existing good content

### Sign 3: Update fix_plan.md BEFORE exiting
**Why**: Iteration 5 forgot to update plan, next iteration was confused
**Fix**: Always update plan as last step before exit

## Artifact Structure Requirements
- Executive Summary (required)
- Context (required)
- Findings (required)
- Root Cause (required)
- Recommendations (required)
- Open Questions (optional)
- References (required)
```

### The Planning Phase: Generating Initial fix_plan.md

**Before the loop starts**, we need to generate the initial `fix_plan.md`. This is a separate operation:

```bash
# Step 1: User runs delegation
studio-agents delegate start research-topic task.md
# → Produces artifact at ~/Documents/goga/.backlog/artifacts/research-topic-2026-01-24/artifact.md

# Step 2: User decides to use Wiggum
studio-agents wiggum start research-topic \
  --artifact-path ~/Documents/goga/.backlog/artifacts/research-topic-2026-01-24

# Step 3: Wiggum runs PLANNING MODE (one-time, before loop)
# Spawns agent with planning prompt:
```

**Planning Prompt** (one-time, generates fix_plan.md):
```markdown
# Task: Generate Improvement Plan

You are preparing a research artifact for iterative refinement using the Ralph Wiggum loop.

## Your Task

1. Read the artifact at `../artifact.md`
2. Evaluate it against quality standards (see below)
3. Generate a comprehensive `fix_plan.md` with ALL improvements needed
4. Prioritize items (HIGH/MEDIUM/LOW)
5. Calculate initial quality scores

## Quality Standards

Evaluate on these dimensions (0.0-1.0):
- **Completeness**: Are all required sections present and substantive?
- **Verification**: Are claims backed by evidence?
- **Clarity**: Is it well-structured and readable?
- **Actionability**: Are recommendations specific and concrete?

## Output Format

Write `fix_plan.md` with:
- Status section (iteration 0, current quality scores)
- Incomplete items (categorized by priority)
- Quality metrics breakdown

DO NOT implement improvements yet. Just identify what needs work.
```

**After planning**: Loop begins with `fix_plan.md` populated.

### Agent Process Spawning: The Exact Mechanism

**Which agent**: Use the same agent that created the artifact (e.g., research-agent for research artifacts)

**How to spawn**:
```rust
// Pseudocode for iteration loop
fn run_wiggum_loop(artifact_path: &Path, max_iterations: u32) -> Result<()> {
    let wiggum_dir = artifact_path.join("wiggum");
    
    // Planning phase (one-time)
    spawn_agent_process(
        agent: "research-agent",
        prompt_file: wiggum_dir.join("PLANNING_PROMPT.md"),
        working_dir: wiggum_dir,
        output: "fix_plan.md"
    )?;
    
    // Loop phase
    for iteration in 1..=max_iterations {
        let iteration_dir = wiggum_dir.join(format!("iteration-{:03}", iteration));
        fs::create_dir_all(&iteration_dir)?;
        
        // Check exit conditions BEFORE spawning
        if is_fix_plan_empty(&wiggum_dir)? {
            println!("✓ Loop complete: fix_plan.md is empty");
            break;
        }
        
        if quality_threshold_met(&wiggum_dir)? {
            println!("✓ Loop complete: quality threshold met");
            break;
        }
        
        // Spawn fresh agent process
        let result = spawn_agent_process(
            agent: "research-agent",
            prompt_file: wiggum_dir.join("PROMPT.md"),
            working_dir: iteration_dir,
            env: {
                "ITERATION": iteration.to_string(),
                "PREV_ITERATION": (iteration - 1).to_string(),
            }
        )?;
        
        // Agent exits → context destroyed
        // Next iteration starts fresh
        
        // Validate iteration output
        validate_iteration(&iteration_dir)?;
        
        // Commit iteration
        git_commit(&iteration_dir, &format!("Wiggum iteration {}", iteration))?;
    }
    
    Ok(())
}

fn spawn_agent_process(agent: &str, prompt_file: &Path, working_dir: &Path, env: HashMap<String, String>) -> Result<()> {
    // Option 1: Use kiro-cli chat
    Command::new("kiro-cli")
        .arg("chat")
        .arg("--agent").arg(agent)
        .arg("--prompt").arg(prompt_file)
        .current_dir(working_dir)
        .envs(env)
        .status()?;
    
    // Option 2: Direct API call (future)
    // let client = AnthropicClient::new();
    // client.create_message(prompt, system_prompt, ...)?;
    
    Ok(())
}
```

### Exit Conditions: Concrete Detection

**1. fix_plan.md is empty**:
```rust
fn is_fix_plan_empty(wiggum_dir: &Path) -> Result<bool> {
    let fix_plan = fs::read_to_string(wiggum_dir.join("fix_plan.md"))?;
    
    // Parse markdown, check if "Incomplete Items" section has any unchecked items
    let has_incomplete = fix_plan.contains("- [ ]");
    
    Ok(!has_incomplete)
}
```

**2. Quality threshold met**:
```rust
fn quality_threshold_met(wiggum_dir: &Path) -> Result<bool> {
    let fix_plan = fs::read_to_string(wiggum_dir.join("fix_plan.md"))?;
    
    // Parse quality metrics from fix_plan.md
    let metrics = parse_quality_metrics(&fix_plan)?;
    
    // Check if all metrics above threshold (default 0.85)
    Ok(metrics.completeness >= 0.85 
        && metrics.verification >= 0.85
        && metrics.clarity >= 0.85
        && metrics.actionability >= 0.85)
}
```

**3. Agent signals done**:
Agent updates fix_plan.md to mark all items complete and sets quality scores above threshold.

### Backpressure/Validation: The Quality Check

**After each iteration**, validate the output:

```rust
fn validate_iteration(iteration_dir: &Path) -> Result<ValidationResult> {
    // 1. Check required files exist
    require_file_exists(iteration_dir.join("artifact.md"))?;
    require_file_exists(iteration_dir.join("review.md"))?;
    require_file_exists(iteration_dir.parent().unwrap().join("fix_plan.md"))?;
    
    // 2. Run quality metrics
    let artifact = fs::read_to_string(iteration_dir.join("artifact.md"))?;
    let metrics = calculate_quality_metrics(&artifact)?;
    
    // 3. Check if improvement was made
    let prev_iteration = iteration_dir.parent().unwrap()
        .join(format!("iteration-{:03}", get_iteration_number(iteration_dir)? - 1));
    
    if prev_iteration.exists() {
        let prev_artifact = fs::read_to_string(prev_iteration.join("artifact.md"))?;
        let prev_metrics = calculate_quality_metrics(&prev_artifact)?;
        
        if metrics.overall_score <= prev_metrics.overall_score {
            warn!("⚠️  Quality did not improve this iteration");
        }
    }
    
    Ok(ValidationResult { metrics, improved: true })
}

fn calculate_quality_metrics(artifact: &str) -> Result<QualityMetrics> {
    // Completeness: Check required sections present
    let completeness = check_sections_present(artifact)?;
    
    // Verification: Count claims with evidence links
    let verification = count_evidence_links(artifact)?;
    
    // Clarity: Readability score (sentence length, structure)
    let clarity = calculate_readability(artifact)?;
    
    // Actionability: Check recommendations have concrete steps
    let actionability = check_actionable_recommendations(artifact)?;
    
    Ok(QualityMetrics {
        completeness,
        verification,
        clarity,
        actionability,
        overall_score: (completeness + verification + clarity + actionability) / 4.0
    })
}
```

### The Watch Experience: Real-Time Monitoring

```bash
studio-agents wiggum watch research-topic
```

**What it shows**:
```
🔄 Wiggum Loop: research-topic
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: Running
Iteration: 3 / 10
Quality: 0.72 → 0.85 (target)
Items Remaining: 4

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Quality Metrics
  Completeness:   ████████░░ 0.80
  Verification:   ██████░░░░ 0.65
  Clarity:        ███████░░░ 0.75
  Actionability:  ███████░░░ 0.70

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Current Iteration (3)
  Started: 2026-01-24 19:15:32
  Working on: Add evidence links for Monarch logs claim
  
  Agent output (live):
  > Reading fix_plan.md...
  > Picking highest priority item: Add evidence links
  > Loading current artifact...
  > Searching for Monarch log references...
  > Generating Isengard deep link...
  > Updating artifact with evidence...
  > Marking item complete in fix_plan.md...
  > Writing review.md...
  > Done. Exiting.
  
  ✓ Iteration 3 complete (2m 34s)
  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Recent Changes
  Iteration 3: Added Isengard link for Monarch error logs
  Iteration 2: Organized findings into clear sections
  Iteration 1: Added Executive Summary

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Commands:
  [s] Stop loop
  [p] Pause after current iteration
  [a] Add sign to AGENT.md
  [q] Quit watch (loop continues)
```

**Adding a "sign" during watch**:
```
Press 'a' → Opens editor:

# New Sign

What went wrong?
> Iteration 3 added broken Isengard link

What should agent do differently?
> Test each Isengard link before adding to artifact

[Save and continue]
```

This gets appended to `AGENT.md` automatically.

### Integration with Existing Delegation

**Delegation artifact structure** (current):
```
~/Documents/goga/.backlog/artifacts/research-topic-2026-01-24/
├── artifact.md
├── task.md
└── metadata.json
```

**After Wiggum start**:
```
~/Documents/goga/.backlog/artifacts/research-topic-2026-01-24/
├── artifact.md              # Original (preserved)
├── task.md
├── metadata.json
└── wiggum/                  # New directory
    ├── PROMPT.md
    ├── PLANNING_PROMPT.md
    ├── fix_plan.md
    ├── AGENT.md
    ├── iteration-001/
    ├── iteration-002/
    └── final/
```

**Artifact type detection**:
```rust
fn detect_artifact_type(artifact_path: &Path) -> Result<ArtifactType> {
    let metadata = fs::read_to_string(artifact_path.join("metadata.json"))?;
    let meta: Metadata = serde_json::from_str(&metadata)?;
    
    match meta.agent_type.as_str() {
        "research-agent" => Ok(ArtifactType::Research),
        "design-agent" => Ok(ArtifactType::Design),
        "code-agent" => Ok(ArtifactType::Code),
        _ => Err("Unknown artifact type")
    }
}
```

Different artifact types get different:
- Quality metrics
- PROMPT.md templates
- Validation rules

### Concrete Example: Full Iteration Flow

**Initial state** (after delegation):
```markdown
# artifact.md (original)

## Executive Summary
Research shows Monarch UI has IAM permission issues.

## Findings
- Errors in logs
- Customer reports problems

## Root Cause
Missing IAM permissions.

## Recommendations
Add permissions.
```

**After planning phase** (`fix_plan.md` generated):
```markdown
# Improvement Plan

## Incomplete Items

### HIGH PRIORITY
- [ ] Add specific error messages from logs
- [ ] Add Isengard links to Monarch logs
- [ ] Specify which IAM permissions are missing
- [ ] Provide exact IAM policy to add

### MEDIUM PRIORITY
- [ ] Expand Findings with technical details
- [ ] Add "What We Verified" section
- [ ] Add "What We Could Not Verify" section

### LOW PRIORITY
- [ ] Improve Executive Summary clarity

## Quality Metrics (Current)
- Completeness: 0.50 (5/10 sections)
- Verification: 0.20 (1/5 claims have evidence)
- Clarity: 0.60 (basic structure present)
- Actionability: 0.30 (recommendations too vague)
- Overall: 0.40
```

**Iteration 1**: Agent picks "Add specific error messages from logs"
```markdown
# iteration-001/artifact.md

## Executive Summary
Research shows Monarch UI has IAM permission issues causing AccessDenied errors.

## Findings
- Errors in logs: "User: arn:aws:sts::123456:assumed-role/MonarchUIRole is not authorized to perform: iam:ListRoleTags"
- Customer reports problems accessing role details

## Root Cause
Missing IAM permissions.

## Recommendations
Add permissions.
```

**Iteration 1**: Agent updates `fix_plan.md`:
```markdown
## Completed Items
- [x] Add specific error messages from logs (iteration 1)

## Incomplete Items
### HIGH PRIORITY
- [ ] Add Isengard links to Monarch logs
- [ ] Specify which IAM permissions are missing (iam:ListRoleTags identified)
- [ ] Provide exact IAM policy to add
...
```

**Iteration 2**: Agent picks "Add Isengard links to Monarch logs"
```markdown
# iteration-002/artifact.md

## Findings
- Errors in logs [1]: "User: arn:aws:sts::123456:assumed-role/MonarchUIRole is not authorized to perform: iam:ListRoleTags"
- Customer reports problems accessing role details

## References
[1] Monarch UI logs - [Isengard link](https://isengard.amazon.com/...)
```

**And so on...**

### Technical Implementation: State Management

**Loop state file** (`.wiggum-state.json`):
```json
{
  "topic": "research-topic",
  "artifact_path": "/Users/gkoreli/Documents/goga/.backlog/artifacts/research-topic-2026-01-24",
  "status": "running",
  "current_iteration": 3,
  "max_iterations": 10,
  "quality_threshold": 0.85,
  "started_at": "2026-01-24T19:15:00Z",
  "pid": 12345,
  "agent_type": "research-agent"
}
```

**File locking**:
```rust
fn acquire_loop_lock(artifact_path: &Path) -> Result<FileLock> {
    let lock_file = artifact_path.join("wiggum/.lock");
    
    if lock_file.exists() {
        let state: LoopState = read_state(&artifact_path)?;
        if is_process_running(state.pid) {
            return Err("Loop already running for this artifact");
        } else {
            // Stale lock, remove it
            fs::remove_file(&lock_file)?;
        }
    }
    
    // Create lock
    fs::write(&lock_file, format!("{}", std::process::id()))?;
    Ok(FileLock { path: lock_file })
}
```

**Error handling**:
```rust
fn handle_agent_crash(iteration_dir: &Path) -> Result<()> {
    warn!("⚠️  Agent crashed during iteration");
    
    // Check if partial output exists
    if iteration_dir.join("artifact.md").exists() {
        warn!("Partial artifact found, discarding");
        fs::remove_dir_all(iteration_dir)?;
    }
    
    // Retry same iteration with fresh context
    Ok(())
}
```

### User Experience: Complete Flow

**Step 1**: User runs delegation
```bash
$ studio-agents delegate start research-monarch-iam task.md

✓ Delegation started
✓ Research complete
✓ Artifact saved to: ~/Documents/goga/.backlog/artifacts/research-monarch-iam-2026-01-24/artifact.md

View artifact: studio-agents delegate view research-monarch-iam
```

**Step 2**: User reviews artifact, decides to refine
```bash
$ studio-agents delegate view research-monarch-iam

# Shows artifact in terminal

$ studio-agents wiggum start research-monarch-iam --max-iterations 10

🔄 Starting Wiggum loop for research-monarch-iam

Phase 1: Planning
  ✓ Reading artifact...
  ✓ Evaluating quality...
  ✓ Generating improvement plan...
  
  Quality Score: 0.40 / 0.85 (target)
  Items to improve: 8
  
Phase 2: Iteration Loop
  Starting iteration 1...
  
  To watch progress: studio-agents wiggum watch research-monarch-iam
  To stop: studio-agents wiggum stop research-monarch-iam
```

**Step 3**: User watches loop (optional)
```bash
$ studio-agents wiggum watch research-monarch-iam

# Shows real-time progress (see "Watch Experience" section above)
```

**Step 4**: Loop completes
```bash
✓ Wiggum loop complete!

  Iterations: 6 / 10
  Final Quality: 0.88 / 0.85
  Time: 18m 42s
  Cost: $4.23
  
  Final artifact: ~/Documents/goga/.backlog/artifacts/research-monarch-iam-2026-01-24/wiggum/final/artifact.md
  
  View changes: studio-agents wiggum diff research-monarch-iam
  View summary: studio-agents wiggum summary research-monarch-iam
```

**Step 5**: User reviews final artifact
```bash
$ studio-agents wiggum summary research-monarch-iam

📊 Wiggum Loop Summary: research-monarch-iam

Quality Improvement:
  Before: 0.40 → After: 0.88 (+120%)
  
Iterations: 6
  1. Added specific error messages from logs
  2. Added Isengard links to Monarch logs  
  3. Specified missing IAM permission (iam:ListRoleTags)
  4. Provided exact IAM policy to add
  5. Expanded Findings with technical details
  6. Added "What We Verified" section

Metrics:
  Completeness:   0.50 → 0.90
  Verification:   0.20 → 0.85
  Clarity:        0.60 → 0.90
  Actionability:  0.30 → 0.90
```

---

## Additional Implementation Details

### CLI Command Structure

```bash
studio-agents wiggum <subcommand> [options]

Subcommands:
  start <topic>      Start Wiggum loop on artifact
  stop <topic>       Stop running loop
  watch <topic>      Watch loop progress (real-time)
  status <topic>     Check loop status
  summary <topic>    Show loop summary after completion
  diff <topic>       Show changes made by loop
  list               List all running/completed loops

Options for 'start':
  --artifact-path <path>      Path to artifact directory (required)
  --max-iterations <n>        Max iterations (default: 10)
  --quality-threshold <n>     Quality threshold 0.0-1.0 (default: 0.85)
  --agent <name>              Agent to use (default: auto-detect from artifact)
  --watch                     Start watching immediately after start
```

### Configuration File

**`~/.studio-agents/wiggum.toml`**:
```toml
[defaults]
max_iterations = 10
quality_threshold = 0.85
auto_watch = false

[quality_metrics]
completeness_weight = 0.25
verification_weight = 0.30
clarity_weight = 0.20
actionability_weight = 0.25

[safety]
max_cost_per_loop = 10.00  # USD
max_time_per_iteration = 600  # seconds
require_human_review_at_iteration = 0  # 0 = disabled

[agents]
research-agent = "kiro-cli chat --agent research-agent"
design-agent = "kiro-cli chat --agent design-agent"
```

---

## Next Steps

1. **Prototype**: Build MVP of `studio-agents wiggum start`
2. **Test**: Run on existing research artifacts
3. **Measure**: Track quality improvement across iterations
4. **Refine**: Adjust based on real-world usage
5. **Document**: Create usage guide and examples
6. **Skill**: Build skill that teaches agent about Wiggum
