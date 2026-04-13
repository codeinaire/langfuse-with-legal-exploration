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

## Why: The Lazy Evaluation Chain

The Vercel AI SDK's `streamText()` uses lazy evaluation — it defers the actual provider API call until the client starts consuming the response stream. Here's the full timeline:

### Step 1: `streamText()` returns synchronously

```typescript
const result = streamText({ model, messages, tools, ... })
```

This does **not** call the Gemini/Groq/etc API. It returns a `StreamTextResult` object that describes what to do (model, messages, tools) but hasn't executed anything. Like creating a database query object without running it.

### Step 2: `toUIMessageStreamResponse()` creates a Response with a lazy body

```typescript
const response = result.toUIMessageStreamResponse(options)
```

This creates a standard Web API `Response` object. The HTTP status (`200`) and headers (`Content-Type: text/event-stream`) are set **immediately**. But the body is a `ReadableStream` — a stream that produces data on demand via an internal `pull()` callback. No data has been produced yet.

### Step 3: The Response is returned to Next.js

```typescript
return response  // 200 OK, headers sent to client
```

Next.js sends the HTTP status line and headers to the client over the wire. The `200` status code is now **committed** — it cannot be changed.

### Step 4: The client starts reading the body

The browser (via `useChat` / `DefaultChatTransport`) reads the response body. This triggers the `ReadableStream`'s internal `pull()` function. **Only now** does the AI SDK make the actual HTTP request to the provider's API (e.g., `generativelanguage.googleapis.com`).

### Step 5: If the provider errors, it's too late

The error surfaces inside `pull()` — deep inside the ReadableStream, after the 200 was already sent. It gets embedded in the SSE stream as an error event. The `try/catch` in the route handler finished at Step 3, so it never sees this error.

```
Timeline:
──────────────────────────────────────────────────────────
Server handler:   streamText() → toResponse() → return 200
                  ↑ try/catch is here                    ↑ handler is done
──────────────────────────────────────────────────────────
Actual API call:                                            ← happens here
                                                            (inside the stream)
──────────────────────────────────────────────────────────
```

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
