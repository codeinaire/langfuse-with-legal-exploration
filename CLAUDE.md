# CLAUDE.md

## Code Style

- **Formatter:** Biome — 2-space indent, double quotes, semicolons only as needed
- **Imports:** Auto-organized by Biome. Use `@/*` path alias for `src/` imports
- **Lint before committing:** `npm run lint` (Biome check). Fix with `npm run lint:fix`
- **Types:** Strict TypeScript. No `any` unless mocking in tests. Prefer type inference where possible
- **Error handling:** Use discriminated unions (e.g., `SuccessTransition | FailTransition`) over throwing exceptions for expected failures. Reserve `throw` for programmer errors
- **Validation:** Use Zod at system boundaries (API routes, external input). Trust internal function arguments

## Architecture

- **Server components** fetch data. **Client components** handle interactivity. Don't mix
- **Database queries** live in `src/lib/db/queries/`. Don't inline Drizzle queries in API routes or components
- **AI tools** live in `src/lib/ai/tools.ts`. Each tool receives `AgentContext` (matterId, db) injected server-side — the LLM never sees or generates these values
- **State machine** (`src/lib/state-machine/`) enforces stage progression rules. All stage transitions go through `tryAdvanceStage` — never update stage status directly
- **Model provider** is configured via `AI_PROVIDER` env var with automatic fallback chain. Don't hardcode provider-specific logic outside `src/lib/ai/model.ts`

## Database

- **ORM:** Drizzle ORM with Neon serverless HTTP driver
- **Migrations:** `npm run db:generate` then `npm run db:migrate`. Migrations are version-controlled in `drizzle/`
- **Schema:** `src/db/schema.ts` is the source of truth. 6 tables, 6 enums, explicit relations
- **Enums:** Stage names, statuses, and roles use PostgreSQL enums — not string literals. Reference enum values from the schema (e.g., `conveyancingStageEnum.enumValues`)
- **Seed:** `npm run db:seed` truncates all data and re-seeds. Destructive — don't run against shared environments

## AI Agent

- **System prompt** is in `src/lib/ai/prompts.ts`. It contains deep Australian conveyancing domain knowledge. Changes to workflow rules should be reflected here
- **Tool step limit** is set via `stopWhen: stepCountIs(5)` in the chat route. This prevents runaway tool loops
- **Cross-matter guard:** `markActionComplete` verifies the action belongs to the target matter before mutating. Don't bypass this
- **Observability:** Langfuse + OpenTelemetry traces all AI SDK calls automatically via `src/instrumentation.ts`. Feedback scores are linked to traces via `langfuseTraceId` in message metadata

## Testing

- **Runner:** Vitest. Run with `npm test` or `npm run test:watch`
- **Test location:** Co-locate test files next to the code they test (e.g., `conveyancing.test.ts` next to `conveyancing.ts`)
- **DB-dependent code:** Mock the db object in tests. Don't require a live database for unit tests
- **Pure functions first:** Prefer testing pure functions (e.g., `getNextStage`) directly. Mock only what you must

## Key Patterns

- **Parallel data fetching:** Server components fetch independent data in parallel (see `MatterPage`)
- **Streaming responses:** Chat uses `streamText` with `UIMessageStreamResponse` — don't buffer full responses
- **Feedback loop:** Thumbs up/down + comments go to Langfuse as scores attached to traces. This data feeds prompt iteration
- **Router refresh:** After agent responses, `router.refresh()` re-renders server components so the stage progress sidebar reflects any state changes made by tools
