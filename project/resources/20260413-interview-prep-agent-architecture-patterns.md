# Interview Prep: Agent Architecture Patterns in This Codebase

This document maps the patterns in this legal conveyancing AI agent to three interview topics: agent-first architecture, AI agent frameworks/prompt engineering, and multi-tenant design with external integrations.

## 1. Agent-First Architecture: Decision Context & Multi-Step Reasoning

```
The platform is built around an agent-first architecture with a strong focus on capturing decision context and building systems that reason, not just respond. Be prepared to discuss how you approach building and scaling systems that manage context, orchestrate tools, and support multi-step reasoning.
```

### Multi-Step Agent Loop

The chat route (`src/app/api/chat/route.ts`) runs `streamText` with `stopWhen: stepCountIs(5)`. This is the Vercel AI SDK's agentic loop: the model calls a tool, receives the result, reasons over it, calls another tool, and repeats until it has enough context to respond with text. A single user message like "what should I do next?" can trigger a 4-step chain:

1. `getCurrentStage` — get the current stage and property context
2. `getPendingTasks` — get incomplete actions in the current stage
3. `suggestNextActions` — get prioritised guidance with legal timing
4. Model synthesises into a final text response

`stepCountIs(5)` is the safety cap preventing runaway loops. `maxDuration = 60` is the wall-clock companion guard.

### Tool Orchestration: Read-Check-Write Hierarchy

The 6 tools in `src/lib/ai/tools.ts` are deliberately ordered:

| Tool | Type | Purpose |
|------|------|---------|
| `getCurrentStage` | Read | Orientation — always called first |
| `getPendingTasks` | Read | Get valid action IDs before writes |
| `markTaskComplete` | Write | Accepts `actionId` from `getPendingTasks` |
| `getMatterSummary` | Read | Aggregated view of all 10 stages |
| `suggestNextActions` | Read | Domain-enriched guidance with timing |
| `advanceStage` | Write | Delegates to state machine |

The system prompt enforces ordering: "call getCurrentStage FIRST", "MUST call getPendingTasks first to get correct action IDs. Never guess or fabricate action IDs." This is prompt-based guard railing — the model can't write without reading first.

### State Machine as Hard Constraint

`src/lib/state-machine/conveyancing.ts` implements `tryAdvanceStage()` with a 6-step guard sequence:

1. Matter existence check
2. Current stage row lookup with eager-loaded actions
3. Filter incomplete actions — if any exist, return their descriptions so the LLM can tell the user what's blocking
4. `getNextStage()` — pure function navigating the enum array order
5. Next stage row existence check
6. Three sequential DB updates: current stage -> completed, next stage -> in_progress, matter -> currentStage updated

The LLM cannot skip stages. If tasks are incomplete, the state machine returns the blockers. This is "systems that reason" — the agent understands workflow rules, not just chat.

### Decision Context via Observability

Every chat request creates a Langfuse trace via `propagateAttributes()`:
- `sessionId: matterId` — groups the full conversation history for a matter
- `updateActiveObservation` logs input (system prompt + messages)
- `onFinish` logs output
- `experimental_telemetry: { isEnabled: true }` auto-creates OTel spans for each model inference and tool call

User feedback (thumbs up/down + comments at `/api/feedback`) is linked to traces via `langfuseTraceId` embedded in message metadata. This creates a human-in-the-loop feedback signal tied to specific agent decisions.

### Server-Side Context Injection

`src/lib/ai/agent-context.ts` defines the `experimental_context` pattern. `matterId` and `db` are injected server-side into every tool's `execute(input, options)` call. Two security properties:

1. The LLM never sees `matterId` or `db` — they're not in the model messages
2. The LLM cannot fabricate or override them — they're outside the context window

This is the same architectural pattern as MCP (Model Context Protocol) — the server acts as a tool provider for the LLM.

## 2. AI Agent Frameworks, Prompt Engineering & Workflow Structure

```
You should be comfortable discussing modern AI agent frameworks, prompt engineering, and how you think about structuring agent workflows across multiple interactions. Experience or opinions on emerging tooling and patterns in this space will be valuable.
```

### Framework Choices

- **Vercel AI SDK v6** — provider-agnostic (`LanguageModelV3` interface), built-in streaming, tool calling, multi-step agent loop. `src/lib/ai/model.ts` has 5 providers behind one interface.
- **Langfuse** — prompt management with `cacheTtlSeconds: 60` (stale-while-revalidate). Prompt changes propagate in <60s with zero deploys. `isFallback` tracks whether Langfuse or the hardcoded constant was used. Traces are linked to exact prompt versions for A/B analysis.
- **`experimental_context`** — keeps server-side state invisible to the model.

### System Prompt Structure

The prompt at `src/lib/ai/prompts.ts` is structured in 5 sections:

1. **Role disclaimer** — "not legal advice / workflow guidance only" (repeated in UI footer for defense-in-depth)
2. **Tool usage rules** — explicit numbered ordering matching the tool names
3. **10-stage domain knowledge** — each block has legislation references (e.g., "Conveyancing Act 1919 (NSW)", "s174 Legal Profession Uniform Law"), timing constraints ("s10.7 takes 2-4 weeks, critical path"), and a key risk paragraph
4. **Stage advancement rule** — restates the state machine logic in natural language
5. **Australian terminology glossary** — PEXA, stamp duty, s66W, requisitions, etc.

Tool descriptions in `tools.ts` are also part of the prompt sent to the model — they control behaviour, not just document it. The `suggestNextActions` tool has a hardcoded `contextualGuidance` lookup for legal timing knowledge too granular for the system prompt.

### Cross-Interaction Workflow

- **Conversation state** is client-side (`useChat` maintains the messages array in `ChatPanel.tsx`)
- **Matter state** is server-side (database stages + actions)
- `router.refresh()` after each assistant response re-renders server components so `StageProgress` reflects tool-call mutations
- `ai_chats`/`ai_chat_messages` tables exist in schema for future persistence (currently unused — MVP keeps conversation in client state)

## 3. Multi-Tenant Design & External Platform Integration

```
Additionally, expect to discuss how you would design systems that support multi-tenant environments and integrate with external platforms such as CRMs and third-party APIs.
```

### What Multi-Tenancy Means Here

Multi-tenancy means one application instance serving multiple separate customers (tenants) where each tenant's data is isolated from the others. In this context: multiple law firms using the platform. Firm A should never see Firm B's matters, stages, actions, or chat history — even though they share the same database and Next.js app. This is directly relevant to LEAP, which serves many law firms on one platform.

### Tenant-Hierarchical Schema

```
firm -> properties -> matters -> matterStages -> matterActions
                              \-> aiChats -> aiChatMessages
```

Six tables in `src/db/schema.ts`. Every query accepts `matterId` as a parameter. The `markActionComplete` query in `src/lib/db/queries/actions.ts` has a cross-matter ownership guard — it joins through `matterStages` to verify the action belongs to the given matter before updating. This is already an example of tenant isolation at the matter level.

### Path to Full Multi-Tenancy

The data model is already hierarchical (`matters -> stages -> actions`), which is the shape multi-tenancy requires. The missing piece is a tenant ID column and an enforcement layer.

**Step 1: Add tenant identity** — add `firmId`/`orgId` column to `matters`. Everything downstream is already scoped through `matterId`, so the tenant boundary propagates automatically.

**Step 2: Enforcement layer** — three approaches, increasing in isolation strength:

| Approach | How it works | Trade-off |
|----------|-------------|-----------|
| **Row-level scoping** | One database, filter every query by `firmId`. Neon supports Postgres RLS (row-level security) which enforces at the DB level — a missed `WHERE` clause can't leak data. In Drizzle: `.where(eq(matters.firmId, ctx.firmId))` | Cheapest. Weakest isolation. A bug in RLS policy could expose data. |
| **Schema-per-tenant** | One database, separate Postgres schemas per firm. Each firm's tables are in their own namespace. | Stronger isolation. More migration overhead — schema changes must be applied per tenant. |
| **Database-per-tenant** | Neon's branching makes this feasible — spin up a branch per firm. Complete data isolation. | Strongest isolation. Highest cost and operational complexity. |

For a platform like LEAP serving law firms (where data confidentiality is critical), RLS as the minimum with schema-per-tenant for high-value clients is a reasonable default.

**What already works:** The `experimental_context` pattern that injects `matterId` server-side (invisible to the LLM) would extend naturally to carry `firmId` too. Every tool call would be scoped to both the firm and the matter without the model knowing.

### External Platform Integration Patterns

The existing architecture has the patterns needed for CRM/API integration:

- **Tool architecture** — adding a `syncToCRM` tool follows the same pattern as the existing 6. The model decides when to sync based on context (e.g., after stage advancement).
- **`experimental_context`** — would carry CRM credentials/API clients the same way it carries `db`
- **Webhook pattern** — `onFinish` callback in `streamText` is the hook point for POSTing stage changes to external systems
- **Observability** — all external calls would be traced as Langfuse spans for latency and failure visibility

### Multi-Provider Resilience (Proof of External API Thinking)

- 5 LLM providers with `getModelWithFallbacks()` in `src/lib/ai/model.ts`
- Client-side retry with `modelIndex` — `ChatPanel.tsx` uses `Resolvable` body (`body: () => ({...})`) to send dynamic retry state per request
- Stateless server — client tracks which model to try, server picks `models[modelIndex % length]`
- Same pattern applies to any external API: try primary, fall back, track state client-side

## Key Talking Points

1. **Agent, not chatbot** — multi-step tool chains with a state machine, not just Q&A
2. **Observability is first-class** — every decision traced, every tool call a span, feedback linked to traces
3. **The prompt IS the product** — Langfuse prompt management means iteration without deploys, with version tracking
4. **Security by architecture** — `experimental_context` keeps server state invisible to model, cross-matter guards on writes
5. **Schema is multi-tenant ready** — hierarchical structure, all queries scoped by matter ID, ownership guards on mutations
6. **Provider resilience** — client-driven failover with `modelIndex` and `Resolvable` body, applicable to any external integration

## References

- `src/app/api/chat/route.ts` — orchestration hub
- `src/lib/ai/tools.ts` — 6 agent tools with read-check-write hierarchy
- `src/lib/ai/agent-context.ts` — `experimental_context` injection
- `src/lib/ai/prompts.ts` — system prompt + Langfuse prompt management
- `src/lib/ai/model.ts` — provider chain and fallback logic
- `src/lib/state-machine/conveyancing.ts` — stage advancement guards
- `src/db/schema.ts` — 6 tables, enums, relations
- `src/components/chat/ChatPanel.tsx` — client-side retry, feedback, traceId extraction
- `src/app/api/feedback/route.ts` — Langfuse score creation
- `src/instrumentation.ts` — OTel + Langfuse provider registration
- `src/lib/ai/chat-types.ts` — `ChatMessageMetadata` threading `langfuseTraceId`
- `src/lib/db/queries/actions.ts` — cross-matter ownership guard
- `src/lib/db/queries/stages.ts` — `getNextStage()`, stage aggregation queries
