# Plan: Matter Lifecycle Progression Agent

**Date:** 2026-04-06
**Status:** Code Complete -- Pending npm install + manual verification
**Research:** project/research/20260406-180000-matter-lifecycle-agent.md
**Depends on:** 20260330-010000-drizzle-neon-data-layer.md, 20260330-180000-langfuse-otel-observability.md, 20260402-150000-provider-agnostic-llm-architecture.md

## Goal

Build a conversational AI agent that analyzes a conveyancing matter's current state via tool calls against the database, suggests next actions, flags risks, marks tasks complete, and tracks progress through 10 conveyancing stages -- surfaced through a streaming chat UI with stage progress display.

## Approach

Extend the existing `streamText` pattern in `src/app/api/chat/route.ts` (Architecture Option A from research) by adding 6 tools, a conveyancing system prompt, and `stopWhen: stepCountIs(5)` for multi-step agent behavior. Switch the response format from `toTextStreamResponse()` to `toUIMessageStreamResponse()` so the frontend `useChat` hook can parse tool call parts. This preserves the proven Langfuse `observe()` + `endOnExit: false` telemetry pattern documented in `project/decisions/20260406-140000-langfuse-telemetry-capture-pattern.md`, avoiding the risk of re-engineering telemetry that the `ToolLoopAgent` alternative (Option B) would introduce.

The agent's 6 tools are backed by Drizzle queries, with `experimental_context` injecting `matterId` and `db` server-side so the LLM never handles IDs. Stage advancement is enforced by an application-level state machine -- the agent suggests, the state machine validates by checking all tasks in the current stage are complete before allowing progression. The frontend uses `@ai-sdk/react`'s `useChat` hook with the v6 `UIMessage` parts model for rendering text and tool call indicators, plus a stage progress sidebar.

Chat history is fresh per page load (no persistence). The seeded matter CONV-2026-0001 is used directly (no matter creation flow).

## Critical

- `toUIMessageStreamResponse()` MUST replace `toTextStreamResponse()` -- the latter silently drops tool call parts and the frontend will not display them.
- `stopWhen: stepCountIs(5)` MUST be set explicitly on `streamText` -- the default is `stepCountIs(1)` which means tools execute but the LLM never sees the results.
- The `advanceStage` tool MUST query the database to verify all actions are complete before advancing -- never trust the LLM's assessment of completion status.
- `experimental_context` MUST be used to pass `matterId` into tool execute functions -- do NOT add `matterId` as a tool input parameter (the LLM can hallucinate wrong IDs).
- The request validation schema MUST be updated to accept `UIMessage[]` format (with `parts` arrays) since `useChat` sends this format, not the current `{ role, content }` shape.

## Steps

### 1. Dependencies

- [ ] **1.1** Run `npm install @ai-sdk/react react-markdown remark-gfm` in the project root. After install, verify all three appear in `package.json` dependencies. Verify `@ai-sdk/react` version is ^3.x (matching the `ai` major version 6).
- [x] **1.2** After install, read the type definitions at `node_modules/@ai-sdk/react/dist/index.d.ts` to confirm the `useChat` hook signature -- specifically that it returns `{ messages, sendMessage, status, error }` and accepts `{ body, api }` in its options. This resolves Open Question 1 (useChat API surface). **[RESOLVED via `ai` package type definitions — `sendMessage` confirmed at line 3799 of `ai/dist/index.d.ts`, `ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error'` at line 3680]**

### 2. Agent context type and helper

- [x] **2.1** Create `src/lib/ai/agent-context.ts`. Define an `AgentContext` interface with `matterId: string` and `db: typeof import("@/db").db`. Export a `getAgentContext(options: ToolExecutionOptions): AgentContext` helper function that casts `options.experimental_context` to `AgentContext`. Import `ToolExecutionOptions` from `@ai-sdk/provider-utils`. This single cast point avoids repeated unsafe casts in every tool (addresses Pitfall 4).

### 3. Database query functions

- [x] **3.1** Create `src/lib/db/queries/matters.ts`. Export a `getMatterWithCurrentStage(db, matterId)` function that queries the `matters` table joined with `matterStages` (filtered to `matters.currentStage === matterStages.stage`) and the `properties` table. Return the matter reference number, title, status, current stage name, stage status, property address, and started date. Use Drizzle relational queries or explicit joins on the existing schema relations.

- [x] **3.2** Create `src/lib/db/queries/stages.ts`. Export three functions:
  - `getStageWithActions(db, matterId, stageName)` -- query `matterStages` joined with `matterActions` for a specific stage. Return stage status, all actions with their statuses, and completion counts.
  - `getAllStages(db, matterId)` -- query all `matterStages` for a matter, ordered by the `conveyancingStageEnum` enum order. Return each stage name, status, action completion count (completed/total). This powers the stage progress sidebar.
  - `getNextStage(currentStage)` -- pure function using `conveyancingStageEnum.enumValues` array. Returns the next stage enum value, or `null` if already at `post_settlement`.

- [x] **3.3** Create `src/lib/db/queries/actions.ts`. Export two functions:
  - `getPendingActionsForCurrentStage(db, matterId)` -- query `matterActions` joined through `matterStages` where stage matches `matters.currentStage` and action status is NOT `completed` and NOT `skipped`. Return action id, description, status, due date.
  - `markActionComplete(db, actionId, matterId)` -- update `matterActions` set status to `completed` and `completedAt` to now. Guard: verify the action belongs to a `matterStage` that belongs to the given `matterId` before updating (prevents cross-matter mutation). Return the updated action or throw if the action does not belong to the matter.

### 4. State machine

- [x] **4.1** Create `src/lib/state-machine/conveyancing.ts`. Export a `tryAdvanceStage(db, matterId)` function that:
  1. Queries the matter's `currentStage`.
  2. Queries all `matterActions` for the current stage.
  3. Checks if every action has status `completed` or `skipped`. If not, returns `{ success: false, reason: string, incompleteActions: string[] }` listing the incomplete action descriptions.
  4. If all complete: uses `getNextStage()` to determine the next stage. If no next stage (already at `post_settlement`), returns `{ success: false, reason: "Already at the final stage" }`.
  5. Updates `matters.currentStage` to the next stage value, sets the current `matterStages` row status to `completed` with `completedAt`, and sets the next `matterStages` row status to `in_progress` with `startedAt`. Updates `matters.updatedAt`.
  6. Returns `{ success: true, previousStage: string, newStage: string }`.

  Define and export the `StageTransitionResult` discriminated union type.

### 5. Tool definitions

- [x] **5.1** Create `src/lib/ai/tools.ts`. Define and export 6 tools using the `tool()` helper from `ai` with Zod v4 schemas. Each tool's `execute` function uses `getAgentContext(options)` to get `matterId` and `db`, then calls the query functions from Step 3/4. The tools are:

  1. `getCurrentStage` -- input: `z.object({})`. Calls `getMatterWithCurrentStage`. Returns matter reference, current stage display name, stage status, property address, started date.
  2. `getPendingTasks` -- input: `z.object({})`. Calls `getPendingActionsForCurrentStage`. Returns array of pending actions with id, description, status.
  3. `markTaskComplete` -- input: `z.object({ actionId: z.string().uuid() })`. Calls `markActionComplete`. Returns confirmation with the action description and new status. On error (action not found or not belonging to matter), return error message string (do not throw -- the LLM should see the error).
  4. `getMatterSummary` -- input: `z.object({})`. Calls `getAllStages`. Returns all 10 stages with status and completion counts, plus the matter reference number and overall status.
  5. `suggestNextActions` -- input: `z.object({})`. Calls `getPendingActionsForCurrentStage` and `getStageWithActions` for the current stage. Returns prioritized list of pending actions with contextual guidance (the guidance is part of the tool result string, not LLM-generated -- e.g., "Priority: Order local authority search -- this typically takes 2-4 weeks and is on the critical path").
  6. `advanceStage` -- input: `z.object({})`. Calls `tryAdvanceStage` from the state machine. Returns either the success result with previous/new stage names, or the failure result with the reason and list of incomplete actions. The LLM decides when to call this based on conversation context, but the state machine enforces the rules.

  Export all tools as a `conveyancingTools` record object for clean import into the route handler.

### 6. System prompt

- [x] **6.1** Create `src/lib/ai/prompts.ts`. Export a `CONVEYANCING_SYSTEM_PROMPT` string constant. The prompt must:
  1. Define the agent's role: legal workflow assistant for NSW residential conveyancing (buyer's side).
  2. State explicitly: "You do NOT provide legal advice. You provide workflow guidance."
  3. Instruct the agent to ALWAYS call `getCurrentStage` and `getPendingTasks` before answering questions about the matter's status.
  4. Encode the 10 stage names in order (matching `conveyancingStageEnum`), with a one-line description of each stage's purpose.
  5. Encode the transition rule: "A stage can only advance when all tasks in the current stage are completed or skipped."
  6. Include risk awareness: for each stage, one key risk to flag (drawn from the research domain reference table).
  7. Use Australian legal terminology naturally (PEXA, stamp duty, requisitions, 100-point ID check, s66W certificate, strata).
  8. Include the caveat instruction: "Always remind the user this is workflow guidance, not legal advice."
  9. Instruct the agent on tool usage: describe each tool's purpose in 1 sentence so the LLM knows when to call which.

### 7. API route modification

- [x] **7.1** Modify `src/app/api/chat/route.ts`. Update the `chatRequestSchema` to accept the `UIMessage` format that `useChat` sends. The messages array items should accept objects with `id` (string), `role` (enum), and `parts` (array). Keep `matterId` as a required string field (no longer optional -- the agent always operates on a specific matter). Add a `z.string().uuid()` validation on `matterId`.

- [x] **7.2** In the same file, add imports: `convertToModelMessages` and `stepCountIs` from `ai`, the `conveyancingTools` from `@/lib/ai/tools`, and `CONVEYANCING_SYSTEM_PROMPT` from `@/lib/ai/prompts`. Import `db` from `@/db`.

- [x] **7.3** Update the `tryStreamText` function signature and body:
  - Add `tools` parameter (the tools record) and `context` parameter (the `experimental_context` object).
  - In the `streamText` call, add: `tools`, `stopWhen: stepCountIs(5)`, `experimental_context: context`.
  - Convert incoming UIMessages to model messages: `const modelMessages = await convertToModelMessages(uiMessages)` and pass `modelMessages` to `streamText`'s `messages` parameter.
  - Change `return result.toTextStreamResponse()` to `return result.toUIMessageStreamResponse()`.
  - In `onFinish`, the callback receives `{ text }` -- this still works for Langfuse observation update.

- [x] **7.4** In the `handler` function, update the call to `tryStreamText` to pass the tools and context:
  - Replace the hardcoded system prompt string with `CONVEYANCING_SYSTEM_PROMPT`.
  - Build the context object: `{ matterId, db }`.
  - Pass `conveyancingTools` and the context to `tryStreamText`.

- [x] **7.5** Export `const maxDuration = 60` from the route file (Next.js route segment config). Multi-step agent responses with 3-5 LLM calls can exceed the default 15-second timeout.

### 8. Matters API route

- [x] **8.1** Create `src/app/api/matters/[id]/route.ts`. Export a `GET` handler that:
  - Parses the `id` route param as a UUID.
  - Queries the matter with all stages and their action counts using `getAllStages` and `getMatterWithCurrentStage`.
  - Returns JSON with the matter data, all 10 stages with statuses and completion counts, and the current stage's pending actions.
  - Returns 404 if the matter ID does not exist.
  This API powers the stage progress sidebar refresh after agent actions.

### 9. Frontend -- Matter page

- [x] **9.1** Create `src/app/matters/[id]/page.tsx` as a server component. It receives `params.id` from the URL. Fetch the matter data from the database (using the query functions directly, not via API -- this is a server component). If the matter does not exist, return `notFound()`. Render a two-column layout: stage progress sidebar on the left, chat panel on the right. Pass `matterId` and the initial matter data (stages, current stage, property info) as props to the client components.

- [x] **9.2** Update `src/app/page.tsx` (home page) to display a link to the seeded matter: `<a href="/matters/{MATTER_ID}">CONV-2026-0001 - [matter title]</a>`. The matter ID should be fetched from the database at render time (server component query for the first matter). This provides the entry point to the demo without a matter creation flow.

### 10. Frontend -- Chat components

- [x] **10.1** Create `src/components/chat/chat-panel.tsx` as a client component (`"use client"`). Use the `useChat` hook from `@ai-sdk/react` with `body: { matterId }` and `api: "/api/chat"`. Render a message list and an input form. The `sendMessage` function from `useChat` handles submission. Display `status` from useChat to show loading/streaming state. Display `error` from useChat when the agent fails.

- [x] **10.2** Create `src/components/chat/message.tsx` as a client component. Accept a `UIMessage` (from `ai` types). Iterate over `message.parts`:
  - For text parts (`isTextUIPart(part)`): render with `<ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>`. Import `ReactMarkdown` from `react-markdown` and `remarkGfm` from `remark-gfm`.
  - For tool parts (`isToolUIPart(part)`): render the `<ToolIndicator>` component.
  - For user role messages: render plain text (no markdown needed).
  Import `isTextUIPart` and `isToolUIPart` from `ai`.

- [x] **10.3** Create `src/components/chat/tool-indicator.tsx` as a client component. Accept the tool part (type and state). Display the tool name in a human-readable format (strip `tool-` prefix, convert camelCase to title case: `tool-getCurrentStage` becomes "Get Current Stage"). Show state indicators:
  - `input-streaming` or `input-available`: "Calling [tool name]..." with a spinner/pulse animation.
  - `output-available`: "Called [tool name]" with a checkmark. Optionally show a collapsible summary of the result.
  - `output-error`: "Error in [tool name]" with an error indicator.

### 11. Frontend -- Stage progress

- [x] **11.1** Create `src/components/matter/stage-progress.tsx` as a client component. Accept the stages array (from matter data) and the current stage. Render a vertical progress tracker showing all 10 stages:
  - Completed stages: green checkmark, stage name, completion date.
  - Current stage: highlighted/active indicator, stage name, "X of Y tasks complete" count.
  - Future stages: dimmed/gray, stage name.
  Convert enum values to display names (replace underscores with spaces, title case).

- [x] **11.2** The stage progress component should accept an `onRefresh` callback prop. After the chat `useChat` status transitions from `streaming` to `ready` (meaning the agent finished responding), trigger a refresh of the stage data. Implement this by fetching `GET /api/matters/[id]` in the parent page component and passing updated stage data down. This handles the state synchronization issue flagged in the roadmap without real-time subscriptions.

### 12. Verification and manual testing

- [ ] **12.1** Start the dev server (`npm run dev`). Navigate to the home page and verify the link to the seeded matter appears with reference number CONV-2026-0001.

- [ ] **12.2** Click the matter link. Verify the matter page loads with the stage progress sidebar showing all 10 stages (stage 1 "Engagement & Onboarding" should be `in_progress` or `not_started` depending on seed data, remaining stages `not_started`).

- [ ] **12.3** Type "What is the current status of this matter?" in the chat input. Verify:
  - The agent calls `getCurrentStage` (tool indicator appears).
  - The agent calls `getPendingTasks` (tool indicator appears).
  - The agent responds with a summary that references the actual stage name and pending tasks from the database.
  - The response renders as formatted markdown (not raw markdown syntax).

- [ ] **12.4** Ask the agent "Mark the first task as complete." Verify:
  - The agent calls `getPendingTasks` to find the first task.
  - The agent calls `markTaskComplete` with the correct action ID.
  - The agent confirms the task was completed.
  - The stage progress sidebar refreshes to show updated completion counts.

- [ ] **12.5** Check Langfuse dashboard. Verify the trace for the chat interaction shows: the parent `chat-handler` span from `observe()`, child spans for each `streamText` step (one per LLM call), tool call details, and input/output captured.

- [ ] **12.6** Test the Groq fallback: temporarily set `AI_PROVIDER=groq` in `.env.local`, restart the dev server, and send a message. Verify tool calling works with Groq/Llama. If tool calling fails or is unreliable, document the finding in Implementation Discoveries. The primary Gemini provider is the demo default.

- [ ] **12.7** Test stage advancement: complete all tasks in stage 1 (either via repeated chat messages or direct DB updates), then ask the agent "Can we advance to the next stage?" Verify the agent calls `advanceStage`, the state machine validates and advances, and the stage progress sidebar updates.

## Security

**Known vulnerabilities:** No known CVEs or advisories found for recommended libraries (`ai@6.0.146`, `@ai-sdk/react`, `react-markdown`, `remark-gfm`) as of 2026-04-06.

**Architectural risks:**

- **Prompt injection via user messages:** The system prompt includes guardrails ("You do NOT provide legal advice"). Tool execute functions validate all inputs independently of LLM reasoning. The state machine enforces business rules (task completion check) regardless of what the LLM decides. The agent assists, the state machine enforces.
- **XSS via markdown rendering:** `react-markdown` renders to React elements (not `innerHTML`) and is safe by default. Do NOT add the `rehypeRaw` plugin. No additional sanitization needed.
- **matterId spoofing:** The client sends `matterId` in the request body. For the demo this is acceptable (no auth). In production, `matterId` must be validated against the authenticated user's matters. Document as a production TODO.
- **Tool input validation:** Each tool has a Zod input schema. The `markTaskComplete` tool must additionally verify the action belongs to the specified matter (cross-matter mutation guard in Step 3.3).
- **Tool result data leakage:** Tool results are sent back to the LLM and may be echoed to the user. Do not include internal IDs beyond what is needed, API keys, or sensitive metadata in tool results.

**Trust boundaries:**

1. User input to API route: Zod validation of request body (UIMessage format, matterId UUID).
2. LLM tool call inputs to tool execute functions: Zod schemas on each tool plus business logic validation in execute functions.
3. Tool results to LLM context: return only necessary data, no secrets.
4. Agent text output to frontend: `react-markdown` safe rendering (no `rehypeRaw`).

## Open Questions

1. **useChat sendMessage vs handleSubmit API** -- (Resolved: `sendMessage` is confirmed in `ai@6.0.146` type definitions at line 3799. `handleSubmit` is the older pattern. Use `sendMessage` with `useChat`. Step 1.2 includes type verification after install.)

2. **Langfuse trace attribution for multi-step agent** -- (Resolved: `experimental_telemetry: { isEnabled: true }` creates child OTel spans for each LLM call. With `stopWhen` allowing 5 steps, each step produces a child span under the `observe()` parent. Verify empirically in Step 12.5.)

3. **Groq tool calling reliability** -- Partially resolved. Groq's `@ai-sdk/groq` implements tool choice and Llama 3.3 70B supports function calling, but multi-step agent loop reliability is LOW confidence (unverified). **Risk mitigation:** Gemini is the primary provider for the demo. Step 12.6 tests Groq empirically. The existing fallback mechanism in `tryStreamText` handles Groq failures gracefully -- if Groq fails, the next provider in the array is tried. If Groq tool calling proves unreliable during testing, document it and keep Gemini as the demo default.

4. **Chat history persistence** -- (Resolved: fresh per page load for the demo. No persistence. The `ai_chats` and `ai_chat_messages` tables remain unused -- flag as "production would need this.")

5. **Matter selection vs fixed demo matter** -- (Resolved: use the seeded matter CONV-2026-0001. Home page links directly to it. No matter creation flow.)

## Implementation Discoveries

**1. AI SDK v6 uses `inputSchema` not `parameters` in tool definitions.** The `tool()` helper in `ai@6` uses `inputSchema: FlexibleSchema<INPUT>` not the older `parameters: z.ZodObject`. Plan's phrasing "Zod v4 schemas" was correct but did not specify the field name. Used `inputSchema: z.object({})` throughout `tools.ts`.

**2. `toUIMessageStreamResponse()` cannot coexist with the probe-first-chunk fallback pattern.** The original `route.ts` probed `result.textStream` before returning. With the agent, we switch to `result.toUIMessageStreamResponse()`. Consuming `result.textStream` (for probing) and then calling `result.toUIMessageStreamResponse()` on the same result would produce an incomplete stream. Decision: dropped the probe pattern from the fallback loop. The provider fallback now only catches synchronous errors thrown at `streamText()` call time. Stream errors after the response has started are surfaced to the `useChat` hook client. This is acceptable for the demo (Gemini is reliable). The previous decision file `20260406-180000-streaming-failover-pattern.md` describes the original pattern.

**3. Zod v4 deprecates `z.string().uuid()` in favor of `z.uuid()`.** The plan specified `z.string().uuid()` but Zod v4's classic API marks this as `@deprecated`. Updated to `z.uuid()` in both `chatRequestSchema` and the `markTaskComplete` tool's `inputSchema`.

**4. TypeScript narrowing does not work through `notFound()` in Next.js.** `notFound()` throws `NEXT_NOT_FOUND` which TypeScript doesn't recognize as a never-returning function. Used `matter as NonNullable<typeof matter>` narrowing after the `notFound()` call in the matter page server component.

**5. Stage refresh via custom DOM event (not `onRefresh` prop).** The plan said to pass `onRefresh` callback prop to `StageProgress` and trigger it from the parent. But the parent (`MatterPage`) is a server component that can't hold callbacks. Solution: `ChatPanel` dispatches `window.CustomEvent('matter-{matterId}-refresh')` when `status === 'ready'` and `messages.length > 0`. `StageProgress` listens for this event and fetches from `GET /api/matters/[id]` to refresh. This avoids lifting state to a client wrapper component.

**6. `ToolExecutionOptions` is exported from `ai` (re-exported from `@ai-sdk/provider-utils`).** The plan said to import from `@ai-sdk/provider-utils`. Updated to import from `ai` directly (it's in the top-level re-exports at line 5 of `ai/dist/index.d.mts`).

**7. `getToolName` is available as a built-in SDK function.** Rather than manually parsing `tool-getCurrentStage` type strings, the `ai` package exports `getToolName(part)` which handles both `ToolUIPart` and `DynamicToolUIPart`. Used in `tool-indicator.tsx`.

**8. `status === 'ready'` fires on initial mount.** Added `messages.length > 0` guard in the `useEffect` watching `status` to prevent the stage refresh event from firing before any conversation has occurred.

**9. Step 1.1 is blocked on user action (npm install).** `@ai-sdk/react`, `react-markdown`, and `remark-gfm` are not installed. All code is written but the dev server will fail to start until the user runs `npm install @ai-sdk/react react-markdown remark-gfm`. Frontend components that import these packages will fail TypeScript compilation until installed.

## Verification

- [ ] Home page shows link to seeded matter CONV-2026-0001 -- manual -- Navigate to `http://localhost:3000` -- Manual
- [ ] Matter page renders with stage progress sidebar and chat panel -- manual -- Navigate to `/matters/[id]` -- Manual
- [ ] Agent calls tools before responding to status questions -- manual -- Send "What is the current status?" and observe tool indicators -- Manual
- [ ] Tool indicators show lifecycle states (calling -> called) -- manual -- Watch tool indicator UI during agent response -- Manual
- [ ] Agent responses render as formatted markdown -- manual -- Check headers, lists, bold text render correctly -- Manual
- [ ] `markTaskComplete` updates the database and stage progress refreshes -- manual -- Ask agent to complete a task, verify sidebar updates -- Manual
- [ ] State machine rejects stage advancement with incomplete tasks -- manual -- Ask agent to advance stage before all tasks are done, verify rejection message -- Manual
- [ ] State machine allows stage advancement with all tasks complete -- manual -- Complete all tasks, ask to advance, verify success -- Manual
- [ ] Langfuse traces show full agent loop with tool calls -- manual -- Check Langfuse dashboard after a multi-step interaction -- Manual
- [ ] `npm run build` passes without TypeScript errors -- automatic -- `npm run build` -- Automatic
- [ ] `npm run lint` passes without Biome errors -- automatic -- `npm run lint` -- Automatic
- [ ] Groq fallback tested (may or may not work for tool calling) -- manual -- Set `AI_PROVIDER=groq`, send a message, document result -- Manual
