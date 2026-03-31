# Implementation Summary: Langfuse Observability via OpenTelemetry

**Date:** 2026-03-30
**Plan:** /Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/plans/20260330-180000-langfuse-otel-observability.md

## Steps Completed

### 1. Dependencies added to package.json (Step 1.1)
Four new direct dependencies added to `package.json`:
- `@langfuse/otel: ^5.0.0` -- Langfuse OTel span exporter
- `@opentelemetry/sdk-trace-node: ^2.0.0` -- OTel Node.js tracer provider
- `ai: ^4.0.0` -- Vercel AI SDK core
- `@ai-sdk/google: ^3.0.0` -- Google Gemini provider for AI SDK

**User must run `npm install` to resolve and install packages.**

### 2. Environment variables (Steps 2.1, 2.2, 2.3)
- `.env.example` updated with `LANGFUSE_PUBLIC_KEY=`, `LANGFUSE_SECRET_KEY=`, `LANGFUSE_BASEURL=https://cloud.langfuse.com`, and `GOOGLE_GENERATIVE_AI_API_KEY=`
- `.env.local` updated to add `LANGFUSE_BASEURL` alias (the file already had `LANGFUSE_BASE_URL`; both are now present) and a `GOOGLE_GENERATIVE_AI_API_KEY=` placeholder
- **User action required:** Fill in the real `GOOGLE_GENERATIVE_AI_API_KEY` value in `.env.local` from https://aistudio.google.com/apikey

### 3. Instrumentation file (Step 3.1)
Created `src/instrumentation.ts`:
- Exports `async function register()` (Next.js auto-detected instrumentation hook)
- Guarded with `if (process.env.NEXT_RUNTIME === "nodejs")` to prevent Edge runtime crash
- Uses dynamic `await import()` for all OTel imports
- Initializes `NodeTracerProvider` with `SimpleSpanProcessor(LangfuseExporter)`
- Logs `Instrumentation: Langfuse OTel provider registered` as smoke test
- Comment included about fallback import path for `SimpleSpanProcessor` if not exported from `@opentelemetry/sdk-trace-node`

### 4. Telemetry config helper (Step 4.1)
Created `src/lib/ai/telemetry.ts`:
- Exports `createTelemetryConfig({ functionId, matterId, userId? })` function
- Returns `{ isEnabled: true, functionId, metadata: { sessionId: matterId, userId } }`
- Includes validation comment about `experimental_telemetry` vs `telemetry` property name in AI SDK v6

### 5. Test API route (Step 5.1)
Created `src/app/api/chat/route.ts`:
- POST handler that accepts `{ messages, matterId }` from request body
- Defaults `matterId` to `'test-matter-001'` if absent
- Calls `streamText` with `google('gemini-2.5-flash')`, legal system prompt, messages, and telemetry config
- Returns `result.toDataStreamResponse()` for streaming response
- No `runtime` export (defaults to Node.js, required for OTel)

## Steps Skipped / Deferred

### Step 1.2 -- npm audit
Deferred to user. No shell execution capability available in implementer role.
**User action:** Run `npm audit` after `npm install` and address any HIGH/CRITICAL advisories.

### Steps 6.1-6.4 -- End-to-end verification
All four verification steps require running a live dev server and checking the Langfuse cloud dashboard. Deferred to user.

**User verification checklist:**
1. Run `npm install`
2. Fill in `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`
3. Run `npm run dev` -- check terminal for `Instrumentation: Langfuse OTel provider registered`
4. Run `npm run build` -- confirm no TypeScript/build errors
5. Run `npm run lint` -- confirm Biome passes on new files
6. Send test request:
   ```bash
   curl -X POST http://localhost:3000/api/chat \
     -H "Content-Type: application/json" \
     -d '{"messages": [{"role": "user", "content": "What is the first step in a residential conveyancing matter?"}], "matterId": "test-matter-001"}'
   ```
7. Check Langfuse dashboard (https://cloud.langfuse.com) Traces view within 30 seconds
8. Send a second request with the same `matterId`; verify both traces appear under the same session

## Deviations from Plan

1. **`LANGFUSE_BASEURL` alias added alongside existing `LANGFUSE_BASE_URL`.** The `.env.local` file already existed with `LANGFUSE_BASE_URL` (underscore). Added `LANGFUSE_BASEURL` as an alias so the code (`process.env.LANGFUSE_BASEURL`) resolves correctly.

2. **`ai` version range `^4.0.0` not `^6.0.0`.** Without shell execution, the actual latest npm version cannot be confirmed. The plan's Step 4.1 validation (check type definitions for `experimental_telemetry` vs `telemetry`) must be done after install. If npm resolves a version below 6, the user should run `npm install ai@latest`.

3. **`experimental_telemetry` cast to `any` in route.ts.** Added to prevent TypeScript error before packages are installed. Should be refined to the correct type after `npm install`.

4. **`GOOGLE_GENERATIVE_AI_API_KEY` added as placeholder.** The user's task description said this key was in `.env.local` but it was not present in the file. Placeholder added; user must fill in the real value.

## Verification Results

All programmatic verification deferred to user (no shell execution). Manual verification items pending:
- [ ] `npm install` resolves without conflicts
- [ ] `npm ls @opentelemetry/api` shows single version
- [ ] `npm audit` shows no HIGH/CRITICAL advisories
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] Dev server shows instrumentation smoke-test log
- [ ] curl test returns streamed Gemini response
- [ ] Trace appears in Langfuse dashboard
- [ ] Session grouping works for same matterId
