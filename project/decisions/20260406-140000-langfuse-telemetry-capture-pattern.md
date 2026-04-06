# Decision: Langfuse Telemetry Capture Pattern — `observe()` with `endOnExit: false`

**Date:** 2026-04-06
**Status:** Accepted

## Context

The project uses Vercel AI SDK's `streamText` with Langfuse for LLM observability. We needed to decide how to capture telemetry events (traces, input/output, session grouping) given three available approaches from `@langfuse/tracing`, and also whether trace-level I/O was necessary.

## Options Considered

### 1. `startActiveObservation` (Context Manager)

- **Pros:** Clean callback API, automatic span lifecycle management, span reference available for `span.update()`
- **Cons:** Callback-based lifecycle ends the span when the callback returns. With streaming, the callback returns immediately (when the `Response` is created), not when the stream finishes. This means `onFinish` fires after the span is already ended and exported — output is never captured. **Fundamentally incompatible with streaming.**

### 2. `observe()` wrapper with `endOnExit: false`

- **Pros:** Designed for streaming — `endOnExit: false` keeps the span open until manually ended via `trace.getActiveSpan()?.end()`. Documented in Langfuse's official Next.js streaming examples. Works with `propagateAttributes` for trace metadata.
- **Cons:** Requires manual span lifecycle management (must call `.end()` in `onFinish`/`onError`). The observation created by `observe()` gets filtered by the v5 smart default span filter, creating a phantom `parentObservationId` that doesn't exist in the trace. This is a likely bug (see `project/langfuse-bug-report.md`).

### 3. Manual `startObservation` spans

- **Pros:** Full control over span lifecycle, can set model/input/output explicitly, no callback lifecycle issues
- **Cons:** Most verbose — must manually manage span references across async boundaries, wire up parent-child relationships, and call `.end()` at the right time. More code, more room for error.

## Decision

**Option 2: `observe()` with `endOnExit: false`** — the documented pattern for streaming handlers in Langfuse.

Combined with:
- `propagateAttributes()` for trace metadata (name, sessionId, userId, tags)
- `setActiveTraceIO()` for trace-level I/O (deprecated but the only working approach — see below)
- `experimental_telemetry: { isEnabled: true }` on `streamText` for automatic AI SDK span creation
- `after(() => langfuseSpanProcessor.forceFlush())` to ensure traces flush before serverless exit

### On trace-level I/O

Modern Langfuse evaluations (LLM-as-a-judge) operate at the **observation level**, not the trace level. Trace-level I/O is only needed for legacy trace-level evaluators. The observation-level data from the AI SDK (model, input, output, tokens, cost, latency) is complete and sufficient for all modern evaluation workflows.

The documented non-deprecated approach for trace-level I/O (setting input/output on the root observation) doesn't work because the `observe()` span is filtered by the v5 smart default span filter. `setActiveTraceIO()` is the only working approach, despite being deprecated. A bug report has been drafted at `project/langfuse-bug-report.md`.

## Resources

- [Langfuse Vercel AI SDK Integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk) — official docs showing `observe` + `endOnExit: false` pattern
- [Langfuse JS v4→v5 Migration Guide](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5) — documents `setActiveTraceIO` deprecation and smart default span filter
- [Langfuse Model-Based Evals](https://langfuse.com/docs/scores/model-based-evals) — confirms observation-level evaluators are the modern standard
- [Langfuse Get Started](https://langfuse.com/docs/observability/get-started) — shows `startActiveObservation` and `observe` patterns
- `project/langfuse-bug-report.md` — drafted bug report for the span filter issue
- `notes.md` — conversation log with Langfuse bot confirming the phantom parent issue
