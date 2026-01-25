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

## Next Steps

1. **Prototype**: Build MVP of `studio-agents wiggum start`
2. **Test**: Run on existing research artifacts
3. **Measure**: Track quality improvement across iterations
4. **Refine**: Adjust based on real-world usage
5. **Document**: Create usage guide and examples
6. **Skill**: Build skill that teaches agent about Wiggum
