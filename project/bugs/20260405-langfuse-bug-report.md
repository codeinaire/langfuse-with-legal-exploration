https://github.com/langfuse/langfuse/issues/12984

# Bug Report: `startActiveObservation` / `observe` spans filtered by v5 smart default filter, preventing trace-level I/O via root observation

## Summary

When using `startActiveObservation()` or `observe()` from `@langfuse/tracing` to create a root observation and set input/output on it, the span is filtered out by the v5 smart default span filter in `LangfuseSpanProcessor`. This creates a broken parent-child chain where child observations (from Vercel AI SDK) reference a `parentObservationId` that doesn't exist in the trace.

The docs recommend setting input/output on the root observation instead of using the deprecated `setActiveTraceIO()`, but this approach doesn't work because the root observation gets filtered before it reaches Langfuse.

## Environment

- `@langfuse/otel`: 5.0.1
- `@langfuse/tracing`: 5.0.1
- `@opentelemetry/sdk-trace-node`: 2.x
- `ai` (Vercel AI SDK): 6.0.141
- `@ai-sdk/google`: 3.0.54
- Next.js: 16.2.1
- Node.js: 24.14.0

## Steps to Reproduce

### 1. Setup instrumentation.ts

```typescript
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com',
})

export async function register() {
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [langfuseSpanProcessor],
  })
  tracerProvider.register()
}
```

### 2. Create a route using the documented pattern

```typescript
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { streamText } from 'ai'
import { google } from '@ai-sdk/google'

export const POST = async (req: Request) => {
  const { messages } = await req.json()

  return propagateAttributes(
    {
      traceName: 'matter-chat',
      sessionId: 'test-session',
      userId: 'demo-user',
    },
    async () => {
      return await startActiveObservation('chat-handler', async (span) => {
        // Set input on the root observation (as recommended by docs)
        span.update({ input: { messages } })

        const result = streamText({
          model: google('gemini-2.5-flash'),
          messages,
          experimental_telemetry: { isEnabled: true },
          onFinish: ({ text }) => {
            span.update({ output: text })
          },
        })

        return result.toTextStreamResponse()
      })
    },
  )
}
```

### 3. Send a request and inspect the trace

## Expected Behavior

- The `chat-handler` span should appear as the root observation
- `span.update({ input })` and `span.update({ output })` should populate that observation's I/O
- Trace-level I/O should be derived from this root observation (per the v4→v5 migration guide)

## Actual Behavior

The `chat-handler` span created by `startActiveObservation` is **filtered out** by the smart default span filter. The trace shows:

```json
{
  "trace": {
    "input": null,
    "output": null,
    "observations": [
      {
        "id": "94c48e15915f7ea4",
        "name": "handle-chat-message",
        "parentObservationId": "c9b5ce2757b5286a" // <-- DOES NOT EXIST
      },
      {
        "id": "c91cd5990ffec8af",
        "name": "ai.streamText",
        "parentObservationId": "94c48e15915f7ea4"
      },
      {
        "id": "d8ab9e3ca45022e6",
        "name": "ai.streamText.doStream",
        "parentObservationId": "c91cd5990ffec8af"
      }
    ]
  }
}
```

The parent `c9b5ce2757b5286a` doesn't exist in the observations — it was filtered. This means:

- No observation is the true root (all have a `parentObservationId`)
- Trace I/O remains null because there's no root observation to derive it from
- The input/output set via `span.update()` is lost because the span was dropped

## Root Cause Analysis

The v5 smart default span filter (documented in the [v4→v5 migration guide](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)) only exports spans that:

- Were created by `langfuse-sdk` instrumentation scope
- Have `gen_ai.*` attributes
- Match known LLM instrumentation prefixes

Spans created by `startActiveObservation()` and `observe()` from `@langfuse/tracing` appear to match the `langfuse-sdk` scope, but are still being filtered. Meanwhile, their child spans from the Vercel AI SDK (scope `ai`) ARE exported, creating orphaned parent references.

## Workaround

Using the deprecated `setActiveTraceIO()` works — it sets trace-level I/O directly without relying on the root observation:

```typescript
import { setActiveTraceIO } from '@langfuse/tracing'

setActiveTraceIO({ input: { messages } })
// ... streamText call ...
onFinish: ({ text }) => {
  setActiveTraceIO({ output: text })
}
```

This works but contradicts the v4→v5 migration guide which says to use root observation I/O instead.

## Impact

The documented non-deprecated approach for setting trace-level I/O (via root observation) doesn't work with the Vercel AI SDK integration due to the span filter. Users are forced to use the deprecated `setActiveTraceIO()` or accept null trace I/O.

## Suggested Fix

Either:

1. Ensure spans created by `startActiveObservation()` / `observe()` from `@langfuse/tracing` are never filtered by the smart default filter
2. Or document that `setActiveTraceIO()` is the correct approach when using the Vercel AI SDK OTel bridge, and remove the deprecation warning for this use case
