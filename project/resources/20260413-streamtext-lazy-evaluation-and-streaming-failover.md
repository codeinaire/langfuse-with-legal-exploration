# Why `streamText()` Is Lazy and What It Means for Failover

## The Problem

When building a multi-provider LLM failover chain, the natural approach is a try/catch loop:

```typescript
for (const model of models) {
  try {
    const result = streamText({ model, messages, ... })
    return result.toUIMessageStreamResponse()
  } catch (err) {
    console.warn(`Provider failed, trying next...`)
  }
}
```

This **does not work** for streaming errors. The catch block only fires for synchronous failures (e.g., missing API key at construction time). If the provider accepts the connection but errors during generation, the catch never sees it.

## Why: The Async Pipeline Architecture

The Vercel AI SDK's `streamText()` uses a fire-and-forget async pattern inside a synchronous constructor. The provider HTTP request is initiated eagerly, but its results (and errors) flow through a stream pipeline — never as exceptions. Here's the full timeline, verified from the AI SDK v6 source:

### Step 1: `streamText()` creates a `DefaultStreamTextResult` (synchronous)

```typescript
const result = streamText({ model, messages, tools, ... })
```

`streamText()` is a **synchronous function** (not async). It calls `new DefaultStreamTextResult(...)` and returns it. No HTTP request to the provider has been made. The result object is a wrapper around a stream pipeline — not a response, not a promise, just plumbing.

### Step 2: The constructor starts a fire-and-forget async process

Inside the `DefaultStreamTextResult` constructor:

1. A `stitchableStream` is created (a stream that sub-streams can be added to later)
2. A `ReadableStream` with a `pull()` callback is created — it reads from the stitchable stream
3. `TransformStream` pipelines are set up for processing chunks (telemetry, callbacks, etc.)
4. All of this is wired together as `this.baseStream`

Then, at the end of the constructor:

```javascript
// Still inside the constructor (which is NOT async)
recordSpan({
  fn: async (rootSpan) => {
    await standardizePrompt(...)         // First await — constructor returns here
    await retry(() => model.doStream())  // ← THE ACTUAL HTTP REQUEST TO THE PROVIDER
    this.addStream(providerStream)       // Feed provider data into the pipeline
  }
})
// Constructor returns — the async fn continues on the microtask queue
```

`recordSpan` calls the async `fn` immediately, but since the constructor is not async, it can't await the result. The async function runs until its first `await`, then suspends. The constructor finishes, `streamText()` returns.

The async function resumes on the **microtask queue** and calls `model.doStream()` — this is where the HTTP request to the provider (e.g., `generativelanguage.googleapis.com`) is actually made. The provider's response stream is then fed into the `stitchableStream` via `addStream`.

### Step 3: `toUIMessageStreamResponse()` wraps the pipeline in a Response (synchronous)

```typescript
const response = result.toUIMessageStreamResponse(options)
```

This creates a standard Web API `Response` object. The HTTP status (`200`) and headers (`Content-Type: text/event-stream`) are set **immediately**. The body is the `baseStream` pipeline from Step 2. No data has flowed through the pipeline yet — the stitchable stream is still empty, waiting for the fire-and-forget async to feed it.

### Step 4: The Response is returned to Next.js

```typescript
return response  // 200 OK, headers sent to client
```

Next.js sends the HTTP status line and headers to the client. The `200` status code is **committed** — it cannot be changed.

### Step 5: Data flows through the pipeline

By now, the fire-and-forget async from Step 2 has likely called `model.doStream()` and is feeding the provider's response into the stitchable stream. The client (via `useChat` / `DefaultChatTransport`) starts reading the Response body, which triggers `pull()` on the `ReadableStream`. `pull()` reads from the stitchable stream, which now has data from the provider.

### Step 6: If the provider errors, it's too late

The error from `model.doStream()` is caught inside the fire-and-forget async function and piped into the stitchable stream as an error event. It flows through the pipeline, reaches `pull()`, and is embedded in the SSE stream. The `try/catch` in the route handler finished at Step 4. The 200 status was already sent.

```
Timeline:
─────────────────────────────────────────────────────────────────
Server handler: streamText() → toResponse() → return 200
                ↑ try/catch    (sync)          ↑ handler done
─────────────────────────────────────────────────────────────────
Microtask queue:       standardizePrompt() → model.doStream()
                       (fire-and-forget)      ↑ HTTP request
                                                to provider
─────────────────────────────────────────────────────────────────
Stream pipeline:                                    data/error
                                                    flows here
                                                        ↓
Client (useChat):                                   pull() reads
─────────────────────────────────────────────────────────────────
```

### Key distinction

`pull()` does **not** trigger the provider call — the fire-and-forget async in the constructor does. `pull()` just reads whatever the provider has sent through the pipeline. The provider call is initiated eagerly on the microtask queue, but its results and errors are delivered through the stream, never as exceptions that a `try/catch` could intercept.

## Consequence: Server-Side Failover Loops Are Dead Code

The for loop iterates exactly **once**: `streamText()` succeeds (lazy), `toUIMessageStreamResponse()` succeeds (lazy), `return` exits the function. The remaining providers are never tried. The catch block is only reached for synchronous errors like a missing API key or invalid model ID.

## Solution: Client-Side Retry with Model Index

Since the server can't detect streaming errors before returning the Response, the retry must happen on the client:

### Client Side

```typescript
const modelIndexRef = useRef(0)

// body is a function (Resolvable<object>) — called fresh on every request
const transport = useMemo(
  () =>
    new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ matterId, modelIndex: modelIndexRef.current }),
    }),
  [matterId],
)

const { status, regenerate } = useChat<ChatMessage>({ transport })

// When the stream errors, increment modelIndex and regenerate
useEffect(() => {
  if (status !== "error") return

  if (retryCountRef.current < MAX_RETRIES) {
    retryCountRef.current++
    modelIndexRef.current++
    regenerate()  // re-sends with the new modelIndex
  }
}, [status, regenerate])
```

### Server Side

```typescript
const { messages, matterId, modelIndex } = parsed.data
const models = getModelWithFallbacks()
const model = models[modelIndex % models.length]

return streamWithModel(model, systemPrompt, modelMessages, agentContext, traceId)
```

The server is stateless — the client tracks which model to try next. On each retry, `regenerate()` re-sends the request with an incremented `modelIndex`. The user sees nothing during retries (just "Agent is thinking..." until it succeeds or retries are exhausted).

### Key Detail: `Resolvable<T>` in the AI SDK

The `body` option on `DefaultChatTransport` accepts `Resolvable<object>`, which is defined as:

```typescript
type Resolvable<T> = MaybePromiseLike<T> | (() => MaybePromiseLike<T>)
```

This means `body` can be a **function** that's called on every request. By passing `() => ({ modelIndex: ref.current })`, each retry reads the latest ref value without needing to recreate the transport.

## Alternative: Peek-Then-Stream (Server-Side)

It is possible to detect errors server-side by consuming the first chunk of the stream before returning the Response:

```typescript
const response = result.toUIMessageStreamResponse(options)
const reader = response.body.getReader()
const firstChunk = await reader.read()  // Forces the provider connection

// If we get here, the provider is working.
// Reconstruct a Response that replays the peeked chunk + rest of stream.
return new Response(
  new ReadableStream({
    start(controller) { controller.enqueue(firstChunk.value) },
    async pull(controller) {
      const { value, done } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
  }),
  { headers: response.headers, status: response.status },
)
```

This works but requires reconstructing a `ReadableStream` to replay the peeked chunk, which adds complexity.

## References

- [Vercel AI SDK `streamText` docs](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [Web Streams API — ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
- Project files:
  - `src/app/api/chat/route.ts` — server-side route with model selection
  - `src/components/chat/ChatPanel.tsx` — client-side retry logic
  - `src/lib/ai/model.ts` — `getModelWithFallbacks()` provider chain
