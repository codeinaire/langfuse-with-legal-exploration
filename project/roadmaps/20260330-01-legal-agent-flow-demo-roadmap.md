# Legal Agent Flow Demo -- Feature Roadmap

A demo project for a Senior Full Stack Engineer interview at the company (ATI Group), targeting their AI-driven legal workflow guidance product. The demo builds a legal matter progression agent using Next.js, Vercel AI SDK, Drizzle ORM, Neon Postgres, Langfuse, and Google Gemini. Everything runs on free tiers ($0 budget). The goal is not production software but a working prototype that demonstrates domain understanding, stack alignment, and production-grade thinking within a few days of build time.

---

## Difficulty Scale

| Rating | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| 1/5    | Trivial -- a few hours, minimal risk                            |
| 2/5    | Easy -- a focused day or two                                    |
| 3/5    | Moderate -- multi-day, some coordination between layers/systems |
| 4/5    | Hard -- significant effort, architectural decisions required    |
| 5/5    | Very Hard -- major undertaking, weeks of work                   |

---

## Current Baseline

This is a greenfield project. No code exists yet. The baseline is an empty Next.js app.

| Metric                          | Current                                   | Notes                                         |
| ------------------------------- | ----------------------------------------- | --------------------------------------------- |
| JS bundle (gzipped)             | ~85-100KB                                 | Bare Next.js app with React                   |
| Dependencies                    | 0 project-specific                        | Only Next.js / React / TypeScript             |
| LLM cost                        | $0                                        | No LLM integration                            |
| Database                        | None                                      | No persistence                                |
| Observability                   | None                                      | No tracing or monitoring                      |
| Total dev time invested         | 0 days                                    | Greenfield                                    |
| Vercel function duration budget | 300s (Fluid Compute) or 10s (traditional) | Must use streaming for LLM calls              |
| Gemini free tier daily budget   | 250 requests/day (2.5 Flash)              | Sufficient for demo; not for concurrent users |
| Neon free tier                  | 0.5GB storage, 100 CU-hours/month         | Orders of magnitude above demo needs          |
| Langfuse free tier              | 50,000 units/month                        | Demo will use <1K                             |

---

## Table of Contents

1. [Drizzle + Neon Data Layer](#1-drizzle--neon-data-layer) -- 1.5/5
2. [Langfuse Observability Integration](#2-langfuse-observability-integration) -- 2/5
3. [Provider-Agnostic LLM Architecture](#3-provider-agnostic-llm-architecture) -- 1.5/5 _(soft dependency on #4)_
4. [Matter Lifecycle Progression Agent](#4-matter-lifecycle-progression-agent) -- 3/5 _(depends on #1; soft dependency on #2, #3)_
5. [User Feedback Loop](#5-user-feedback-loop) -- 2/5 _(depends on #2, #4)_
6. [Prompt Management via Langfuse](#6-prompt-management-via-langfuse) -- 2/5 _(depends on #2, #4)_

---

## 1. Drizzle + Neon Data Layer

**Difficulty: 1.5/5**

### Overview

Set up the persistence layer: Drizzle ORM connected to Neon PostgreSQL via the serverless HTTP driver, with a schema modeling legal matters, stages, actions, and conversation history. This is the foundation that every other feature depends on for state.

### Pros

- **Exact stack match.** the company uses Drizzle + Neon. This is not a technology choice -- it is a signal of alignment.
- **Type-safe from schema to query.** Drizzle's TypeScript-first schema means the data model is self-documenting and the compiler catches shape mismatches. Strong interview talking point.
- **Minimal bundle impact.** The neon-http driver is ~410KB unpacked; after tree-shaking, the runtime contribution is ~30-50KB gzipped. No bloat.
- **Instant cold starts.** Neon's HTTP driver avoids persistent connections, which is ideal for Vercel serverless functions. No connection pooling setup needed.
- **Migrations are version-controlled.** `drizzle-kit generate` produces SQL migration files that live in the repo. Reviewable, reproducible, rollback-friendly.

### Cons

- **Drizzle 0.x maturity.** Drizzle is at 0.45.2 -- still pre-1.0. API surface has changed between minor versions in the past. For a demo this is irrelevant, but it is worth knowing if the topic of production readiness comes up in the interview.
- **Neon HTTP driver trade-off.** The serverless HTTP driver has higher per-query latency (~10-30ms overhead) compared to a persistent WebSocket connection. Acceptable for a demo with single-user traffic; would need the WebSocket driver or connection pooling for production workloads.
- **Schema design is load-bearing.** The matter/stage/action schema dictates how the agent reasons about state. Getting it wrong means rework across the agent's tool definitions and the UI. Need to get this right upfront.
- **No local dev database out of the box.** Neon is cloud-only. Local development either hits the cloud database (adds latency, uses CU-hours) or requires a local Postgres with a separate setup. For a few-day demo, hitting the cloud DB directly is fine.

### What This Touches

Single layer: database. The work is: define a Drizzle schema file with 3-5 tables (matters, matter_stages, matter_actions, conversations), configure the Neon HTTP connection, run `drizzle-kit generate` to produce migrations, and run `drizzle-kit migrate` to apply them. There is also a small amount of wiring: export the `db` instance so other features can import it, and set up the `DATABASE_URL` environment variable in Vercel.

The reason this is 1.5/5 instead of 1/5 is the schema design itself. The matter-stage-action hierarchy needs to support the agent's tool calls (e.g., "get pending tasks for current stage") and the UI's display needs (e.g., "show all stages with completion status"). Getting the relationships and status enums right takes some thought, even though the implementation is mechanical.

### Impact Analysis

| Metric              | Before    | After                     | Delta                                                    |
| ------------------- | --------- | ------------------------- | -------------------------------------------------------- |
| JS bundle (gzipped) | ~85-100KB | ~115-150KB                | +30-50KB                                                 |
| Dependencies added  | 0         | 2 runtime + 1 dev         | `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit` |
| Database            | None      | Neon Postgres (free tier) | Enables persistence for all features                     |
| LLM cost            | $0        | $0                        | No change                                                |
| Neon storage used   | 0         | <1MB                      | Negligible against 0.5GB free                            |

This is a foundation feature. Its "impact" is not user-visible on its own -- it enables everything else. Without it, the agent has no state, the UI has no data, and the demo is a stateless chatbot.

### Broad Todo List

**Database setup:**

- Create a Neon project and database via the Neon console
- Store the `DATABASE_URL` connection string in `.env.local` and Vercel project settings
- Install `drizzle-orm`, `@neondatabase/serverless`, and `drizzle-kit`

**Schema:**

- Create `src/db/schema.ts` with tables: `matters`, `matterStages`, `matterActions`, `conversations`
- Define enums for matter type (e.g., `residential_conveyancing`, `family_law`), stage status (`not_started`, `in_progress`, `completed`), action status
- Add proper foreign key relationships: matterStages -> matters, matterActions -> matterStages
- Add timestamps (`createdAt`, `updatedAt`) to all tables
- Add a `messages` JSONB column to `conversations` for storing chat history

**Connection:**

- Create `src/db/index.ts` with the Neon HTTP connection and Drizzle instance export
- Configure `drizzle.config.ts` for `drizzle-kit` pointing to the schema and Neon connection

**Migrations:**

- Run `drizzle-kit generate` to produce the initial migration SQL
- Run `drizzle-kit migrate` to apply it to the Neon database
- Commit the generated migration files to the repo

**Seed data:**

- Create a seed script that inserts a residential conveyancing workflow template (10 stages with their standard tasks)
- Optionally seed a sample matter in progress for demo purposes

### Additional Notes

The schema for the conveyancing workflow stages should be data-driven, not hardcoded. Store the "template" workflow (the 10 stages from the scout report) in the database or a config file, and create matter-specific stage instances when a new matter is started. This way the agent reads state from the DB rather than having workflow knowledge baked into prompts.

Consider adding a `workflowTemplates` table or a JSON config file that defines the stage sequence per matter type. This makes it trivial to add a second matter type (e.g., family law) later without code changes -- a strong demo talking point about extensibility.

---

## 2. Langfuse Observability Integration

**Difficulty: 2/5**

### Overview

Wire up Langfuse tracing via OpenTelemetry so every LLM call, tool invocation, and agent step is automatically traced and visible in the Langfuse dashboard. This is a "production thinking" signal -- it shows you do not just build features, you build observable features.

### Pros

- **Automatic tracing.** The OTel integration means AI SDK calls are traced without per-call instrumentation. Set it up once, every `streamText` / `generateText` / tool call gets a span.
- **High interview signal with low effort.** Being able to pull up a Langfuse dashboard and show an interviewer the trace of an agent conversation -- with latency, token counts, cost, and tool calls visible -- is a compelling proof of production thinking.
- **Session grouping.** Passing a `sessionId` to trace metadata groups all interactions for a single matter into one session. This maps perfectly to the legal domain: one session per matter.
- **Free tier is generous.** 50K units/month with 30-day retention. The demo will use a few hundred units at most.
- **Enables features #5 and #6.** User feedback scoring and prompt management both build on top of the Langfuse integration. Getting this in early unlocks two more features with zero additional dependencies.

### Cons

- **OTel setup is fiddly in Next.js.** The `@vercel/otel` package is incompatible with the OTel JS SDK v2 that Langfuse requires. You must use a manual `NodeTracerProvider` setup. There is an example repo, but it is an extra layer of configuration that can produce confusing errors if something is wired wrong.
- **OTel dependency weight.** `@opentelemetry/sdk-node` pulls in a non-trivial transitive dependency tree. While the runtime impact is manageable (~60-100KB gzipped), the `node_modules` growth is meaningful and `npm install` time increases.
- **Server-side only.** Langfuse tracing runs on the server. You cannot trace client-side events directly. The user feedback feature (#5) works around this with a separate API call, but it means the tracing dashboard only shows server-side activity.
- **Cloud dependency.** The free tier is a cloud service. If Langfuse has an outage during the demo, traces are lost (though the app still works -- tracing is non-blocking). Self-hosting is possible but overkill for a demo.
- **Added init complexity.** The manual OTel setup requires an instrumentation file that runs before the Next.js app starts. This is a separate entry point (`instrumentation.ts` / `instrumentation.node.ts`) that must be correctly configured in `next.config.ts`. Getting this wrong produces silent failures -- no errors, just no traces.

### What This Touches

Two layers: server initialization and AI SDK configuration. The work is: create an `instrumentation.ts` file that initializes the `NodeTracerProvider` with the Langfuse OTel exporter, configure `next.config.ts` to enable the instrumentation hook, and then pass `experimental_telemetry: { isEnabled: true }` to AI SDK calls. There is also a small setup step in the Langfuse cloud console (create project, get API keys).

The reason this is 2/5 is the OTel wiring nuance. The Langfuse SDK itself is simple, but the OTel bridge has specific requirements (Node.js runtime, not Edge; manual provider instead of `@vercel/otel`; correct initialization order). Once it works, it is invisible -- but debugging a misconfigured OTel setup is unpleasant because failures are silent.

### Impact Analysis

| Metric              | Before     | After                                               | Delta                                                                        |
| ------------------- | ---------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| JS bundle (gzipped) | ~115-150KB | ~175-250KB                                          | +60-100KB                                                                    |
| Dependencies added  | 2+1        | 5+1                                                 | +3 runtime: `@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node` |
| Observability       | None       | Full LLM tracing, cost tracking, latency visibility | Qualitative leap                                                             |
| Cloud services      | Neon       | Neon + Langfuse                                     | One more free-tier account to manage                                         |
| LLM cost            | $0         | $0                                                  | No change                                                                    |

Note: The bundle delta is primarily from the OTel SDK, which is server-side only. It does not affect the client-side JS bundle that users download. The gzipped figure above represents the server-side function size increase.

### Broad Todo List

**Langfuse setup:**

- Create a Langfuse cloud account and project at langfuse.com
- Note the public key, secret key, and host URL
- Store `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASEURL` in `.env.local` and Vercel project settings

**Dependencies:**

- Install `@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node`

**Instrumentation:**

- Create `src/instrumentation.ts` (or `instrumentation.node.ts`) that initializes `NodeTracerProvider` with the Langfuse OTel exporter
- Update `next.config.ts` to enable the `instrumentationHook` experimental feature (or the stable `instrumentation` config if on Next.js 15+)
- Ensure the AI route handlers use the Node.js runtime (not Edge)

**AI SDK integration:**

- Add `experimental_telemetry: { isEnabled: true }` to all `streamText` / `generateText` calls
- Pass `sessionId` (linked to the matter ID) in trace metadata for session grouping

**Verification:**

- Make an AI SDK call, check the Langfuse dashboard for the trace
- Verify spans include: model name, prompt/completion, token counts, latency, tool calls
- Confirm session grouping works (multiple calls for the same matter appear under one session)

### Additional Notes

Reference the official example repo during setup: [langfuse/langfuse-vercel-ai-nextjs-example](https://github.com/langfuse/langfuse-vercel-ai-nextjs-example). Do not try to figure out the OTel wiring from first principles -- the example is the fastest path.

The Langfuse dashboard URL will be a demo artifact worth bookmarking. During the interview, being able to say "let me show you the trace for that interaction" and pull up the dashboard is a strong move.

---

## 3. Provider-Agnostic LLM Architecture

**Difficulty: 1.5/5**

### Overview

Structure the LLM provider configuration so the app can switch between Gemini, Groq, and potentially other providers by changing a single environment variable or config value. This is not a feature users see directly -- it is an architectural pattern that demonstrates strategic thinking about vendor lock-in.

### Pros

- **Highest ROI-to-effort ratio in the entire roadmap.** The Vercel AI SDK already abstracts providers. The actual work is: install one extra provider package, create a provider factory function, and wire it to an env var. Maybe 1-2 hours.
- **Direct interview relevance.** the company is evaluating AI agent frameworks. Showing that you think about provider portability -- not just "make it work with one model" -- signals architectural maturity.
- **Free fallback path.** If Gemini rate limits are hit during a live demo (10 RPM), having Groq as a hot fallback with a config switch prevents demo failure. Groq has 30 RPM on its free tier.
- **Talking point about framework evaluation.** This naturally leads into a conversation about Vercel AI SDK vs LangChain vs Mastra -- which is exactly the kind of evaluation the company's job description says they are doing.

### Cons

- **Behavior differences between providers.** Gemini 2.5 Flash and Llama 3.3 70B (Groq) have meaningfully different tool-calling behavior, instruction following, and output quality. The agent's prompts are tuned for one model -- switching providers may produce noticeably worse results without prompt adjustments per provider.
- **Testing burden multiplies.** Each provider should be at least smoke-tested with the agent flow. In practice, for a demo, you will test thoroughly with Gemini and do a cursory check with Groq. This is fine, but it means the "provider agnostic" claim is partially aspirational.
- **Adds a code path that is not exercised by default.** The Groq path will be the "backup" that rarely runs. Dead code paths rot. For a demo this does not matter, but in a production context you would want CI testing both paths.
- **Marginal bundle increase.** Each additional provider SDK is ~20KB gzipped. Negligible, but it is a dependency that adds no value to the primary path.

### What This Touches

A single utility layer. The work is: install `@ai-sdk/groq`, create a `src/lib/ai/provider.ts` module that exports a function returning the correct model based on an env var (`AI_PROVIDER=gemini|groq`), and use this function in all AI SDK calls instead of directly importing the Gemini provider. Optionally, add a settings page or config endpoint that shows which provider is active.

This is 1.5/5 because the SDK does the hard work. The only design decision is how to expose the toggle (env var only vs. runtime switch via UI) and whether to include per-provider prompt adjustments.

### Impact Analysis

| Metric              | Before               | After                                | Delta                            |
| ------------------- | -------------------- | ------------------------------------ | -------------------------------- |
| JS bundle (gzipped) | ~175-250KB           | ~195-270KB                           | +~20KB (one additional provider) |
| Dependencies added  | 5+1                  | 6+1                                  | +1: `@ai-sdk/groq`               |
| Provider coverage   | 1 (Gemini)           | 2 (Gemini + Groq)                    | Fallback available               |
| Rate limit headroom | 10 RPM / 250 req/day | 10 RPM + 30 RPM / 250 + 1000 req/day | Combined pool if needed          |
| LLM cost            | $0                   | $0                                   | Both free tier                   |

### Broad Todo List

**Dependencies:**

- Install `@ai-sdk/groq`
- Add `GROQ_API_KEY` to `.env.local` and Vercel project settings

**Provider abstraction:**

- Create `src/lib/ai/provider.ts` that exports a `getModel()` function
- Read `AI_PROVIDER` env var (default: `gemini`) to select the provider
- Map provider names to AI SDK model constructors: `gemini` -> `google('gemini-2.5-flash')`, `groq` -> `groq('llama-3.3-70b-versatile')`
- Use `getModel()` in all `streamText` / `generateText` calls instead of direct provider imports

**Verification:**

- Test the agent flow with `AI_PROVIDER=gemini` (primary)
- Test the agent flow with `AI_PROVIDER=groq` (smoke test -- verify tool calling works, output is coherent)
- Note any quality differences for discussion during interview

**Optional (stretch):**

- Add a simple settings page or admin panel showing current provider and allowing runtime switch
- Add per-provider system prompt adjustments if tool-calling behavior diverges significantly

### Additional Notes

During the interview, this feature is a gateway to discussing the broader framework landscape. Prepare talking points: "We used AI SDK because it matches your stack, but its provider abstraction means we could evaluate Gemini, Llama, Claude, or GPT-4 without changing the agent logic. For more complex stateful workflows, LangGraph.js is worth evaluating -- and AI SDK has a LangChain adapter so it is not either/or."

This is the feature where knowing about Mastra and LangGraph (from the scout report section 3) pays off, even though neither is used in the demo.

---

## 4. Matter Lifecycle Progression Agent

**Difficulty: 3/5**

### Overview

The core feature. A user selects a matter type and what state they want to do it in (residential conveyancing -- buyer side in NSW), the app creates a matter instance with a defined stage workflow, and an AI agent analyzes current state to suggest next actions, flag risks, answer questions, and track progress through stages. Uses the Vercel AI SDK v6 Agent abstraction with tool calling against the database.

### Pros

- **This IS the demo.** Everything else is supporting infrastructure. This feature is the thing the interviewer will see and interact with. It is the direct analog of the product.
- **Demonstrates domain understanding.** The agent must know the conveyancing workflow stages, what happens at each stage, and what tasks need completing. Building this shows you understand the legal domain, not just the tech stack.
- **AI SDK v6 Agent abstraction is purpose-built for this.** The agent loop with `stopWhen`, tool calling, and streaming is exactly the pattern needed. No custom orchestration code required -- the framework handles the loop, you define the tools and instructions.
- **Concrete, observable output.** The agent produces actionable suggestions: "You should now conduct local authority searches. Here are the specific searches to order." This is tangible and testable, not abstract AI fluff.
- **State machine + AI hybrid.** The stages are structured (defined workflow), but the agent provides intelligent guidance within each stage. This hybrid is more interesting than pure chatbot or pure state machine -- and it is exactly what "AI-driven workflow guidance" means.

### Cons

- **Prompt engineering is the hard part.** The agent needs a system prompt that encodes the conveyancing workflow, explains the tools, and produces useful legal-sounding guidance without hallucinating specific legal advice. This is iterative, time-consuming work. Budget at least a full day for prompt iteration.
- **Tool definition surface area.** The agent needs at minimum 4-6 tools: get current stage, get pending tasks, mark task complete, suggest next actions, get matter summary, possibly advance stage. Each tool needs: a Zod schema, a handler that queries the DB, and integration testing. This is the bulk of the development time.
- **Domain accuracy risk.** The agent will say things about Australian residential conveyancing. If an interviewer has legal domain knowledge and the agent says something wrong, it undermines the demo. The system prompt must be carefully grounded, and the agent should be instructed to caveat its suggestions (e.g., "In a typical NSW conveyancing matter, the next step would be...").
- **Streaming UX complexity.** Showing the agent "thinking" in real-time via `streamText` requires a frontend that handles partial responses, tool call indicators, and error states gracefully. The `useChat` React hook from AI SDK simplifies this, but the UX still needs attention (loading states, markdown rendering, tool call visualizations).
- **State synchronization.** The agent reads state from the DB (via tools), but the UI also displays state (stage progress, task lists). After the agent marks a task complete, the UI needs to reflect this. This requires either optimistic updates, polling, or real-time subscriptions. For a demo, polling or manual refresh is fine, but it is a UX rough edge.

### What This Touches

Three layers: backend (agent definition, tool handlers, API route), database (queries for matter state), and frontend (chat UI, stage progress display).

**Backend:** Define the agent using AI SDK v6's `Agent` class (or the functional equivalent with `streamText` + tools). Write 4-6 tool handler functions that query/mutate the database via Drizzle. Create a Next.js API route (`app/api/chat/route.ts`) that accepts messages and streams the agent's response. Create a state machine to handle the different states and transition between states.

**Database:** The tool handlers execute Drizzle queries: `SELECT` for current stage and tasks, `UPDATE` for marking tasks complete and advancing stages. The schema from feature #1 must support these queries efficiently.

**Frontend:** A chat interface using AI SDK's `useChat` hook for streaming, plus a sidebar or header showing the matter's stage progress (which stages are complete, current stage, upcoming stages). Matter creation flow (select type, create matter).

The reason this is 3/5 is the coordination between layers. The agent loop itself is handled by the SDK, but the tools, prompts, and UI all need to work together. Prompt iteration is time-consuming. Tool edge cases (what if the agent tries to skip a stage? what if all tasks in a stage are already complete?) need handling. The frontend needs to display both conversational AI output and structured state.

### Impact Analysis

| Metric                           | Before     | After                            | Delta                                        |
| -------------------------------- | ---------- | -------------------------------- | -------------------------------------------- |
| JS bundle (gzipped)              | ~195-270KB | ~345-420KB                       | +~150KB (AI SDK + Google provider + chat UI) |
| Dependencies added               | 6+1        | 8+1                              | +2: `ai`, `@ai-sdk/google`                   |
| API routes                       | 0          | 1-2                              | `/api/chat`, optionally `/api/matters`       |
| LLM calls per interaction        | 0          | 1-5 (agent loop with tool calls) | ~2-5 round trips per user message            |
| Gemini daily budget impact       | 0          | ~5-20 requests per demo session  | 250/day leaves room for ~12-50 sessions      |
| Database queries per interaction | 0          | 2-10                             | Tool handlers read/write matter state        |
| Pages/components                 | 0          | 3-5                              | Home, matter view, chat, stage progress      |

Note: The 150KB bundle delta includes the AI SDK runtime and the Google provider package. The `useChat` hook and React components add to the client bundle; the agent logic and tool handlers are server-side only.

### Broad Todo List

**Agent definition:**

- Create `src/lib/ai/agent.ts` defining the agent's system prompt and tool set
- Write the system prompt encoding the residential conveyancing workflow (10 stages, stage-specific tasks, transition rules, state specific rules as rules probably differ between states)
- Define tool schemas with Zod: `getCurrentStage`, `getPendingTasks`, `markTaskComplete`, `suggestNextActions`, `getMatterSummary`
- Optionally add `advanceStage` tool with validation (all tasks in current stage must be complete)

**Tool handlers:**

- Implement `getCurrentStage` -- query matter's current stage and its metadata from DB
- Implement `getPendingTasks` -- query incomplete actions for the current stage
- Implement `markTaskComplete` -- update action status, check if stage can advance
- Implement `suggestNextActions` -- return context-aware suggestions based on current stage and pending tasks
- Implement `getMatterSummary` -- aggregate matter state across all stages for agent context

**API route:**

- Create `app/api/chat/route.ts` using `streamText` with the agent's tools and system prompt
- Accept matter ID and messages in the request body
- Pass matter ID to tool handlers for scoped queries
- Use `experimental_telemetry` to enable Langfuse tracing
- Export `maxDuration` for Vercel Fluid Compute timeout

**Backend -- State Machine:**

- This will have to be filled out in the research phase so the state machine and the ai agent work together to achieve the best result for the user

**Frontend -- Chat:**

- Create a chat component using AI SDK's `useChat` hook connected to the `/api/chat` route
- Handle streaming responses with a message list display
- Render markdown in agent responses (install a lightweight markdown renderer)
- Show loading/thinking states during agent processing
- Display tool call indicators (e.g., "Checking pending tasks...")

**Frontend -- Matter management:**

- Create a matter creation page/modal (select matter type, enter title, create)
- Create a matter view page showing stage progress (sidebar or header with stages as a progress tracker)
- Wire stage progress to poll or refresh after agent interactions

**Frontend -- Stage progress:**

- Build a stage progress component showing all 10 conveyancing stages with status indicators
- Highlight current stage, show completed stages, dim future stages
- Optionally show task completion count per stage (e.g., "3/5 tasks complete")

**Prompt iteration:**

- Test the agent with typical user queries: "What should I do next?", "I've received the contract from the vendor's solicitor", "What searches do I need to order?"
- Refine the system prompt to reduce hallucination and improve domain accuracy
- Test edge cases: user tries to skip stages, asks about tasks outside current stage, asks for specific legal advice (agent should defer)

### Additional Notes

The system prompt is the most important artifact in this feature. It should:

1. Define the agent's role ("You are a legal workflow assistant for a residential conveyancing matter")
2. Encode the workflow stages and their sequence
3. Instruct the agent to use tools to read state before answering
4. Instruct the agent to not provide specific legal advice, only workflow guidance
5. Include Australian legal terminology and context (e.g., PEXA, stamp duty, Land Registry)

But it should also work with the state machine to guide it to what is the appropriate next stage.

The conveyancing workflow data from the scout report (section 6) should be used directly in the system prompt and/or seed data. The 10 stages with their key tasks are well-defined and publicly available.

For the UI, do not over-invest. A clean chat interface with a stage progress indicator is sufficient. This is not a design competition -- it is a demonstration of AI agent architecture. Spend 70% of the time on the agent and 30% on the UI.

---

## 5. User Feedback Loop

**Difficulty: 2/5**

### Overview

Add thumbs up/down buttons on each AI suggestion. When a user rates a suggestion, the score is sent to Langfuse and attached to the corresponding trace. This closes the feedback loop: not just "the AI generates suggestions" but "we measure whether those suggestions are useful and can improve over time."

### Pros

- **Very high interview signal.** This shows you understand the AI product lifecycle: build -> measure -> improve. Most demo projects stop at "build." Adding the measurement layer shows you think about what happens after launch.
- **Directly mirrors the company's existing patterns.** the company's LawY feature has a "human-in-the-loop" verification mechanism. Showing a feedback loop demonstrates alignment with their product philosophy.
- **Zero new dependencies.** Uses the existing Langfuse SDK from feature #2. The work is purely frontend buttons and one API endpoint.
- **Tiny scope, disproportionate impact.** A few hours of work for a feature that changes the demo narrative from "look what the AI does" to "look how we measure and improve the AI."

### Cons

- **Feedback without action is performative.** In a real product, scores feed into prompt optimization, fine-tuning, or human review. In this demo, the scores sit in Langfuse with no downstream effect. An astute interviewer might ask "so what do you do with these scores?" -- be prepared to discuss the production path (evaluation dashboards, prompt A/B testing, threshold alerts).
- **Trace ID plumbing.** To attach a score to a Langfuse trace, you need the trace ID on the frontend. This requires passing the trace ID from the server response back to the client, which means modifying the streaming response format or adding a post-response metadata call. Not hard, but it is a cross-layer wiring task that is easy to get wrong.
- **UX clutter risk.** Adding feedback buttons to every message can make the chat feel cluttered. Need to be selective -- only show feedback buttons on substantive agent responses (not on "I'll check that for you" intermediate messages).

### What This Touches

Two layers: frontend (feedback buttons, score submission) and backend (API endpoint that calls Langfuse's score API).

**Frontend:** Add thumbs up/down buttons to agent response messages in the chat. On click, send the trace ID and score to a new API endpoint. Show visual confirmation (button highlights, brief toast).

**Backend:** Create an API endpoint (`app/api/feedback/route.ts`) that accepts trace ID, score (positive/negative), and optionally a comment. Call the Langfuse SDK to attach the score to the trace.

**Cross-cutting:** The streaming response from the agent must include or be augmented with the Langfuse trace ID so the frontend can reference it when submitting feedback.

This is 2/5 because the Langfuse scoring API is simple, but the trace ID plumbing across the streaming boundary adds a small integration challenge.

### Impact Analysis

| Metric                     | Before     | After      | Delta                                          |
| -------------------------- | ---------- | ---------- | ---------------------------------------------- |
| JS bundle (gzipped)        | ~345-420KB | ~345-420KB | +0KB (no new deps)                             |
| Dependencies added         | 0          | 0          | Uses existing Langfuse SDK                     |
| API routes                 | 1-2        | 2-3        | +1: `/api/feedback`                            |
| Langfuse units/interaction | ~1-5       | ~2-6       | +1 unit per score submission                   |
| UI components              | 3-5        | 4-6        | +1-2: feedback buttons, confirmation indicator |

### Broad Todo List

**Backend:**

- Create `app/api/feedback/route.ts` accepting `{ traceId, score, comment? }` in POST body
- Call Langfuse SDK's `score()` method to attach a numeric or categorical score to the trace
- Return success/error response
- Add input validation (traceId required, score must be valid)

**Trace ID plumbing:**

- Investigate how AI SDK streaming responses can include metadata (trace ID)
- Option A: Return trace ID as a custom header in the streaming response
- Option B: Add a separate endpoint to fetch the trace ID for the latest interaction
- Wire the trace ID into the chat message state on the frontend

**Frontend:**

- Add thumbs up/down buttons to agent response messages in the chat component
- Only show buttons on substantive responses (skip tool-call-only messages)
- On click, call the `/api/feedback` endpoint with the trace ID and score
- Show visual feedback: highlight selected button, brief confirmation
- Disable buttons after submission (prevent double-scoring)

**Verification:**

- Submit a positive and negative score from the UI
- Check the Langfuse dashboard to confirm scores appear on the correct traces
- Verify the score is visible in the trace detail view and in any evaluation dashboards

### Additional Notes

Prepare talking points for "what happens with the scores in production": evaluation dashboards in Langfuse, prompt A/B testing (feature #6 enables this), threshold alerts (e.g., if >30% of suggestions in a matter type get thumbs-down, flag the prompt for review), and eventually fine-tuning or RAG improvement using highly-rated examples as positive training data.

The combination of features #5 and #6 tells a complete story: prompts are managed and versioned in Langfuse, users provide feedback on agent quality, and feedback is tracked per prompt version -- enabling data-driven prompt optimization.

---

## 6. Prompt Management via Langfuse

**Difficulty: 2/5**

### Overview

Instead of hardcoding system prompts in the codebase, store them in Langfuse's prompt management system. Fetch prompts at runtime. Version prompts, deploy changes without code deploys, and (combined with feature #5) track performance per prompt version.

### Pros

- **Decouples prompt engineering from deployments.** In a production AI product, prompt changes are the most frequent iteration. Requiring a code deploy for every prompt tweak is a bottleneck. Langfuse prompt management makes prompt changes a config change, not a code change.
- **Version history and rollback.** Langfuse tracks every prompt version. If a new prompt performs worse (measurable via feature #5's feedback scores), roll back to the previous version without touching code.
- **A/B testing pathway.** Langfuse supports prompt variants. Combined with user feedback scoring, you can compare prompt version A vs B by their aggregate scores. This is a production AI maturity pattern that few demo projects demonstrate.
- **Zero new dependencies.** Uses the existing Langfuse SDK.
- **Makes the demo more impressive to show.** During the interview, you can open Langfuse, edit the system prompt, and show the agent's behavior change in real-time without redeploying. This is a "wow" moment.

### Cons

- **Runtime dependency on Langfuse API.** Every agent call now fetches the prompt from Langfuse before calling the LLM. If Langfuse is down or slow, the agent is impacted. Mitigation: cache prompts with a TTL, fall back to a hardcoded default if the fetch fails. But this adds error handling complexity.
- **Latency per request.** Each prompt fetch is an HTTP call to Langfuse (~50-200ms). For a demo with single-user traffic, this is imperceptible. For production with many concurrent users, you would need caching. The Langfuse SDK supports caching, but it is an extra configuration step.
- **Prompt editing outside the codebase.** The system prompt -- arguably the most important artifact in the app -- now lives in Langfuse, not in the git repo. This means no PR reviews for prompt changes, no git blame, no diff history in the repo. For a demo this is fine; for production, you would want a CI/CD pipeline that syncs prompts from git to Langfuse.
- **Template variable wiring.** If the prompt uses variables (e.g., `{{matterType}}`, `{{currentStage}}`), you need to compile the template at runtime by passing variables to the Langfuse prompt fetch. This is supported but adds a layer of indirection.

### What This Touches

Two layers: the agent definition (fetches prompt from Langfuse instead of reading from a local constant) and the Langfuse console (creating and managing prompts there).

**Agent definition:** Replace the hardcoded system prompt in `src/lib/ai/agent.ts` with a Langfuse prompt fetch call. Compile the prompt template with matter-specific variables. Add error handling with a hardcoded fallback.

**Langfuse console:** Create the prompt in Langfuse with the system prompt text, set it as the active version, and configure any template variables.

This is 2/5 because the Langfuse prompt management API is simple (fetch prompt by name, compile with variables, use as system message). The complexity is in the error handling (fallback if fetch fails) and in restructuring the existing hardcoded prompt to work as a template.

### Impact Analysis

| Metric                        | Before              | After                    | Delta                              |
| ----------------------------- | ------------------- | ------------------------ | ---------------------------------- |
| JS bundle (gzipped)           | ~345-420KB          | ~345-420KB               | +0KB (no new deps)                 |
| Dependencies added            | 0                   | 0                        | Uses existing Langfuse SDK         |
| Latency per agent call        | ~0ms prompt loading | +50-200ms (prompt fetch) | Cacheable; imperceptible in demo   |
| Langfuse units/interaction    | ~2-6                | ~3-7                     | +1 unit per prompt fetch           |
| External service dependencies | Neon + Langfuse     | Neon + Langfuse (deeper) | Prompt is now a runtime dependency |

### Broad Todo List

**Langfuse setup:**

- Create a prompt in the Langfuse console named "matter-progression-agent" (or similar)
- Paste the system prompt text from the agent definition
- Define template variables (e.g., `matterType`, `currentStageName`) if using dynamic content
- Set as active version

**Agent modification:**

- Modify `src/lib/ai/agent.ts` to fetch the prompt from Langfuse at the start of each agent call
- Use the Langfuse SDK's `getPrompt('matter-progression-agent')` method
- Compile the prompt template with matter-specific variables
- Add error handling: if prompt fetch fails, log the error and fall back to a hardcoded default prompt
- Add optional TTL caching to reduce Langfuse API calls (especially useful if demonstrating multiple rapid interactions)

**Verification:**

- Verify the agent uses the Langfuse-managed prompt (check the trace in Langfuse to see the fetched prompt text)
- Edit the prompt in Langfuse, make a new agent call, verify the new prompt is used
- Test the fallback: temporarily use an invalid Langfuse key, verify the agent still works with the hardcoded default

**Demo preparation:**

- Prepare a small prompt edit to perform live during the interview (e.g., change the agent's tone or add a new instruction)
- Bookmark the Langfuse prompt management page for quick access

### Additional Notes

The live-edit demo is the killer feature here. The sequence is: (1) interact with the agent, (2) open Langfuse, (3) edit the prompt (e.g., "Now also mention stamp duty obligations when the matter reaches the exchange stage"), (4) interact with the agent again and see the new behavior. This takes 60 seconds and demonstrates a production workflow that would normally require a code change, PR review, and deployment.

Combined with feature #5, the story becomes: "We version prompts, measure their quality via user feedback, and can iterate without deploys." This is the operations maturity trifecta for AI products: observe, measure, iterate.

---

## Summary Table

| #   | Feature                   | Difficulty | Impact    | Effort     | Bundle Delta (gzipped) | New Deps | Done |
| --- | ------------------------- | ---------- | --------- | ---------- | ---------------------- | -------- | ---- |
| 1   | Drizzle + Neon Data Layer | 1.5/5      | Medium    | Low        | +30-50KB               | 2+1 dev  |      |
| 2   | Langfuse Observability    | 2/5        | High      | Low-Medium | +60-100KB \*           | 3        |      |
| 3   | Provider-Agnostic LLM     | 1.5/5      | Medium    | Low        | +~20KB                 | 1        |      |
| 4   | Matter Lifecycle Agent    | 3/5        | Very High | High       | +~150KB                | 2        |      |
| 5   | User Feedback Loop        | 2/5        | High      | Low        | +0KB                   | 0        |      |
| 6   | Prompt Management         | 2/5        | High      | Low        | +0KB                   | 0        |      |

\* Langfuse/OTel bundle delta is server-side only -- does not affect client JS payload.

**Total estimated bundle (all features):** ~345-440KB gzipped (client-side: ~280-350KB; server-side: remainder)
**Total new dependencies:** 8 runtime + 1 dev
**Total estimated dev time:** 4-6 days (features #1-4 take the bulk; #5-6 each take a few hours)

---

## Watch List

| Feature                   | Risk                                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4. Matter Lifecycle Agent | **Prompt quality / domain accuracy.** The agent will generate legal-sounding guidance about Australian conveyancing. If an interviewer has domain expertise and catches an inaccuracy, it undermines the entire demo. | Ground the system prompt heavily in the publicly available conveyancing workflow data. Instruct the agent to caveat suggestions ("In a typical NSW conveyancing matter...") and never present as specific legal advice. Test with a domain reference guide open. |
| 4. Matter Lifecycle Agent | **Gemini rate limits during live demo.** At 10 RPM on the free tier, a nervous demo with rapid retries could hit the limit. The error state (if unhandled) would break the demo flow.                                 | Implement rate limit error handling in the API route. Use feature #3's provider fallback to switch to Groq if Gemini limits are hit. Keep interactions deliberate during the demo -- prepare a script.                                                           |
| 2. Langfuse Observability | **OTel initialization failures are silent.** If the instrumentation file is misconfigured, the app works fine but no traces appear. This can waste hours debugging "why aren't my traces showing up?"                 | Follow the example repo exactly. Test tracing immediately after setup -- before building anything else on top of it. Check the Langfuse ingestion logs if traces do not appear.                                                                                  |
| 6. Prompt Management      | **Langfuse latency under demo conditions.** If the Langfuse cloud has a slow moment during the live demo, the prompt fetch could add visible delay.                                                                   | Implement prompt caching with a 5-minute TTL. Pre-warm the cache by making one agent call before the demo starts. Have the hardcoded fallback ready.                                                                                                             |

---

## Recommended First Sprint

Build these features in this order for maximum ROI in the shortest time:

1. **Drizzle + Neon Data Layer (#1)** -- Foundation. Everything depends on it. Half a day. Get the schema right, seed the conveyancing workflow, and move on.

2. **Langfuse Observability (#2)** -- Wire this up immediately after the data layer, before the agent. Having tracing from the very first LLM call means you debug faster for the rest of the build. A few hours, but front-loading it saves time overall.

3. **Provider-Agnostic LLM Architecture (#3)** -- Quick win. Set up the provider abstraction and both API keys before building the agent. When you start building the agent, you can already test against both Gemini and Groq. One to two hours.

4. **Matter Lifecycle Progression Agent (#4)** -- The core. This is 60-70% of the total build time. With #1, #2, and #3 already in place, you can focus entirely on the agent logic, tools, and UI. Every LLM call is automatically traced. Provider fallback is ready. State persists to Neon.

Features #5 (User Feedback) and #6 (Prompt Management) are stretch goals that build on top of #2 and #4. If time permits after the agent is working, add them -- they are high-impact and low-effort. If time is tight, skip them and mention the plan during the interview.

---

## Dependency Graph

```
#1 Drizzle + Neon Data Layer
 |
 |--- (hard) ---> #4 Matter Lifecycle Agent
 |                     |
 |                     |--- (hard) ---> #5 User Feedback Loop
 |                     |
 |                     |--- (hard) ---> #6 Prompt Management
 |
#2 Langfuse Observability
 |
 |--- (soft) ---> #4 Matter Lifecycle Agent (tracing available from first LLM call)
 |
 |--- (hard) ---> #5 User Feedback Loop (requires Langfuse for score submission)
 |
 |--- (hard) ---> #6 Prompt Management (requires Langfuse for prompt storage)
 |
#3 Provider-Agnostic LLM
 |
 |--- (soft) ---> #4 Matter Lifecycle Agent (provider abstraction used in agent)
```

**Hard dependencies:**

- #4 requires #1 (agent tools query the database)
- #5 requires #2 and #4 (scoring traces from agent interactions)
- #6 requires #2 and #4 (fetching prompts for the agent)

**Soft dependencies:**

- #4 benefits from #2 (tracing) and #3 (provider abstraction), but could technically be built without them and have them wired in later
- #3 is independent but most useful when #4 exists to demonstrate the swap

**No conflicts identified.** All features share the same architectural assumptions (Next.js App Router, server-side AI SDK, Langfuse OTel integration).
