# Peek-then-Stream: Async Iterator Failover for Streaming LLM Responses

## What It Is

A pattern for implementing provider failover with streaming LLM responses. The core problem: `streamText()` from the Vercel AI SDK is lazy — it returns immediately without connecting to the provider. Errors only surface when the stream is consumed, which is after you've already returned the `Response` to the client. This makes `try/catch` failover impossible with the default approach.

The solution: read the first chunk from the stream to force the provider connection. If it fails, catch the error and try the next provider. If it succeeds, build a new `ReadableStream` from the verified first chunk plus the remaining stream.

## Why It Matters for This Project

The chat route (`src/app/api/chat/route.ts`) supports 5 LLM providers (Gemini, Groq, Mistral, Cerebras, OpenRouter) with automatic failover. Without this pattern, rate limits or auth failures on the primary provider would result in a broken response instead of silently falling back to the next provider.

## How It Works

### Step 1: `Symbol.asyncIterator` — Getting Manual Control of the Stream

```typescript
const result = streamText({ model, system, messages })
const reader = result.textStream[Symbol.asyncIterator]()
```

`result.textStream` is an `AsyncIterable<string>` — normally consumed with `for await`:

```typescript
// This consumes everything — no way to stop after one chunk
for await (const chunk of result.textStream) { ... }
```

`Symbol.asyncIterator` is a built-in JavaScript symbol. Every async iterable has this method — it returns an **iterator** with a `.next()` method that yields one value at a time:

```typescript
const reader = result.textStream[Symbol.asyncIterator]()
const first = await reader.next()   // { value: "The", done: false }
const second = await reader.next()  // { value: " first", done: false }
const last = await reader.next()    // { value: undefined, done: true }
```

`for await` is syntactic sugar for this `.next()` loop. We use the iterator directly because we need to split consumption into two phases: peek one chunk, then stream the rest.

### Step 2: Peek — Force the Provider Connection

```typescript
const firstChunk = await reader.next()
```

This is the first time the AI SDK actually calls the provider's API. If the provider is rate-limited, has bad auth, or is down, **this line throws** — inside the `try/catch` where the for loop can catch it and try the next provider.

If it succeeds, the provider is verified and we have the first chunk of real data.

### Step 3: Build a `ReadableStream` — Reassemble the Response

```typescript
const stream = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder()
    controller.enqueue(encoder.encode(firstChunk.value))
    // ... read remaining chunks
  },
})
```

**Why rebuild?** We already consumed the first chunk via `reader.next()`. The stream's internal cursor moved past it. Calling `result.toTextStreamResponse()` now would produce a response missing the first chunk. So we build the response ourselves.

**`new ReadableStream({ ... })`** — A Web API for creating a byte stream. The constructor takes a strategy object with lifecycle methods:

- `start(controller)` — called once when the stream is created
- `pull(controller)` — called when the consumer wants more data (optional)
- `cancel()` — called when the consumer cancels (optional)

**`start` is a method name, not a random function.** This is shorthand object method syntax:

```typescript
// These are identical:
{ start: async function(controller) { ... } }
{ async start(controller) { ... } }
```

**`controller`** — provided by the runtime, with methods to feed the stream:

- `controller.enqueue(data)` — push a chunk (must be `Uint8Array` for byte streams)
- `controller.close()` — signal "no more data"
- `controller.error(err)` — signal an error

**`TextEncoder`** — converts strings to `Uint8Array` because `ReadableStream` works with bytes, not strings.

### Step 4: Stream Remaining Chunks

```typescript
try {
  let next = await reader.next()
  while (!next.done) {
    controller.enqueue(encoder.encode(next.value))
    next = await reader.next()
  }
} catch (err) {
  // Mid-stream failure — can't failover, already streaming to client
  console.error(`Stream error mid-response:`, err)
} finally {
  controller.close()
}
```

This reads from the same iterator we peeked at, so it continues from chunk 2 onwards. Each chunk is encoded and pushed to the client as it arrives — that's streaming.

### Step 5: Return the Response

```typescript
return new Response(stream, {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
})
```

The client (curl, browser, etc.) receives bytes chunk by chunk as they arrive.

## Gotchas

1. **Mid-stream failures aren't recoverable.** If the provider fails after the first chunk (e.g., times out on chunk 50), we've already started sending data to the client. They get a truncated response. Only the initial connection is verified.

2. **`onFinish` may not fire.** Since we bypass `toTextStreamResponse()` and consume the stream manually, the AI SDK's `onFinish` callback may not trigger. This can affect Langfuse trace output — needs testing.

3. **First chunk delay.** The HTTP response doesn't start until the first chunk arrives. With `toTextStreamResponse()`, headers are sent immediately. Here the client waits slightly longer (typically a few hundred ms).

4. **Lost AI SDK helpers.** `toTextStreamResponse()` handles content-type headers, backpressure, and error formatting. Our manual stream is simpler and could miss edge cases.

## Full Implementation

```typescript
async function tryStreamText(providers, system, messages) {
  let lastError

  for (let i = 0; i < providers.length; i++) {
    const model = providers[i]
    try {
      const result = streamText({ model, system, messages })

      // Peek: force connection, catch provider errors
      const reader = result.textStream[Symbol.asyncIterator]()
      const firstChunk = await reader.next()
      if (firstChunk.done) throw new Error("Empty stream")

      // Stream: first chunk + remaining
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode(firstChunk.value))
          try {
            let next = await reader.next()
            while (!next.done) {
              controller.enqueue(encoder.encode(next.value))
              next = await reader.next()
            }
          } catch (err) {
            console.error("Mid-stream error:", err)
          } finally {
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    } catch (err) {
      lastError = err
      console.warn(`Provider ${i} failed, trying next:`, err)
    }
  }

  throw lastError
}
```

## References

- [MDN: ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
- [MDN: Symbol.asyncIterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/asyncIterator)
- [MDN: TextEncoder](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder)
- [Vercel AI SDK: streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- `src/app/api/chat/route.ts` — project implementation
- `project/decisions/20260406-180000-streaming-failover-pattern.md` — decision record
