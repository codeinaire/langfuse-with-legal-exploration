# Implementation Summary: Langfuse Observability via OpenTelemetry

**Date:** 2026-03-30
**Plan:** project/plans/20260330-180000-langfuse-otel-observability.md

## Steps Completed

### 1. Dependencies added to package.json
- `@langfuse/otel: ^5.0.0` -- Langfuse OTel span processor
- `@opentelemetry/sdk-trace-node: ^2.0.0` -- OTel Node.js tracer provider
- `ai: ^6.0.141` -- Vercel AI SDK v6
- `@ai-sdk/google: ^3.0.54` -- Google Gemini provider for AI SDK
- `zod: ^3.25.76` -- Schema validation for request parsing

### 2. Environment variables
- `.env.example` updated with `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL`, and `GOOGLE_GENERATIVE_AI_API_KEY`

### 3. Instrumentation file (`src/instrumentation.ts`)
- Exports `async function register()` (Next.js instrumentation hook)
- Guarded with `if (process.env.NEXT_RUNTIME === "nodejs")` to prevent Edge runtime crash
- Uses dynamic `await import()` for all OTel imports
- Initializes `NodeTracerProvider` with `LangfuseSpanProcessor`
- Logs "Instrumentation: Langfuse OTel provider registered" as smoke test

### 4. Telemetry config helper (`src/lib/ai/telemetry.ts`)
- Uses AI SDK's `TelemetrySettings` type directly (no `as any` cast)
- Exports `createTelemetryConfig({ functionId, matterId, userId? })`
- Maps `matterId` to Langfuse `sessionId` for session grouping

### 5. Test API route (`src/app/api/chat/route.ts`)
- POST handler with Zod schema validation for `messages` and `matterId`
- Returns 400 for invalid JSON or malformed requests
- Calls `streamText` with `google('gemini-2.5-flash')` and telemetry config
- Returns `result.toTextStreamResponse()` for streaming

## Deviations from Original Plan

1. **`LangfuseExporter` → `LangfuseSpanProcessor`**: The `@langfuse/otel` package no longer exports `LangfuseExporter`. `LangfuseSpanProcessor` is the current API and acts as both processor and exporter.
2. **`toDataStreamResponse()` → `toTextStreamResponse()`**: Renamed in AI SDK v6.
3. **`ai` v4 → v6**: Implementer initially installed v4; upgraded to v6 for compatibility with `@ai-sdk/google` v3.
4. **Added Zod validation**: Not in original plan. Added per code review feedback for input validation on the chat route.
5. **Removed `as any` cast**: Used `TelemetrySettings` type from AI SDK directly instead of casting.

## Verification (completed by user)
- [x] `npm run build` passes
- [x] `npm run lint` passes (Biome clean)
- [x] Dev server shows instrumentation smoke-test log
- [x] curl test returns streamed Gemini response
- [x] Trace appears in Langfuse dashboard
