# Matter Lifecycle Progression Agent - Research

**Researched:** 2026-04-06
**Domain:** AI SDK v6 tool calling + agent loop, state machine for conveyancing stages, useChat frontend, NSW conveyancing domain
**Confidence:** HIGH (AI SDK v6 API surface) / MEDIUM (state machine design, frontend patterns) / MEDIUM (conveyancing domain accuracy)

## Summary

Feature #4 is the core demo: an AI agent that analyzes a conveyancing matter's current state, suggests next actions, flags risks, and tracks progress through 10 stages. The implementation spans three layers -- agent backend (tools + system prompt + state machine), API route (streaming), and frontend (chat UI + stage progress).

The AI SDK v6 provides two architectural paths for this. **Option A** extends the existing `streamText` pattern in `route.ts` by adding tools and `stopWhen` for multi-step agent behavior, then uses `toUIMessageStreamResponse()` to feed the `useChat` hook. **Option B** uses the `ToolLoopAgent` class (the SDK's first-class agent abstraction) with `createAgentUIStreamResponse()` for a cleaner separation of agent definition from route handling. Both are fully supported in v6; the key trade-off is between Option A's compatibility with the existing Langfuse `observe()` pattern and Option B's cleaner architecture but unknown Langfuse integration story.

The state machine is application-level logic, not an AI SDK concern. The 10 conveyancing stages form a strictly linear sequence. The agent reads state via tools, suggests actions, and can mark tasks complete -- but stage advancement should be validated by the state machine (all tasks in the current stage must be complete before advancing). The agent assists, the state machine enforces.

**Primary recommendation:** Start with Option A (extend `streamText` with tools) because it preserves the proven Langfuse `observe()` + `endOnExit: false` pattern and avoids re-engineering the telemetry layer. The `ToolLoopAgent` abstraction is cleaner but its interaction with manual OTel span management is unverified. Install `@ai-sdk/react` for the `useChat` hook. Use `experimental_context` to pass `matterId` into tool execute functions.

## Standard Stack

### Core

| Library          | Version               | Purpose                                                               | License    | Maintained?          | Why Standard                                                 |
| ---------------- | --------------------- | --------------------------------------------------------------------- | ---------- | -------------------- | ------------------------------------------------------------ |
| `ai`             | 6.0.146               | streamText, tool(), stopWhen, convertToModelMessages, UIMessage types | Apache-2.0 | Yes (daily releases) | Already installed; core of agent loop                        |
| `@ai-sdk/react`  | ^3.x (match ai major) | useChat hook for streaming chat UI                                    | Apache-2.0 | Yes (same monorepo)  | Required for React chat integration; not re-exported by `ai` |
| `@ai-sdk/google` | 3.0.58                | Gemini provider with tool calling                                     | Apache-2.0 | Yes                  | Already installed; primary provider                          |
| `@ai-sdk/groq`   | 3.0.33                | Groq/Llama provider with tool calling                                 | Apache-2.0 | Yes                  | Already installed; fallback provider                         |
| `drizzle-orm`    | 0.45.2                | Database queries in tool handlers                                     | Apache-2.0 | Yes                  | Already installed; ORM layer                                 |
| `zod`            | 4.3.6                 | Tool input schema definitions                                         | MIT        | Yes                  | Already installed; used for validation                       |

### Supporting

| Library          | Version | Purpose                                    | When to Use                                                  |
| ---------------- | ------- | ------------------------------------------ | ------------------------------------------------------------ |
| `react-markdown` | ^10.x   | Render markdown in agent responses         | If agent responses include formatting (headers, lists, bold) |
| `remark-gfm`     | ^5.x    | GitHub Flavored Markdown tables/checkboxes | If agent uses tables or task lists in responses              |

### Alternatives Considered

| Instead of              | Could Use                          | Tradeoff                                                                                                                                  |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@ai-sdk/react` useChat | Custom fetch + useState            | useChat handles streaming protocol, message state, abort, retry out of the box. Hand-rolling this is error-prone and wastes demo time     |
| `react-markdown`        | Plain text rendering (no markdown) | Agent responses will include markdown syntax. Rendering raw markdown is unprofessional for a demo. Small investment, big polish           |
| `ToolLoopAgent` class   | Direct `streamText` with tools     | ToolLoopAgent is cleaner but its Langfuse integration is untested. streamText is already working with observe(). See Architecture Options |

**Installation:**

```bash
npm install @ai-sdk/react react-markdown remark-gfm
```

## Architecture Options

Two fundamentally different approaches to wiring the agent backend to the frontend.

| Option                                             | Description                                                                           | Pros                                                                                                                                                                                                 | Cons                                                                                                                                              | Best When                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **A: streamText + tools**                          | Extend existing route.ts with tools and stopWhen; use toUIMessageStreamResponse()     | Preserves existing Langfuse observe() pattern; proven telemetry; incremental change from current code; full control over the streaming pipeline                                                      | More boilerplate; manual message conversion; must manage stopWhen yourself; agent definition is coupled to route handler                          | Langfuse integration is critical to the demo; you want minimal risk on the telemetry layer   |
| **B: ToolLoopAgent + createAgentUIStreamResponse** | Define agent as ToolLoopAgent class; route handler uses createAgentUIStreamResponse() | Clean separation: agent definition in one file, route handler is ~10 lines; built-in stopWhen default (20 steps); agent is reusable and testable independently; SDK's recommended pattern for agents | Unknown interaction with Langfuse observe() + endOnExit: false; may require re-engineering telemetry; newer pattern with less community precedent | Clean architecture matters more than telemetry risk; you can test Langfuse integration first |

**Recommended:** Option A -- extend `streamText` with tools. The existing Langfuse `observe()` + `endOnExit: false` pattern is documented, tested, and working. The `ToolLoopAgent` is architecturally superior but introduces risk on the telemetry layer that was hard-won in prior work (see `project/decisions/20260406-140000-langfuse-telemetry-capture-pattern.md`). For a demo with limited time, preserving the working telemetry is more valuable than a cleaner agent abstraction.

### Counterarguments

Why someone might NOT choose Option A:

- **"ToolLoopAgent is the SDK's recommended pattern":** True, and if this were a longer-term project, Option B would be the right choice. But the Langfuse integration was the hardest part of the existing stack, and re-testing it against a different streaming pipeline is a time risk. **Response:** If there's time after the core agent works, refactor to Option B as a polish step. The tools and system prompt are identical between options -- only the wiring changes.

- **"Option A couples agent definition to the route handler":** True. The tools, system prompt, and stopWhen are all inline in route.ts. **Response:** Extract the tool definitions and system prompt into separate files (`src/lib/ai/tools.ts`, `src/lib/ai/prompts.ts`). The route handler assembles them. This gives ~80% of Option B's separation without changing the streaming pipeline.

- **"The ToolLoopAgent has experimental_telemetry support":** It does accept `experimental_telemetry` in its settings. But the Langfuse setup uses `observe()` wrapping the route handler, not just the telemetry config. Whether the `ToolLoopAgent`'s internal `streamText` calls inherit the active OTel span from `observe()` is unverified. **Response:** This is testable -- if someone wants to try, create the agent, wrap the route with observe(), and check Langfuse for traces. If it works, migrate.

## Architecture Patterns

### Recommended Project Structure

```
src/
  lib/
    ai/
      model.ts          # existing -- provider-agnostic model factory
      tools.ts           # NEW -- tool definitions with Zod schemas and execute functions
      prompts.ts         # NEW -- system prompt for conveyancing agent
      agent-context.ts   # NEW -- type definition for experimental_context (matterId, db)
    db/
      queries/
        matters.ts       # NEW -- Drizzle queries used by tool handlers
        stages.ts        # NEW -- stage progression queries
        actions.ts       # NEW -- action CRUD queries
    state-machine/
      conveyancing.ts    # NEW -- stage transition validation logic
  db/
    schema.ts           # existing -- table definitions
    index.ts            # existing -- db connection
    seed.ts             # existing -- seed data
  app/
    api/
      chat/
        route.ts        # existing -- extend with tools, stopWhen, toUIMessageStreamResponse
      matters/
        route.ts        # NEW -- GET matters list
        [id]/
          route.ts      # NEW -- GET single matter with stages and actions
    matters/
      page.tsx          # NEW -- matter selection/creation page
      [id]/
        page.tsx        # NEW -- matter view with chat + stage progress
  components/
    chat/
      chat-panel.tsx    # NEW -- useChat wrapper with message list
      message.tsx       # NEW -- single message renderer (text + tool calls)
      tool-indicator.tsx # NEW -- tool call status display
    matter/
      stage-progress.tsx # NEW -- vertical stage progress tracker
      action-list.tsx    # NEW -- task list for current stage
```

### Pattern 1: Tool Definition with Zod Schema

**What:** Each tool is defined using the `tool()` helper from `ai` with a Zod input schema, description, and execute function. The execute function receives the parsed input and `ToolExecutionOptions` which includes `experimental_context`.

**When to use:** Every tool in the agent's toolset.

**Example:**

```typescript
// Source: node_modules/@ai-sdk/provider-utils/dist/index.d.ts (Tool type, lines 1055-1138)
// Source: node_modules/@ai-sdk/provider-utils/dist/index.d.ts (ToolExecutionOptions, line 985)
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'

// Define context type for all tools
interface AgentContext {
  matterId: string
  db: typeof import('@/db').db
}

function getAgentContext(options: ToolExecutionOptions): AgentContext {
  return options.experimental_context as AgentContext
}

const getCurrentStage = tool({
  description: 'Get the current stage of the conveyancing matter, including status and progress',
  inputSchema: z.object({}),
  execute: async (_input, options) => {
    const { matterId, db } = getAgentContext(options)
    // Drizzle query to get matter's current stage
    // Return stage name, status, started date, completion percentage
  },
})
```

### Pattern 2: streamText with Tools and stopWhen (Option A)

**What:** The existing `tryStreamText` function is extended to accept tools and stopWhen. The response format changes from `toTextStreamResponse()` to `toUIMessageStreamResponse()` so useChat can parse tool call parts.

**When to use:** The API route handler.

**Example:**

```typescript
// Source: node_modules/ai/dist/index.d.ts (streamText, lines 2812-2920)
// Source: node_modules/ai/dist/index.d.ts (stopWhen, line 2831)
// Source: node_modules/ai/dist/index.d.ts (toUIMessageStreamResponse, line 2592)
import { streamText, convertToModelMessages, stepCountIs } from 'ai'

const result = streamText({
  model,
  system,
  messages: await convertToModelMessages(uiMessages),
  tools: {
    getCurrentStage,
    getPendingTasks,
    markTaskComplete,
    getMatterSummary,
    suggestNextActions,
  },
  stopWhen: stepCountIs(5), // Max 5 LLM calls per user message
  experimental_context: { matterId, db },
  experimental_telemetry: { isEnabled: true },
  onFinish: ({ text }) => {
    // Langfuse span lifecycle
    updateActiveObservation({ output: text })
    setActiveTraceIO({ output: text })
    trace.getActiveSpan()?.end()
  },
  onError: (error) => {
    // Langfuse error handling
    trace.getActiveSpan()?.end()
  },
})

// CRITICAL: use toUIMessageStreamResponse, NOT toTextStreamResponse
// toTextStreamResponse drops tool call parts -- useChat won't see them
return result.toUIMessageStreamResponse()
```

### Pattern 3: useChat Hook Integration

**What:** The `useChat` hook from `@ai-sdk/react` manages client-side message state, streaming, and UI updates. It connects to the API route via the default `DefaultChatTransport`.

**When to use:** The chat component on the matter view page.

**Example:**

```typescript
// Source: node_modules/ai/dist/index.d.ts (DefaultChatTransport body option, line 3925)
import { useChat } from '@ai-sdk/react'

const { messages, sendMessage, status, error } = useChat({
  // body is sent with every request -- use it to pass matterId
  body: { matterId },
  // Optionally customize the API endpoint
  api: '/api/chat',
})
```

### Pattern 4: Message Rendering with Parts

**What:** In AI SDK v6, messages have a `parts` array instead of a simple `content` string. Each part has a `type` (text, tool-\*, reasoning, file, etc.). Tool call parts have typed `state` values that track the lifecycle.

**When to use:** Rendering assistant messages in the chat UI.

**Example:**

```typescript
// Source: node_modules/ai/dist/index.d.ts (UIMessagePart, line 1684)
// Source: node_modules/ai/dist/index.d.ts (ToolUIPart states, lines 1800-1873)
import { isTextUIPart, isToolUIPart } from "ai";
import type { UIMessagePart } from "ai";

function MessageContent({ parts }: { parts: UIMessagePart[] }) {
  return parts.map((part, i) => {
    if (isTextUIPart(part)) {
      return <ReactMarkdown key={i}>{part.text}</ReactMarkdown>;
    }
    if (isToolUIPart(part)) {
      // part.state is one of: input-streaming, input-available, output-available, output-error
      // part.type is "tool-{toolName}" e.g. "tool-getCurrentStage"
      return <ToolIndicator key={i} name={part.type} state={part.state} />;
    }
    return null;
  });
}
```

### Pattern 5: convertToModelMessages for Server-Side Message Processing

**What:** When `useChat` sends messages to the API route, they arrive as `UIMessage[]` (with `parts` arrays). The server needs to convert these to `ModelMessage[]` for `streamText`. `convertToModelMessages` handles this.

**When to use:** In the API route handler, before passing messages to streamText.

**Example:**

```typescript
// Source: node_modules/ai/dist/index.d.ts (convertToModelMessages, line 3855)
import { convertToModelMessages } from 'ai'

// In the route handler:
const { messages: uiMessages, matterId } = parsed.data
const modelMessages = await convertToModelMessages(uiMessages)

const result = streamText({
  model,
  system,
  messages: modelMessages,
  tools,
  // ...
})
```

### Pattern 6: State Machine Validation in Stage Advancement

**What:** The state machine is pure application logic -- a function that validates whether a stage can be advanced based on task completion. The AI agent calls this through the `advanceStage` tool, but the state machine enforces the rules.

**When to use:** The `advanceStage` tool's execute function, and also in any direct API calls that advance stages.

**Example:**

```typescript
// Application logic -- not AI SDK specific
import { eq, and } from 'drizzle-orm'

type StageTransitionResult =
  | { success: true; newStage: string }
  | { success: false; reason: string; incompleteActions: string[] }

async function tryAdvanceStage(matterId: string, db: DbClient): Promise<StageTransitionResult> {
  // 1. Get current matter with its current stage
  // 2. Get all actions for the current stage
  // 3. Check if ALL actions are completed (or skipped)
  // 4. If not, return failure with list of incomplete actions
  // 5. If yes, update matter.currentStage to next stage enum value
  //    and update matterStages statuses
  // 6. Return success with new stage name
}
```

### Anti-Patterns to Avoid

- **Using toTextStreamResponse() with useChat:** `toTextStreamResponse()` only sends text deltas. Tool call parts, step boundaries, and metadata are dropped. The useChat hook will receive plain text but won't know about tool calls. Always use `toUIMessageStreamResponse()` when the frontend uses `useChat`.

- **Passing matterId as a tool input parameter:** Every tool would need a `matterId` input field, the LLM must remember to include it, and it can hallucinate the wrong ID. Use `experimental_context` instead -- the matterId is injected server-side and available in every tool's execute function. The LLM never sees or needs to provide it.

- **Letting the AI agent advance stages without validation:** The LLM might decide "all tasks are done, let's advance" based on conversation context rather than actual DB state. The `advanceStage` tool must query the database to verify all actions are complete before advancing. The agent suggests, the state machine enforces.

- **Using maxSteps instead of stopWhen:** In AI SDK v6, `maxSteps` is replaced by `stopWhen`. The default for `streamText` is `stepCountIs(1)` (single step, no tool loop). For agent behavior, you must explicitly set `stopWhen: stepCountIs(N)` where N > 1. The `ToolLoopAgent` defaults to `stepCountIs(20)`.

- **Storing UIMessage[] directly in the database:** UIMessages have runtime-only fields (streaming state, partial tool results). Store the essential fields: role, content text, tool calls and results. Reconstruct UIMessages from stored data when loading chat history.

- **Using `message.content` from old AI SDK versions:** v6 uses `UIMessage` with a `parts` array. There is no `content: string` on messages -- content is in `parts[].text`. Code that reads `message.content` will fail.

## Don't Hand-Roll

| Problem                    | Don't Build                              | Use Instead                                        | Why                                                                                                                                                    |
| -------------------------- | ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Streaming chat protocol    | Custom WebSocket or SSE parser           | `useChat` + `toUIMessageStreamResponse()`          | The AI SDK streaming protocol handles message boundaries, tool call lifecycle, error recovery, and reconnection. Rolling your own will have edge cases |
| Tool call type safety      | Manual type casting of tool inputs       | `tool()` helper with Zod schema                    | The `tool()` function infers input/output types from the Zod schema. Manual typing leads to runtime errors                                             |
| Message format conversion  | Manual mapping UIMessage to model format | `convertToModelMessages()`                         | Handles tool call/result pairs, file parts, data parts. Manual conversion will miss edge cases                                                         |
| Stage enum ordering        | Hard-coded stage index mapping           | Use `conveyancingStageEnum.enumValues` array index | The enum values are already ordered in schema.ts. Use `indexOf()` on the enum values array to get stage order                                          |
| Agent stop conditions      | Custom step counter in onStepFinish      | `stepCountIs(N)` from `ai`                         | Built-in, type-safe, composes with other conditions via array syntax                                                                                   |
| Markdown rendering in chat | regex-based markdown-to-HTML             | `react-markdown`                                   | Handles edge cases (nested formatting, code blocks, XSS) that regex cannot                                                                             |

## Common Pitfalls

### Pitfall 1: stopWhen Default is stepCountIs(1) for streamText

**What goes wrong:** You add tools to streamText but the agent only makes one LLM call and stops, even when tool results should trigger another LLM call to synthesize a response.
**Why it happens:** `streamText` defaults to `stopWhen: stepCountIs(1)` -- it calls the LLM once, and if the LLM returns tool calls, the tools execute but the LLM never sees the results. This is different from `ToolLoopAgent` which defaults to `stepCountIs(20)`.
**How to avoid:** Explicitly set `stopWhen: stepCountIs(5)` (or appropriate number) on `streamText`. Use `isLoopFinished()` if you want the LLM to decide when to stop (it stops when it generates text without tool calls).

### Pitfall 2: toTextStreamResponse Drops Tool Information

**What goes wrong:** The frontend shows agent text responses but tool call indicators never appear. The useChat hook's `messages` don't contain tool parts.
**Why it happens:** `toTextStreamResponse()` only sends text delta chunks. Tool call parts, step boundaries, and metadata are silently dropped. The existing route.ts uses `toTextStreamResponse()`.
**How to avoid:** Switch to `toUIMessageStreamResponse()` when the frontend uses `useChat`. This sends the full UI message stream protocol including tool call lifecycle events.

### Pitfall 3: Gemini Free Tier Rate Limits with Multi-Step Agent

**What goes wrong:** Agent calls fail mid-conversation with 429 errors because each user message triggers 2-5 LLM calls (one per tool use step).
**Why it happens:** Gemini 2.5 Flash free tier allows 10 RPM. A single agent interaction with 3 tool calls uses 4 RPM (initial + 3 steps). Two concurrent users exhaust the limit.
**How to avoid:** Set `stopWhen: stepCountIs(3)` to limit steps. Use the Groq fallback (30 RPM free) when Gemini rate-limits. Consider batching tool calls -- the LLM can call multiple tools in a single step. Add clear rate limit error handling in the UI.

### Pitfall 4: experimental_context is Typed as `unknown`

**What goes wrong:** Every tool's execute function must cast `experimental_context` to the expected type. If the context shape changes, tools silently receive the wrong type.
**Why it happens:** `experimental_context` is `unknown` in the TypeScript types. There's no generic parameter to type it.
**How to avoid:** Define an `AgentContext` interface in a shared file. Cast in one place (a helper function) rather than in every tool. Create a `getContext(options: ToolExecutionOptions): AgentContext` helper that validates and casts.

### Pitfall 5: Race Conditions in Parallel Tool Execution

**What goes wrong:** If the LLM calls `markTaskComplete` and `getPendingTasks` in the same step, the pending tasks result might not reflect the completed task.
**Why it happens:** AI SDK can execute tools in parallel within a single step. Two tools reading/writing the same data can race.
**How to avoid:** Design tools to be idempotent. For read-after-write scenarios, accept that within a single step the results may be stale. The next step will have fresh data. Alternatively, use `toolChoice: { type: 'tool', toolName: '...' }` in `prepareStep` to force sequential execution (at the cost of more LLM calls).

### Pitfall 6: Chat History Grows Unbounded

**What goes wrong:** After 10+ back-and-forth messages with tool calls, the context window fills up and responses degrade or the LLM starts hallucinating.
**Why it happens:** Each tool call/result pair adds significant tokens to the message history. 5 messages with 3 tool calls each = 20+ message parts.
**How to avoid:** Use `pruneMessages` from `ai` to trim history before sending to the LLM. Keep the last N messages plus the system prompt. For a demo, 10-15 messages is plenty.

### Pitfall 7: Zod v4 Schema Compatibility

**What goes wrong:** Tool schemas fail validation or the types don't match between Zod v4 and AI SDK.
**Why it happens:** The project uses Zod v4 (4.3.6) but AI SDK's `tool()` accepts `FlexibleSchema` which bridges both Zod v3 and v4. Mixing schema versions or using deprecated Zod v3 patterns with v4 will cause issues.
**How to avoid:** Use Zod v4 `z.object({})` patterns consistently. The AI SDK's `tool()` function wraps schemas with `zodSchema()` internally when it detects a Zod schema. This works with both v3 and v4.

## Security

### Known Vulnerabilities

No known CVEs or advisories found for recommended libraries as of 2026-04-06. All recommended libraries (`ai`, `@ai-sdk/react`, `react-markdown`, `remark-gfm`) are actively maintained with no unpatched security advisories.

### Architectural Security Risks

| Risk                               | Affected Architecture Options | How It Manifests                                                                       | Secure Pattern                                                                                                                                                                                         | Anti-Pattern to Avoid                                                                                                           |
| ---------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection via user messages | A and B                       | User sends "ignore your instructions and..."                                           | System prompt should include explicit guardrails. Tool execute functions validate all inputs independently of LLM reasoning. State machine enforces business rules regardless of what the LLM decides. | Trusting LLM output as validated -- e.g., letting the agent advance a stage without the state machine verifying task completion |
| XSS via markdown rendering         | A and B                       | Agent response contains malicious markdown that renders as executable code             | react-markdown is safe by default (renders to React elements, not innerHTML). Do not pass `rehypeRaw` plugin.                                                                                          | Using unsanitized HTML rendering or `marked` without DOMPurify to render agent responses                                        |
| matterId spoofing                  | A and B                       | Client sends arbitrary matterId in request body to access/modify another user's matter | In a real app: validate matterId against authenticated user's matters. For demo: acceptable risk since there's no auth. Document as "would need auth in production"                                    | Trusting client-provided matterId without server-side authorization                                                             |
| Tool execution escape              | A and B                       | LLM generates tool calls with unexpected input that causes unintended DB mutations     | Zod schemas validate all tool inputs. Execute functions validate business rules independently. Use parameterized queries (Drizzle does this by default).                                               | Passing raw LLM output directly into SQL queries or shell commands                                                              |

### Trust Boundaries

- **User input -> API route:** Zod validation of request body (messages array, matterId string). Already implemented in current route.ts. Extend schema to validate UIMessage format.
- **LLM tool call inputs -> Tool execute functions:** Zod input schemas on each tool validate the shape. Execute functions must additionally validate business logic (e.g., "is this action ID actually part of the current matter?").
- **Tool execute results -> LLM context:** Tool results are sent back to the LLM as-is. Do not include sensitive data (API keys, internal IDs beyond what's needed) in tool results that would be echoed to the user.
- **Agent text output -> Frontend rendering:** react-markdown renders safely by default. No additional sanitization needed unless using rehypeRaw.

## Performance

| Metric                          | Value / Range              | Source                            | Notes                                                                 |
| ------------------------------- | -------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| LLM calls per user message      | 1-5 (typically 2-3)        | Architecture analysis             | 1 initial + 1 per tool call step. stopWhen: stepCountIs(5) caps at 5  |
| Gemini free tier RPM            | 10 RPM                     | Scout report section 1            | A single agent interaction uses 2-5 of these. Limits concurrent users |
| Groq free tier RPM              | 30 RPM                     | Scout report section 1            | Better for multi-step agent. 6-15 interactions per minute             |
| DB queries per user message     | 2-10                       | Architecture analysis             | Each tool call is 1-3 queries. 3 tool calls = 3-9 queries             |
| Neon serverless cold start      | Near-instant (HTTP driver) | Scout report section 8            | Not a concern for demo                                                |
| @ai-sdk/react bundle size       | ~15-25KB gzipped           | Estimate based on ai SDK chunking | useChat + dependencies. Tree-shakeable                                |
| react-markdown bundle size      | ~12KB gzipped              | npm package page                  | Plus remark-gfm ~5KB                                                  |
| Time to first token (streaming) | 1-5 seconds                | Typical for Gemini 2.5 Flash      | First LLM call in the chain. Subsequent steps add latency             |
| Total agent response time       | 3-15 seconds               | Architecture analysis             | 2-3 LLM calls at 1-5s each + tool execution (<100ms each)             |

## Code Examples

Verified patterns from installed package type definitions:

### Tool Definition with Context

```typescript
// Source: node_modules/@ai-sdk/provider-utils/dist/index.d.ts (Tool type, line 1055)
// Source: node_modules/@ai-sdk/provider-utils/dist/index.d.ts (ToolExecutionOptions, line 985)
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'

interface AgentContext {
  matterId: string
  db: typeof import('@/db').db
}

function getAgentContext(options: ToolExecutionOptions): AgentContext {
  return options.experimental_context as AgentContext
}

export const getCurrentStage = tool({
  description: 'Get the current stage of the conveyancing matter, including status and progress',
  inputSchema: z.object({}),
  execute: async (_input, options) => {
    const { matterId, db } = getAgentContext(options)
    // Drizzle query to get matter's current stage
    // Return stage name, status, started date, completion percentage
  },
})
```

### streamText with Tools and stopWhen

```typescript
// Source: node_modules/ai/dist/index.d.ts (streamText, line 2812)
// Source: node_modules/ai/dist/index.d.ts (stopWhen, line 2831)
import { streamText, stepCountIs, convertToModelMessages } from 'ai'

const result = streamText({
  model,
  system: CONVEYANCING_SYSTEM_PROMPT,
  messages: await convertToModelMessages(uiMessages),
  tools: {
    getCurrentStage,
    getPendingTasks,
    markTaskComplete,
    getMatterSummary,
    suggestNextActions,
    advanceStage,
  },
  stopWhen: stepCountIs(5),
  experimental_context: { matterId, db },
  experimental_telemetry: { isEnabled: true },
})

return result.toUIMessageStreamResponse()
```

### useChat with Body Parameters

```typescript
// Source: node_modules/ai/dist/index.d.ts (HttpChatTransportInitOptions.body, line 3932)
"use client";
import { useChat } from "@ai-sdk/react";

function ChatPanel({ matterId }: { matterId: string }) {
  const { messages, sendMessage, status } = useChat({
    body: { matterId },
    api: "/api/chat",
  });

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          {message.parts.map((part, i) => {
            if (part.type === "text") {
              return <p key={i}>{part.text}</p>;
            }
            // Tool parts have type "tool-{toolName}"
            if (part.type.startsWith("tool-")) {
              return <ToolIndicator key={i} part={part} />;
            }
            return null;
          })}
        </div>
      ))}
    </div>
  );
}
```

### StopCondition Patterns

```typescript
// Source: node_modules/ai/dist/index.d.ts (lines 838-843)
import { stepCountIs, isLoopFinished, hasToolCall } from 'ai'

// Stop after N total LLM calls
stopWhen: stepCountIs(5)

// Stop when the LLM generates text without tool calls (natural end)
stopWhen: isLoopFinished()

// Stop when a specific tool is called (e.g., after advanceStage)
stopWhen: hasToolCall('advanceStage')

// Multiple conditions -- any can trigger stop
stopWhen: [stepCountIs(10), hasToolCall('advanceStage')]
```

### ToolLoopAgent Pattern (Option B -- for reference)

```typescript
// Source: node_modules/ai/dist/index.d.ts (ToolLoopAgent, line 3441)
// Source: node_modules/ai/dist/index.d.ts (createAgentUIStreamResponse, line 3492)
import { ToolLoopAgent, createAgentUIStreamResponse } from 'ai'

// Define agent separately from route
const conveyancingAgent = new ToolLoopAgent({
  id: 'conveyancing-agent',
  model: getModelWithFallbacks()[0], // Single model, no fallback array
  instructions: CONVEYANCING_SYSTEM_PROMPT,
  tools: {
    getCurrentStage,
    getPendingTasks,
    markTaskComplete,
    getMatterSummary,
    suggestNextActions,
  },
  stopWhen: stepCountIs(5),
  experimental_telemetry: { isEnabled: true },
  experimental_context: { matterId, db }, // Note: context must be set per-request
})

// In route handler:
return createAgentUIStreamResponse({
  agent: conveyancingAgent,
  uiMessages,
})
```

## State of the Art

| Old Approach                     | Current Approach                        | When Changed                     | Impact                                                                                                     |
| -------------------------------- | --------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `maxSteps` parameter             | `stopWhen` with StopCondition functions | AI SDK v6 (late 2025/early 2026) | maxSteps was a number. stopWhen is a function, supporting complex conditions like hasToolCall()            |
| `message.content` (string)       | `message.parts` (array of typed parts)  | AI SDK v6 (UIMessage redesign)   | Content is no longer a string. Each part has a type. Tool calls are parts, not separate fields             |
| `useChat` from `ai/react`        | `useChat` from `@ai-sdk/react`          | AI SDK v6                        | Separate package. Must be installed explicitly. Not re-exported by `ai`                                    |
| `toDataStreamResponse()`         | `toUIMessageStreamResponse()`           | AI SDK v6                        | Old method sent data stream protocol. New method sends UI message stream protocol that useChat understands |
| `experimental_toolCallStreaming` | Always-on tool streaming via parts      | AI SDK v6                        | Tool call streaming is the default. Parts have state: input-streaming, input-available, output-available   |
| No Agent class                   | `ToolLoopAgent` class                   | AI SDK v6                        | First-class agent abstraction with reusable, testable agent definitions                                    |

**Deprecated/outdated:**

- `maxSteps`: Replaced by `stopWhen`. Using `maxSteps` will likely cause TypeScript errors in v6.
- `message.content` (string): UIMessage has `parts` array. Code reading `.content` will fail.
- `toDataStreamResponse()`: Replaced by `toUIMessageStreamResponse()` for useChat integration.
- `experimental_toolCallStreaming`: No longer needed. Tool streaming is built into the parts protocol.
- `useChat` from `ai/react` or `ai`: Must import from `@ai-sdk/react`. The `ai` package does not re-export it.

## NSW Residential Conveyancing Domain Reference

This section encodes the domain knowledge needed for the system prompt and seed data. All information is sourced from publicly available Australian legal education resources and professional body guidelines.

### The 10 Stages (Buyer's Side)

These match the `conveyancingStageEnum` values in `schema.ts` and the seed data in `seed.ts`.

| #   | Stage (DB enum)             | Display Name              | Key Activities                                                                                                                | Typical Duration | Key Risks                                                                        |
| --- | --------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| 1   | engagement_and_onboarding   | Engagement & Onboarding   | Client ID (100-point check), costs disclosure, retainer, conflict check, open matter file                                     | Day 1            | Missing KYC requirements; failure to disclose costs upfront                      |
| 2   | pre_contract_review         | Pre-Contract Review       | Receive contract from vendor's solicitor, review terms/special conditions, title search, plan, easements, covenants           | 1-2 weeks        | Missing restrictive covenants; undisclosed easements affecting use               |
| 3   | searches_and_investigations | Searches & Investigations | Local authority search, water/drainage, environmental, title, strata report (if applicable)                                   | 2-8 weeks        | Contaminated land; unapproved structures; flood zone; heritage listing           |
| 4   | pre_contract_enquiries      | Pre-Contract Enquiries    | Raise requisitions on title/contract/property, review vendor replies, follow up outstanding items                             | 1-2 weeks        | Vendor fails to answer requisitions satisfactorily; boundary disputes            |
| 5   | finance_and_mortgage        | Finance & Mortgage        | Confirm mortgage approval, review offer/conditions, coordinate documentation, insurance, report to lender                     | 1-3 weeks        | Finance falls through; insurance requirements not met; lender conditions unmet   |
| 6   | report_to_client            | Report to Client          | Summarize search results, contract terms, risks. Obtain client sign-off to proceed. Confirm settlement date                   | 1 week           | Client unaware of risks; proceeding without informed consent                     |
| 7   | exchange_of_contracts       | Exchange of Contracts     | Client signs contract, coordinate exchange with vendor's solicitor, deposit paid (usually 10%), issue confirmation            | 1 day            | Deposit funding issues; exchange falling through; cooling-off period missed      |
| 8   | pre_settlement              | Pre-Settlement            | Prepare transfer docs, request/verify settlement figures, coordinate final inspection, book PEXA, verify conditions precedent | 1-2 weeks        | Settlement figures incorrect; transfer documents have errors; conditions not met |
| 9   | settlement                  | Settlement                | PEXA workspace login, verify financial figures, confirm fund transfers, key release, confirm completion                       | 1 day            | PEXA system issues; fund transfer delays; last-minute title issues               |
| 10  | post_settlement             | Post-Settlement           | Register transfer with Land Registry, confirm stamp duty payment/lodgement, final reports to client and lender, close file    | 1-2 weeks        | Registration delays; stamp duty deadline missed; file not properly archived      |

### Key Australian Legal Terminology

- **PEXA (Property Exchange Australia):** The mandatory electronic settlement platform for property transactions in NSW (and most other states). All conveyancing settlements go through PEXA.
- **Stamp duty (transfer duty):** State government tax on property transfers. In NSW, managed by Revenue NSW. Must be paid before registration of the transfer.
- **Land Registry (NSW Land Registry Services):** Government body that manages property titles and registrations in NSW. Transfer must be registered here.
- **Requisitions:** Formal questions raised by the buyer's solicitor about the title, contract, or property. The vendor's solicitor must answer them.
- **100-point ID check:** Australian standard for client identification (Know Your Customer). Required by Anti-Money Laundering legislation.
- **Cooling-off period:** In NSW, a 5-business-day cooling-off period applies after exchange of contracts for residential property (unless waived by a s66W certificate).
- **s66W certificate:** A certificate under s66W of the Conveyancing Act 1919 (NSW) that waives the cooling-off period. Commonly used when the buyer has had legal advice.
- **Strata:** A form of property ownership where individual lots are within a larger building (apartments, townhouses). Strata reports reveal levies, defects, and management issues.

### System Prompt Guidance

The system prompt should:

1. Define the agent's role: "You are a legal workflow assistant helping with a residential conveyancing matter (buyer's side) in New South Wales, Australia."
2. State clearly: "You do NOT provide legal advice. You provide workflow guidance -- what steps typically come next, what tasks need completing, and what risks to be aware of."
3. Instruct the agent to ALWAYS use tools before answering: "Before answering any question about the matter's status, call getCurrentStage and getPendingTasks to get the current state from the database."
4. Encode the stage sequence and transition rules: "Stages must be completed in order. A stage can only be advanced when all required tasks in that stage are complete."
5. Include risk awareness per stage (from the table above).
6. Use Australian legal terminology naturally (PEXA, stamp duty, requisitions, etc.).
7. Include caveats: "Always remind the user that this is workflow guidance, not legal advice, and they should consult with their solicitor for specific legal questions."

## Validation Architecture

### Test Framework

| Property           | Value                             |
| ------------------ | --------------------------------- |
| Framework          | None configured -- needs creating |
| Config file        | None -- needs creating            |
| Quick run command  | N/A                               |
| Full suite command | N/A                               |

No test infrastructure exists in the project. For a demo with limited time, the validation strategy should focus on:

1. Manual testing via the UI (primary)
2. Optional: Vitest for tool handler unit tests (highest value-to-effort ratio)

### Requirements -> Test Map

| Requirement                                              | Behavior                                                      | Test Type                 | Automated Command                                           | File Exists?                         |
| -------------------------------------------------------- | ------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| Tool definitions parse valid Zod schemas                 | tool() accepts schemas without runtime errors                 | unit                      | `npx vitest run src/lib/ai/tools.test.ts`                   | Needs creating                       |
| getCurrentStage returns correct stage data               | Query returns matter's current stage with metadata            | integration (requires DB) | `npx vitest run src/lib/db/queries/stages.test.ts`          | Needs creating                       |
| State machine rejects advancement with incomplete tasks  | tryAdvanceStage returns failure when tasks are incomplete     | unit                      | `npx vitest run src/lib/state-machine/conveyancing.test.ts` | Needs creating                       |
| State machine allows advancement with all tasks complete | tryAdvanceStage returns success and advances stage            | unit                      | `npx vitest run src/lib/state-machine/conveyancing.test.ts` | Needs creating                       |
| API route streams response for useChat                   | POST /api/chat returns UIMessageStream format                 | integration               | `curl -X POST localhost:3000/api/chat` (manual)             | Existing route.ts needs modification |
| Chat UI renders messages with tool indicators            | Messages show text + tool call status                         | manual/e2e                | Browser testing                                             | Needs creating                       |
| Stage progress updates after agent action                | Stage tracker reflects DB changes                             | manual                    | Browser testing                                             | Needs creating                       |
| Agent uses tools before responding                       | Agent calls getCurrentStage before answering status questions | manual (prompt testing)   | Langfuse trace inspection                                   | N/A                                  |

### Gaps (files to create before implementation)

- [ ] `vitest.config.ts` -- test framework setup (only if time permits)
- [ ] `src/lib/ai/tools.test.ts` -- tool definition unit tests
- [ ] `src/lib/state-machine/conveyancing.test.ts` -- state machine logic tests
- [ ] `src/lib/db/queries/stages.test.ts` -- DB query integration tests

Given the demo context, manual testing through the UI and Langfuse trace inspection are the primary validation methods. Unit tests for the state machine are the highest-value automated tests if time permits.

## Open Questions

1. **useChat sendMessage vs handleSubmit API**
   - What we know: AI SDK v6's useChat exposes `sendMessage` (documented in the DefaultChatTransport example in the type definitions). Older versions used `handleSubmit` with a form event.
   - What's unclear: The exact v6 API surface for useChat (options, return values, event handlers). The types are not in the `ai` package -- they're in `@ai-sdk/react` which is not installed.
   - Recommendation: Install `@ai-sdk/react` first, then inspect its type definitions before building the chat UI. The transport layer (DefaultChatTransport) is well-typed in `ai/dist/index.d.ts`.

2. **Langfuse trace attribution for multi-step agent**
   - What we know: The current `observe()` wrapper creates one span for the entire request. `experimental_telemetry: { isEnabled: true }` creates child spans for each LLM call.
   - What's unclear: With stopWhen allowing 5 steps, will each step create a separate OTel span under the parent? Will Langfuse show the full agent loop as a trace tree?
   - Recommendation: Test empirically after implementation. The AI SDK's telemetry layer should create child spans for each step. If not visible in Langfuse, the `onStepFinish` callback can log intermediate results.

3. **Groq Tool Calling Reliability**
   - What we know: Groq's `@ai-sdk/groq` package implements tool choice. Llama 3.3 70B supports function calling.
   - What's unclear: How reliable Groq's tool calling is compared to Gemini for multi-step agent loops. Llama models historically have weaker tool calling than Gemini/GPT.
   - Recommendation: Test with both providers. If Groq's tool calling is unreliable, consider making tool calling Gemini-only (fallback to Groq only for simple text responses without tools).

4. **Chat History Persistence Across Page Reloads**
   - What we know: The schema has `ai_chats` and `ai_chat_messages` tables. useChat manages client-side state.
   - What's unclear: Whether to persist chat history to the database (and reload on page visit) or treat each page load as a fresh conversation.
   - Recommendation: For the demo, start with fresh conversations per page load. Persisting chat history adds complexity (message format serialization, loading state) that's not critical for demonstrating the agent capability. Flag as a "production would need this" item.

5. **Matter Selection vs. Fixed Demo Matter**
   - What we know: Seed data creates exactly 1 matter (CONV-2026-0001). The roadmap mentions a "matter creation page/modal."
   - What's unclear: Whether to build a full matter creation flow or just use the seeded matter.
   - Recommendation: For the demo, use the seeded matter. Add a simple matter selection dropdown if multiple matters exist, but don't build a creation flow. The agent interaction is the star of the demo, not CRUD forms.

## Sources

### Primary (HIGH confidence)

- [AI SDK v6 Type Definitions -- ai@6.0.146](file:///node_modules/ai/dist/index.d.ts) -- streamText, ToolLoopAgent, StopCondition, UIMessage, createAgentUIStreamResponse, convertToModelMessages, stepCountIs, hasToolCall, isLoopFinished. All type signatures verified from installed package.
- [AI SDK Provider Utils Types](file:///node_modules/@ai-sdk/provider-utils/dist/index.d.ts) -- Tool type definition (line 1055), tool() function overloads (line 1188), ToolExecutionOptions with experimental_context (line 985). Verified from installed package.
- [AI SDK Test Mocks](file:///node_modules/ai/dist/test/index.d.ts) -- MockLanguageModelV3, MockProviderV3 for unit testing tools. Verified from installed package.
- [Project Schema](file:///src/db/schema.ts) -- conveyancingStageEnum (10 stages), progressStatusEnum, matterStages, matterActions tables with relations.
- [Project Seed Data](file:///src/db/seed.ts) -- stageActions mapping with all 50 actions across 10 stages. Defines the complete task set.
- [Project Chat Route](file:///src/app/api/chat/route.ts) -- existing observe() + streamText + toTextStreamResponse pattern with Langfuse telemetry.
- [Project Langfuse Decision Record](file:///project/decisions/20260406-140000-langfuse-telemetry-capture-pattern.md) -- observe() + endOnExit: false is the accepted pattern for streaming.

### Secondary (MEDIUM confidence)

- [Project Roadmap Feature #4](file:///project/roadmaps/20260330-01-legal-agent-flow-demo-roadmap.md) (lines 280-400) -- feature specification, tool list, broad todo items, additional notes on system prompt.
- [Project Scout Report Section 6](file:///project/20260330-SCOUT-REPORT.md) (lines 294-349) -- NSW conveyancing workflow stages, typical durations, Australian legal terminology, domain modeling insights.
- [NSW Law Society](https://www.lawsociety.com.au/) -- professional body resources for conveyancing procedure. Referenced in scout report.
- [PEXA (Property Exchange Australia)](https://www.pexa.com.au/) -- electronic settlement platform referenced in seed data and domain terminology.

### Tertiary (LOW confidence)

- Tool calling reliability of Groq/Llama 3.3 for multi-step agent loops -- unverified, flagged in Open Questions. Needs empirical testing.
- react-markdown v10 + remark-gfm v5 bundle sizes (~12KB + ~5KB) -- estimated from npm package pages, not measured in this project context.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- all core libraries verified from installed node_modules type definitions
- Architecture options: HIGH -- both patterns verified from ai@6.0.146 type exports. Recommendation based on proven Langfuse pattern
- Tool calling API: HIGH -- tool() function, ToolExecutionOptions, experimental_context verified from source types
- State machine design: MEDIUM -- application logic, not library-specific. Design is informed by schema constraints but untested
- Frontend patterns: MEDIUM -- useChat hook exists in `@ai-sdk/react` (referenced in ai types) but package not installed for direct verification
- Conveyancing domain: MEDIUM -- sourced from scout report and publicly available Australian legal education resources. Accuracy for demo purposes, not production legal advice
- Pitfalls: HIGH -- derived from verified type definitions (stopWhen default, toTextStreamResponse behavior, UIMessage parts structure)

**Research date:** 2026-04-06
