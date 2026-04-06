# Decision: Peek-then-Stream Pattern for Provider Failover

**Date:** 2026-04-06
**Status:** Accepted

## Context

`streamText()` from the Vercel AI SDK is lazy — it returns immediately without connecting to the provider. Provider errors (rate limits, auth failures) only surface when the stream is consumed, which happens after the `Response` is already returned to the client. This meant the `try/catch` failover loop never caught provider failures, making automatic fallback to the next provider impossible.

## Options Considered

### 1. Peek-then-Stream (read first chunk before returning)
- **Pros:** Failover works for connection-time errors (rate limits, bad auth, network failures). Minimal latency cost (only waits for first chunk). Still streams to client. No extra API calls.
- **Cons:** Small delay before response starts (first chunk must arrive). Manual `ReadableStream` construction loses AI SDK response helpers (headers, backpressure). Mid-stream failures after the first chunk aren't recoverable. `onFinish` callback may not fire correctly since we bypass `toTextStreamResponse()`.

### 2. Use `generateText` instead of `streamText`
- **Pros:** Entire call is `await`-able, failover is trivial. Simple code.
- **Cons:** No streaming — user sees nothing until the full response is ready. Bad UX for long responses.

### 3. Provider health check before streaming
- **Pros:** Verifies provider is up before committing. Can still use `toTextStreamResponse()`.
- **Cons:** Doubles API calls and latency. Health check could pass but real call could still fail.

### 4. Accept sync-only failover
- **Pros:** Simplest code. Uses `toTextStreamResponse()` natively.
- **Cons:** Only catches config errors (missing API key). Rate limits and auth failures during connection aren't caught — failover is unreliable.

## Decision

**Option 1: Peek-then-Stream.** Read the first chunk via `result.textStream[Symbol.asyncIterator]().next()` to force the provider connection inside the `try/catch`. If it throws, the for loop catches it and tries the next provider. If it succeeds, build a `ReadableStream` from the verified first chunk plus the remaining iterator.

The cons (first-chunk delay, manual stream construction) are acceptable for a demo. The main risk is `onFinish` not firing for Langfuse tracing — needs verification.

## Resources

- `src/app/api/chat/route.ts` — implementation of the pattern
- `src/lib/ai/model.ts` — `getModelWithFallbacks()` returns the ordered provider array
- Vercel AI SDK `streamText` docs — confirms lazy evaluation behavior
- `project/decisions/20260406-140000-langfuse-telemetry-capture-pattern.md` — related decision on telemetry that depends on `onFinish`
