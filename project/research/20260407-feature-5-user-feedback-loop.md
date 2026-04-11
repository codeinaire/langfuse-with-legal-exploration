# Feature #5: User Feedback Loop (Thumbs Up/Down + Langfuse Scores) - Research

**Researched:** 2026-04-07
**Domain:** Langfuse scoring SDK, AI SDK v6 UIMessage metadata propagation, OTel trace ID capture, React feedback UX
**Confidence:** HIGH (local node_modules verification) / MEDIUM (external docs unverifiable in this session -- see Sources)

## Summary

Feature #5 closes the AI feedback loop: users press thumbs up or down on an assistant message, the client POSTs `{ traceId, score }` to a new `/api/feedback` route, and the backend attaches the score to the corresponding Langfuse trace. The hard part is not the scoring API -- it is propagating the **Langfuse trace ID** from the streaming backend response back to the client so the client knows which trace to score.

Three wiring decisions dominate the design space, and each has a clear answer once you look at the installed SDK surface:

1. **Langfuse scoring SDK.** `@langfuse/tracing` (what the project already uses) does NOT export a score creation function -- it is purely an instrumentation/OTel package. Score creation lives on `LangfuseAPIClient.legacy.scoreV1.create()` in the `@langfuse/core` package, which is installed transitively as a dep of `@langfuse/tracing`. The modern, ergonomic wrapper is `@langfuse/client` (a sibling package in the langfuse-js monorepo), which should be added as a direct dependency. Both paths hit the same `POST /api/public/scores` endpoint; `@langfuse/client` just gives it a nicer surface.
2. **Trace ID propagation.** AI SDK v6's `toUIMessageStreamResponse()` supports a `messageMetadata` callback that attaches arbitrary typed metadata to the streamed `start` / `finish` chunks. The client (`useChat` + `DefaultChatTransport`) exposes that metadata on `message.metadata`. **This is the cleanest path**. A custom HTTP header (Option A in the roadmap) is NOT viable with the default transport because `HttpChatTransport.sendMessages()` discards response headers -- the only way to surface them would be a custom `fetch` implementation. A polling endpoint (Option C) has race conditions and is dominated by Option B on every axis.
3. **Capturing the active trace ID on the server.** `@langfuse/tracing` exports `getActiveTraceId()` -- this is literally `trace.getActiveSpan()?.spanContext().traceId`. Both are equivalent; prefer `getActiveTraceId()` for intent. Because the Vercel AI SDK stream transforms run lazily (after the route handler returns), the `messageMetadata` callback fires **outside** the `observe()` context. The fix is simple: capture the trace ID **synchronously** inside the `observe()` block, before calling `streamText`, and close over it in the callback.

Zero additional *runtime* dependencies are strictly required (everything can be done with installed packages plus `@langfuse/core`'s `LangfuseAPIClient`). Adding `@langfuse/client` is recommended for a cleaner API and forward-compat with Langfuse's documented v5 patterns -- it is a pure addition, not a replacement, for the existing `@langfuse/tracing` + `@langfuse/otel` setup.

**Primary recommendation:** (1) Add `@langfuse/client` as a direct dependency. (2) Use Option B -- `messageMetadata` callback on `toUIMessageStreamResponse()` -- to attach `{ langfuseTraceId }` to each streamed message. (3) Capture the trace ID with `getActiveTraceId()` synchronously inside the existing `propagateAttributes()` callback, before `streamText` is called. (4) Create `/api/feedback/route.ts` that calls `langfuseClient.legacy.scoreV1.create({ traceId, name: "user-feedback", value, dataType: "BOOLEAN" })` (or equivalent on `@langfuse/client`'s ergonomic surface). (5) Render subtle inline-SVG thumbs buttons on assistant messages that have at least one non-empty text part, with per-message `idle | submitting | submitted` state tracked in a `Map<messageId, FeedbackState>` in the `ChatPanel` parent.

## Standard Stack

### Core

| Library | Version | Purpose | License | Maintained? | Why Standard |
| ------- | ------- | ------- | ------- | ----------- | ------------ |
| `@langfuse/client` | ^5.0.2 (needs install) | Ergonomic Langfuse HTTP API client (scores, sessions, traces) | MIT | Yes (monorepo) | Official v5 client for universal JS, matches `@langfuse/tracing` major |
| `@langfuse/tracing` | ^5.0.2 (installed) | `getActiveTraceId()` to capture trace id on server | MIT | Yes (active) | Already installed; source of truth for active trace ID |
| `ai` | 6.0.146 (installed) | `toUIMessageStreamResponse({ messageMetadata })`, `UIMessage<METADATA>` generic | Apache-2.0 | Yes (daily releases) | Already installed; core streaming pipeline |
| `@ai-sdk/react` | 3.0.148 (installed) | `useChat<MESSAGE>` with typed metadata | Apache-2.0 | Yes | Already installed; exposes `message.metadata` typed as the generic |
| `zod` | 4.3.6 (installed) | POST body validation for `/api/feedback` | MIT | Yes | Already installed; matches project validation pattern |

### Supporting

| Library | Version | Purpose | When to Use |
| ------- | ------- | ------- | ----------- |
| `@langfuse/core` | ^5.0.2 (transitive) | Fallback path: `new LangfuseAPIClient().legacy.scoreV1.create()` | Only if you don't want to add `@langfuse/client` as a direct dep; already on disk |
| `@opentelemetry/api` | ^1.9.0 (peer) | Alternative to `getActiveTraceId()`: `trace.getActiveSpan()?.spanContext().traceId` | Equivalent; both work identically |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
| ---------- | --------- | -------- |
| `@langfuse/client` | `@langfuse/core` `LangfuseAPIClient` directly | Core is a transitive dep so zero package.json change, but the client wrapper is the documented path and may hide breaking changes in core |
| `@langfuse/client.legacy.scoreV1.create()` | `client.ingestion.batch([{ type: "score-create", body: {...} }])` | Ingestion is ALSO marked "legacy" in the Fern-generated client (the note refers to trace/span ingestion, use OTel instead). For scores there's no non-legacy alternative. `scoreV1.create()` is the simpler single-purpose API. |
| Deterministic trace IDs via `createTraceId(seed)` | Seed the trace ID client-side with a hash of matterId+msgId, pass as parentSpanContext to `observe()` | Avoids all metadata propagation entirely -- client already knows the ID. But requires restructuring `observe()` to accept `parentSpanContext`, and the trace ID is then not a native OTel-generated ID. Higher architectural churn for the same end result. Keep as a backup if messageMetadata proves unreliable. |
| `messageMetadata` callback (Option B) | Custom HTTP response header (Option A) | Option A is unusable with `DefaultChatTransport` because it discards `response.headers` after reading the body. Would require a custom `fetch` implementation. Option B is 1 line on the server + 1 line on the client. |
| `messageMetadata` callback | Dedicated `/api/latest-trace-id?messageId=X` (Option C) | Race condition (what if the trace isn't committed yet? what if there are multiple in flight?), extra round trip, extra endpoint. Strictly worse than Option B. |

**Installation:**

```bash
npm install @langfuse/client@^5.0.2
```

(No other new dependencies. `@opentelemetry/api` is already pulled in transitively by `@langfuse/tracing`'s peer dep.)

## Architecture Options

### Option A -- Custom response header on the stream Response

Set `headers: { "X-Langfuse-Trace-Id": traceId }` in the object passed to `result.toUIMessageStreamResponse({ headers: {...} })`. Server-side this is trivial. Client-side it requires reading `Response.headers` after the fetch completes.

**Verdict: NOT VIABLE with `DefaultChatTransport`.** Verified in `node_modules/ai/dist/index.mjs` (`HttpChatTransport.sendMessages`, around line 12778). After calling `fetch()`, the transport calls `this.processResponseStream(response.body)` and returns the stream directly -- the `Response` object and its `headers` are not exposed to the caller. The only way to salvage Option A is to pass a custom `fetch` function to the transport that captures the headers into a side channel (a module-level `Map<chatId, traceId>` or a React ref). This is possible but substantially more code than Option B, and it introduces a side channel that is easy to get wrong (race conditions across concurrent chats, cleanup, SSR hydration).

### Option B -- `messageMetadata` callback on `toUIMessageStreamResponse()` (RECOMMENDED)

Verified in `node_modules/ai/dist/index.d.ts` line 2347:

```ts
type UIMessageStreamOptions<UI_MESSAGE extends UIMessage> = {
  // ...
  messageMetadata?: (options: {
    part: TextStreamPart<ToolSet>;
  }) => InferUIMessageMetadata<UI_MESSAGE> | undefined;
  // ...
}
```

Verified in `node_modules/ai/dist/index.mjs` lines 7788-7800, 7981-7998: the callback is called for **every** part; any non-null return is attached to `start` / `finish` chunks and also emitted as a standalone `message-metadata` chunk. The client assembles these into `message.metadata` on the `UIMessage`.

The `UIMessage` type is generic over metadata: `interface UIMessage<METADATA = unknown, ...> { metadata?: METADATA; parts: ... }` (line 1659). Pass your custom type to `useChat<MyMessage>()` and `message.metadata` is typed.

**Verdict: RECOMMENDED.** Clean, type-safe, idiomatic AI SDK v6, no side channels.

### Option C -- Separate `/api/trace-id?chatId=...&messageId=...` endpoint

Poll or fetch the trace ID after the assistant message finishes streaming. Requires a server-side map of `(chatId, messageId) -> traceId` that's written on stream end and read on request. Race conditions: the map might not be written yet; concurrent chats can collide; a serverless instance that wrote it may not be the one that reads it. Additional endpoint, additional state, additional round trip, strictly worse UX.

**Verdict: AVOID.**

### Summary table

| Option | Description | Pros | Cons | Best When |
| ------ | ----------- | ---- | ---- | --------- |
| A | Response header | 1 line of server code; familiar pattern | Default transport hides response headers; needs custom fetch side channel | You control a custom transport already and want to minimize wire protocol changes |
| **B** | `messageMetadata` callback | Idiomatic AI SDK v6; type-safe via generics; client exposes `message.metadata` natively | Metadata reaches client only on `start` chunk, so client must wait until streaming has begun (not a problem in practice) | **Default choice for AI SDK v6 + useChat** |
| C | Polling endpoint | No stream format change | Race conditions; extra round trip; extra endpoint; stateful server map | Only if the streaming response is fully opaque (not the case here) |

**Recommended:** **Option B.**

### Counterarguments

Why someone might NOT choose Option B:

- **"The `messageMetadata` callback runs outside the OTel context and `getActiveTraceId()` returns undefined."** This is a real concern. AI SDK v6's `TransformStream` runs lazily as the client consumes the stream, typically *after* the route handler has returned -- at which point the `observe()` block's OTel context is no longer active on the current execution. **Response:** Capture the trace ID **synchronously inside `observe()`** before calling `streamText`, bind it to a `const`, and close over it in the `messageMetadata` callback. The callback then reads from closure, not from OTel context. Verified approach -- see Code Examples below.

- **"What if `getActiveTraceId()` returns undefined synchronously too, e.g., if the observe() wrapping broke?"** Defensive programming: treat undefined as a soft error. Render the thumbs buttons in a disabled state (with a tooltip "Trace ID unavailable") so the rest of the chat still works. Log a warning server-side so you notice during development. Don't throw -- the feature is a nice-to-have, not a blocker.

- **"The callback fires on every part -- doesn't that re-emit the traceId constantly?"** Yes, the transform emits it to every non-`start`/`finish` part as a `message-metadata` chunk (line 8016-8021). This is harmless (the client merges metadata) but wasteful in wire bytes. Guard the callback: `return part.type === "start" ? { langfuseTraceId } : undefined` -- returning `undefined` skips the metadata chunk entirely. See Code Examples.

- **"What about a session-level score instead of a per-message score?"** `createScoreRequest` accepts `sessionId` instead of (or alongside) `traceId`. The project's current setup passes `sessionId: matterId` via `propagateAttributes()`, so Langfuse already groups traces by matter. You could score the whole session instead. **Response:** Per-trace scoring is higher signal -- it lets you see "which specific AI response did the user like" vs. just "which matters had good UX overall". Trace-scoped is the roadmap intent and the more useful production pattern.

## Architecture Patterns

### Recommended Project Structure

```
src/
  app/
    api/
      chat/
        route.ts          # existing -- add `messageMetadata` callback + traceId capture
      feedback/
        route.ts          # NEW -- POST /api/feedback handler
  components/
    chat/
      message.tsx         # existing -- add <FeedbackButtons> to assistant text messages
      chat-panel.tsx      # existing -- add `feedbackState` Map + handleFeedback to useChat
      feedback-buttons.tsx # NEW -- thumbs up/down SVG buttons with state
  lib/
    langfuse/
      client.ts           # NEW -- singleton LangfuseClient instance for score calls
  types/
    chat.ts               # NEW -- `ChatMessage = UIMessage<{ langfuseTraceId?: string }>`
```

### Pattern 1: Typed chat message with Langfuse metadata

Define the message type once, use it everywhere.

```ts
// src/types/chat.ts
import type { UIMessage } from "ai"

export type ChatMessageMetadata = {
  langfuseTraceId?: string
}

export type ChatMessage = UIMessage<ChatMessageMetadata>
```

Then `useChat<ChatMessage>({ ... })` and `message.metadata?.langfuseTraceId` is typed.

Optionally add runtime validation on the client via the `messageMetadataSchema` option to `useChat` (a `FlexibleSchema<ChatMessageMetadata>`), which the SDK validates before accepting the metadata from the stream. For a demo, type-only is probably enough; for production, add the schema.

### Pattern 2: Capture trace ID synchronously, close over it in the callback

**The crucial move** -- do NOT rely on the OTel context being active when `messageMetadata` fires. Capture the ID inside `observe()` where context is guaranteed active, then close over it.

```ts
// src/app/api/chat/route.ts (modified excerpt)
import { getActiveTraceId, /* existing imports */ } from "@langfuse/tracing"

async function tryStreamText(
  modelProviders: LanguageModelV3[],
  system: string,
  uiMessages: UIMessage[],
  agentContext: { matterId: string; db: typeof db },
) {
  // ... existing loop setup ...
  for (let index = 0; index < numberOfProviders; index++) {
    const model = modelProviders[index]
    // Capture synchronously while OTel context is active
    const traceId = getActiveTraceId()

    try {
      const result = streamText({
        model,
        system,
        messages: modelMessages,
        tools: conveyancingTools,
        stopWhen: stepCountIs(5),
        experimental_context: agentContext,
        experimental_telemetry: { isEnabled: true },
        onFinish: ({ text }) => {
          updateActiveObservation({ output: text })
          setActiveTraceIO({ output: text })
          trace.getActiveSpan()?.end()
        },
      })

      after(async () => await langfuseSpanProcessor.forceFlush())

      return result.toUIMessageStreamResponse<ChatMessage>({
        messageMetadata: ({ part }) => {
          // Only emit on `start` -- metadata is attached to the message,
          // not to every part, and emitting on non-start/finish parts
          // creates extra `message-metadata` wire chunks (see index.mjs 8016).
          if (part.type === "start" && traceId) {
            return { langfuseTraceId: traceId }
          }
          return undefined
        },
      })
    } catch (err) {
      // ... existing fallback ...
    }
  }
  throw lastError
}
```

### Pattern 3: Langfuse client singleton

Avoid constructing a new client per request.

```ts
// src/lib/langfuse/client.ts
import { LangfuseClient } from "@langfuse/client"

// Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASEURL from env.
// Export a singleton -- constructing is cheap but cached is cleaner.
export const langfuseClient = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
})
```

**Note:** The exact constructor shape of `@langfuse/client` is documented (Langfuse v5 JS docs) but could not be verified from local node_modules in this session because the package is not installed. The constructor **likely** takes `{ publicKey, secretKey, baseUrl }` matching the `LangfuseSpanProcessor` constructor in `src/instrumentation.ts`, but **verify against the package's README at implementation time** -- I have HIGH confidence that the fallback (`@langfuse/core`'s `LangfuseAPIClient`) works, and MEDIUM confidence on `@langfuse/client`'s exact API. See "Open Questions" section.

### Pattern 4: Verified fallback using `@langfuse/core` (no new dependency)

If `@langfuse/client` surprises you at implementation time, this path is 100% verified from local node_modules:

```ts
// src/lib/langfuse/client.ts (fallback -- uses transitive @langfuse/core)
import { LangfuseAPIClient } from "@langfuse/core"

export const langfuseApiClient = new LangfuseAPIClient({
  environment: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
  // LangfuseAPIClient uses HTTP Basic auth with (username, password)
  // where public key = username and secret key = password.
  username: process.env.LANGFUSE_PUBLIC_KEY,
  password: process.env.LANGFUSE_SECRET_KEY,
})

// Usage:
await langfuseApiClient.legacy.scoreV1.create({
  traceId,
  name: "user-feedback",
  value: score === 1 ? 1 : 0,
  dataType: "BOOLEAN",
  comment,
})
```

Verified from `node_modules/@langfuse/core/dist/index.mjs` line 5650-5681: this posts to `POST /api/public/scores` with `Authorization: Basic base64(publicKey:secretKey)`. The call returns `CreateScoreResponse { id: string }`.

Note: the "legacy" namespace refers to the Fern-generated client structure, NOT to the endpoint being deprecated. `/api/public/scores` POST is the documented Langfuse scores-create endpoint. The `Scores` class (non-legacy, at `client.scores`) is read-only (`getMany`, `getById`).

### Pattern 5: Feedback API route with Zod validation

```ts
// src/app/api/feedback/route.ts
import { after } from "next/server"
import { z } from "zod"
import { langfuseClient } from "@/lib/langfuse/client"

// Accept either boolean score (-1 | 1) or future categorical extensions.
const feedbackRequestSchema = z.object({
  traceId: z
    .string()
    .regex(/^[a-f0-9]{32}$/, "traceId must be a 32-char hex OTel trace ID"),
  score: z.union([z.literal(-1), z.literal(1)]),
  comment: z.string().max(500).optional(),
  messageId: z.string().min(1).optional(), // for debugging / log correlation
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  const parsed = feedbackRequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(parsed.error.issues[0].message, { status: 400 })
  }

  const { traceId, score, comment } = parsed.data

  // Respond immediately; submit the score after the response is flushed.
  // `after()` keeps the serverless function alive until the callback completes.
  after(async () => {
    try {
      await langfuseClient.legacy.scoreV1.create({
        traceId,
        name: "user-feedback",
        value: score === 1 ? 1 : 0, // Boolean score: 1 = true, 0 = false
        dataType: "BOOLEAN",
        comment,
      })
    } catch (err) {
      console.error(
        "Failed to submit Langfuse score:",
        err instanceof Error ? err.message : String(err),
      )
    }
  })

  return Response.json({ ok: true })
}
```

**Why `after()` for the score call:** the score HTTP POST can take 200-800ms round trip to `cloud.langfuse.com`. Wrapping in `after()` returns the feedback response instantly to the user (button transitions to "submitted" immediately) while the Langfuse request completes in the background. If it fails, the user doesn't see an error -- acceptable for a low-stakes telemetry event. Log the failure server-side so you catch misconfigurations in Langfuse during development.

**Why BOOLEAN instead of NUMERIC:** Langfuse treats BOOLEAN scores specially -- they render as thumbs up/down icons in the UI and aggregate as percentages, which is exactly the user intent. NUMERIC would render as "0.0" / "1.0" and require an aggregation config. CATEGORICAL would work but adds a config requirement for the category mapping. Stick with BOOLEAN.

### Pattern 6: Feedback button component

```tsx
// src/components/chat/feedback-buttons.tsx
"use client"

type FeedbackStatus = "idle" | "submitting" | "submitted-up" | "submitted-down" | "error"

interface FeedbackButtonsProps {
  status: FeedbackStatus
  onSubmit: (score: -1 | 1) => void
  disabled?: boolean
}

export function FeedbackButtons({
  status,
  onSubmit,
  disabled,
}: FeedbackButtonsProps) {
  const isSubmitted = status === "submitted-up" || status === "submitted-down"
  const isUp = status === "submitted-up"
  const isDown = status === "submitted-down"
  const baseClass =
    "rounded p-1 text-gray-400 transition hover:text-gray-700 disabled:opacity-50"

  return (
    <div className="mt-2 flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || status === "submitting" || isSubmitted}
        onClick={() => onSubmit(1)}
        className={`${baseClass} ${isUp ? "text-green-600" : ""}`}
      >
        <svg
          className="h-4 w-4"
          fill={isUp ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <title>Helpful</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
          />
        </svg>
      </button>
      <button
        type="button"
        disabled={disabled || status === "submitting" || isSubmitted}
        onClick={() => onSubmit(-1)}
        className={`${baseClass} ${isDown ? "text-red-600" : ""}`}
      >
        <svg
          className="h-4 w-4"
          fill={isDown ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <title>Not helpful</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
          />
        </svg>
      </button>
      {status === "error" && (
        <span className="text-xs text-red-500">Failed, try again</span>
      )}
    </div>
  )
}
```

The SVG paths are standard Heroicons outline `hand-thumb-up` / `hand-thumb-down` (same path family as the existing checkmark in `stage-progress.tsx` -- keeps icon style consistent with the rest of the app).

### Pattern 7: State management -- Map in ChatPanel parent

Keep feedback state in the parent so that scrolling the chat history and re-renders don't lose it, and so that the Message component stays presentational.

```tsx
// src/components/chat/chat-panel.tsx (additions)
import { useCallback, useState } from "react"
import type { ChatMessage } from "@/types/chat"
import { FeedbackButtons } from "./feedback-buttons"

export function ChatPanel({ matterId, pendingActionsCount }: ChatPanelProps) {
  // ... existing hooks ...

  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport,
  })

  const [feedbackState, setFeedbackState] = useState<
    Map<string, "idle" | "submitting" | "submitted-up" | "submitted-down" | "error">
  >(new Map())

  const handleFeedback = useCallback(
    async (messageId: string, traceId: string, score: -1 | 1) => {
      setFeedbackState((prev) => new Map(prev).set(messageId, "submitting"))
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traceId, score, messageId }),
        })
        if (!res.ok) throw new Error("Request failed")
        setFeedbackState((prev) =>
          new Map(prev).set(
            messageId,
            score === 1 ? "submitted-up" : "submitted-down",
          ),
        )
      } catch {
        setFeedbackState((prev) => new Map(prev).set(messageId, "error"))
      }
    },
    [],
  )

  // Pass to <Message>:
  // <Message message={message} feedbackStatus={feedbackState.get(message.id) ?? "idle"}
  //          onFeedback={(score) => {
  //            const traceId = message.metadata?.langfuseTraceId
  //            if (traceId) handleFeedback(message.id, traceId, score)
  //          }} />
```

### Pattern 8: Render buttons only on substantive assistant messages

"Substantive" means `has at least one text part with non-empty trimmed text`. Tool-call-only messages and empty messages are skipped.

```tsx
// src/components/chat/message.tsx (modification, after existing render logic)
import type { ChatMessage } from "@/types/chat"

interface MessageProps {
  message: ChatMessage
  feedbackStatus?: FeedbackStatus
  onFeedback?: (score: -1 | 1) => void
}

function hasSubstantiveText(message: ChatMessage): boolean {
  return message.parts
    .filter(isTextUIPart)
    .some((p) => p.text.trim().length > 0)
}

export function Message({ message, feedbackStatus, onFeedback }: MessageProps) {
  const isUser = message.role === "user"
  const showFeedback =
    !isUser &&
    hasSubstantiveText(message) &&
    message.metadata?.langfuseTraceId != null &&
    onFeedback != null

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={/* ... existing ... */}>
        {/* ... existing parts rendering ... */}
        {showFeedback && (
          <FeedbackButtons
            status={feedbackStatus ?? "idle"}
            onSubmit={onFeedback}
          />
        )}
      </div>
    </div>
  )
}
```

### Anti-Patterns to Avoid

- **Reading `getActiveTraceId()` inside the `messageMetadata` callback.** The callback runs after the route handler returns, in a stream transform, where the OTel context is not active. `getActiveTraceId()` will return `undefined`. Always capture synchronously inside the `observe()` / `propagateAttributes()` block and close over it.
- **Emitting `messageMetadata` for every part.** The SDK treats any non-null return as a `message-metadata` chunk (index.mjs:8016). This is wire-bytes wasteful. Guard on `part.type === "start"` and return `undefined` otherwise.
- **Scoring from the client directly to Langfuse.** Never expose `LANGFUSE_SECRET_KEY` to the browser. All score submissions must go through the server-side `/api/feedback` route.
- **Using `NUMERIC` dataType for thumbs scores.** The Langfuse UI renders BOOLEAN scores as thumbs icons and aggregates them as percentages. NUMERIC shows them as decimals and is less readable.
- **Awaiting the score call before returning the feedback response.** Adds 200-800ms to the user perception. Wrap in `after()` so the response returns instantly and the score completes in the background.
- **Tracking feedback state inside the `Message` component.** Re-renders from new streaming chunks will reset local state. Keep state in `ChatPanel` keyed by `message.id`.
- **Using the Langfuse tracing package expecting `.score()` to exist on it.** `@langfuse/tracing` is pure instrumentation (span creation, attribute propagation, trace ID readout). Score submission is on `@langfuse/client` or `@langfuse/core`'s `LangfuseAPIClient`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
| ------- | ----------- | ----------- | --- |
| POST score to Langfuse | Raw `fetch` to `/api/public/scores` with Basic auth | `@langfuse/client` or `@langfuse/core`'s `LangfuseAPIClient` | The client handles auth header construction, retries (default 2), timeouts (default 60s), typed errors (`UnauthorizedError`, `NotFoundError`, etc.), and validation. All from `@langfuse/core/dist/index.mjs` line 5667. |
| Reading active trace ID | `trace.getActiveSpan()?.spanContext().traceId` (works but leaky) | `getActiveTraceId()` from `@langfuse/tracing` | Same one-liner internally, but self-documenting and future-proof if Langfuse changes the context propagation strategy. |
| Propagate trace ID in stream | Custom response header + custom fetch | `messageMetadata` callback + typed `UIMessage<METADATA>` | AI SDK v6 has native, typed support for this. Custom fetches introduce side channels and race conditions. |
| Stream protocol parsing | Write your own SSE reader | `useChat` + `DefaultChatTransport` | Already installed; handles start/finish chunks, tool parts, reconnect, abort. |

## Common Pitfalls

### Pitfall 1: `getActiveTraceId()` returns undefined inside the messageMetadata callback

**What goes wrong:** You read `getActiveTraceId()` inside the callback, see `undefined`, and conclude the Langfuse setup is broken.
**Why it happens:** The `TransformStream` transform function runs lazily as the stream is read by Next.js / the client. By then, the route handler has returned and the OTel context has been unwound.
**How to avoid:** Capture the trace ID synchronously inside `observe()`/`propagateAttributes()`, bind to a `const`, close over it in the callback. See Pattern 2.

### Pitfall 2: Score submission silently fails on auth error

**What goes wrong:** Scores don't appear in Langfuse. No errors in the browser console. The user sees the "submitted" state.
**Why it happens:** The `/api/feedback` route wraps the score call in `after()` and swallows errors to preserve UX. If `LANGFUSE_SECRET_KEY` is wrong, the `UnauthorizedError` is only visible in the server logs.
**How to avoid:** During development, throw the error up to the response at least once to catch misconfig: `NODE_ENV === "development"` ? await the call and surface errors : wrap in `after()`. Or: add a small startup health check that calls `langfuseClient.health.check()` (the `Health` resource is available via the `LangfuseAPIClient`) and logs a warning if it fails.

### Pitfall 3: Trace ID becomes available *during* streaming, not at its start

**What goes wrong:** You see `message.metadata?.langfuseTraceId` is undefined right after `sendMessage()` returns, and conclude Option B is broken.
**Why it happens:** The client receives the metadata on the `start` chunk of the stream -- which arrives *after* the initial fetch response, but *before* any `text-delta` chunks. There's a small window (tens of ms) after clicking Send where the metadata is not yet set.
**How to avoid:** This is fine for thumbs buttons because they only appear after `status === "ready"`. Do NOT enable the buttons during `status === "streaming"` even if you wanted to -- waiting until `ready` sidesteps the race.

### Pitfall 4: Double-scoring via click-spam

**What goes wrong:** User clicks thumbs up twice; two scores are created on the same trace.
**Why it happens:** The client-side `feedbackState` Map update happens asynchronously after fetch. Two clicks before the first fetch resolves both pass the disabled check.
**How to avoid:** Update `feedbackState` to `"submitting"` **synchronously** before calling fetch (not inside `.then`). React's auto-batching still keeps the state consistent. The `disabled` prop on the button catches the second click because React re-renders before the second `onClick` handler runs. Alternatively, Langfuse supports idempotency via `id` in `CreateScoreRequest` -- generate a deterministic score id client-side like `${messageId}-user-feedback` and Langfuse will upsert, not duplicate.

### Pitfall 5: Trace ID format mismatch

**What goes wrong:** The backend accepts the traceId string, POSTs to Langfuse, and gets a 400 or silent no-op.
**Why it happens:** OTel trace IDs are 32-char lowercase hex, e.g. `abcdef1234...`. Any other format (UUID with dashes, Base64) will fail. `createTraceId()` in `@langfuse/tracing` is the canonical generator; `getActiveTraceId()` returns the same format.
**How to avoid:** Validate in the Zod schema: `z.string().regex(/^[a-f0-9]{32}$/, "traceId must be a 32-char hex OTel trace ID")`. See Pattern 5.

### Pitfall 6: `@langfuse/client` package not installed, imports break at build time

**What goes wrong:** You add `import { LangfuseClient } from "@langfuse/client"` and the build fails.
**Why it happens:** The package is documented in sibling READMEs but not installed in this project's `node_modules`.
**How to avoid:** Run `npm install @langfuse/client@^5.0.2` BEFORE writing the import. If the package doesn't exist or has a different API than expected, fall back to Pattern 4 (`@langfuse/core`'s `LangfuseAPIClient`) which IS verified to exist. Test in a scratch file first: `import { LangfuseClient } from "@langfuse/client"; console.log(Object.keys(new LangfuseClient({...})))`.

### Pitfall 7: Substantive-message detection lets tool-call-only steps leak through

**What goes wrong:** An assistant message that only contains tool calls (no text) still shows thumbs buttons.
**Why it happens:** `message.role === "assistant"` is necessary but not sufficient. AI SDK v6 emits intermediate assistant messages (or intermediate parts in the same message) for multi-step tool calling.
**How to avoid:** Use `hasSubstantiveText(message)` as shown in Pattern 8 -- `parts.filter(isTextUIPart).some(p => p.text.trim().length > 0)`. If all parts are tool calls with empty text, hide the buttons.

## Security

### Known Vulnerabilities

| Library | CVE / Advisory | Severity | Status | Action |
| ------- | -------------- | -------- | ------ | ------ |
| `@langfuse/client` | none known | -- | -- | Add direct dep at ^5.0.2 |
| `@langfuse/tracing@5.0.2` | none known | -- | -- | Already installed |
| `@langfuse/core@5.0.2` | none known | -- | -- | Transitive dep |
| `ai@6.0.146` | none known | -- | -- | Already installed |

No known CVEs or advisories found for recommended libraries as of 2026-04-07, based on local installed versions. External CVE databases not directly queryable in this research session -- flag for a quick `npm audit` check before implementation.

### Architectural Security Risks

| Risk | Affected Architecture Options | How It Manifests | Secure Pattern | Anti-Pattern to Avoid |
| ---- | ---------------------------- | ---------------- | -------------- | --------------------- |
| **Secret key leak via client** | Any option that puts `LANGFUSE_SECRET_KEY` in browser bundle | Env var prefixed with `NEXT_PUBLIC_` or hardcoded in client code; anyone can submit arbitrary scores under your project | All Langfuse API calls server-side only; env vars MUST NOT be prefixed `NEXT_PUBLIC_` | Doing `process.env.NEXT_PUBLIC_LANGFUSE_SECRET_KEY` or calling `client.legacy.scoreV1.create()` from a `"use client"` component |
| **Trace ID spoofing** | Option B with no server validation | Client can send any 32-char hex string as traceId; they submit fake scores on traces they don't own | Validate `traceId` format in Zod schema AND log `matterId` + `traceId` pairs for auditability; consider verifying the trace exists via `langfuseClient.trace.get(traceId)` before scoring (adds latency) | Accepting any string as traceId; no format check |
| **Score flooding / DOS** | Any option | Malicious user script spams `/api/feedback` with thousands of scores, hitting Langfuse rate limits or billing | Rate-limit the `/api/feedback` endpoint per IP / session / matterId; set a hard cap (e.g. max 10 scores per session per hour) | No rate limiting |
| **Comment injection (stored XSS)** | Any option with an optional comment field | User submits `<script>` in comment; it renders in Langfuse UI | Cap comment length (Pattern 5 uses 500); rely on Langfuse's own dashboard sanitization (Langfuse UI escapes HTML -- but the contract is theirs, not yours) | Rendering the comment string as HTML in your own dashboard |
| **Tamper with score value** | Any option | Client sends `score: 999` when only `-1 | 1` is expected | Zod `z.union([z.literal(-1), z.literal(1)])` catches this server-side | Accepting any number |
| **Cross-matter scoring** | Any option | User from matter A sends a traceId for matter B and scores it | Optionally: look up the trace's `sessionId` (which the project sets to `matterId`) and verify the authenticated user has access to that matter | No cross-check (acceptable for a demo without real auth, but flag for production) |

### Trust Boundaries

For the recommended Option B architecture:

- **Boundary: POST `/api/feedback` body from browser** -- server MUST validate with Zod schema (Pattern 5). Validation required: traceId is 32-hex, score is `-1 | 1`, comment length <= 500. What happens if skipped: malformed Langfuse POST, 400 error from Langfuse, score not recorded; or arbitrary strings stored in your analytics.
- **Boundary: `message.metadata.langfuseTraceId` from server to client** -- the server is the source of truth; client just echoes it back on feedback. No trust boundary to enforce at display time beyond the earlier POST validation. But **for defense in depth**, the client could refuse to render feedback buttons if `langfuseTraceId` doesn't match the format regex -- catches bugs early.
- **Boundary: Langfuse SDK to `cloud.langfuse.com`** -- handled by the SDK; uses HTTPS and Basic auth. Not your concern at the application layer.

## Performance

| Metric | Value / Range | Source | Notes |
| ------ | ------------- | ------ | ----- |
| Score POST latency | ~200-800ms (cloud.langfuse.com from AWS edge) | Langfuse infra (typical) | Wrap in `after()` to avoid blocking user response |
| Bundle size delta (client) | ~0 KB | Architecture: Langfuse SDK is server-only | `@langfuse/client` is not imported in any `"use client"` module |
| Bundle size delta (server) | ~30-80 KB | Langfuse SDK with `@langfuse/core` dep (already on disk) | Server-only, no impact on user-visible perf |
| Extra wire bytes per message | ~100 bytes (1 `start` chunk with `messageMetadata` object) | AI SDK v6 `messageMetadata` wire format | Negligible |
| Langfuse free tier impact | +1 score unit per feedback click | Langfuse pricing | Free tier is 50K units/month; demo will use <1K |

No benchmarks found in official docs for `/api/public/scores` POST latency specifically -- flag for validation during implementation by instrumenting the call with `console.time`/`console.timeEnd`.

## Code Examples

Verified patterns from installed node_modules:

### Capturing the active trace ID

```ts
// Source: @langfuse/tracing@5.0.2, node_modules/@langfuse/tracing/dist/index.mjs:764
// Verified implementation
function getActiveTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId
}

// Usage inside the observed handler:
import { getActiveTraceId } from "@langfuse/tracing"

// ... inside propagateAttributes() callback, before streamText() ...
const traceId = getActiveTraceId()
if (!traceId) {
  console.warn("No active Langfuse trace ID at stream start -- feedback will be unavailable for this message")
}
```

### Creating a Langfuse score via `@langfuse/core` (verified fallback)

```ts
// Source: @langfuse/core@5.0.2, node_modules/@langfuse/core/dist/index.mjs:5617
// The fetcher call posts to POST /api/public/scores with Basic auth.
import { LangfuseAPIClient } from "@langfuse/core"

const client = new LangfuseAPIClient({
  environment: "https://cloud.langfuse.com",
  username: process.env.LANGFUSE_PUBLIC_KEY,
  password: process.env.LANGFUSE_SECRET_KEY,
})

await client.legacy.scoreV1.create({
  traceId: "abcdef1234567890abcdef1234567890",
  name: "user-feedback",
  value: 1, // 1 = thumbs up (for BOOLEAN), 0 = thumbs down
  dataType: "BOOLEAN",
  comment: "helpful",
})
```

### AI SDK v6 messageMetadata callback

```ts
// Source: ai@6.0.146, node_modules/ai/dist/index.mjs:7791 and :7981-7998
// The callback runs inside a TransformStream; returning a non-undefined value
// attaches it to the `start` chunk (or `finish`) and emits a `message-metadata`
// chunk for any other part.
type Meta = { langfuseTraceId?: string }

const result = streamText({ /* ... */ })

return result.toUIMessageStreamResponse<UIMessage<Meta>>({
  messageMetadata: ({ part }) => {
    if (part.type === "start") {
      return { langfuseTraceId: capturedTraceId }
    }
    return undefined // skip metadata emission on non-start parts
  },
})
```

### useChat with typed metadata

```ts
// Source: @ai-sdk/react@3.0.148, node_modules/@ai-sdk/react/dist/index.d.ts:39
// declare function useChat<UI_MESSAGE extends UIMessage = UIMessage>(
//   options?: UseChatOptions<UI_MESSAGE>
// ): UseChatHelpers<UI_MESSAGE>
import { useChat } from "@ai-sdk/react"
import type { UIMessage } from "ai"

type ChatMessage = UIMessage<{ langfuseTraceId?: string }>

const { messages, sendMessage } = useChat<ChatMessage>({ transport })

// messages[i].metadata is typed as { langfuseTraceId?: string } | undefined
const traceId = messages[0]?.metadata?.langfuseTraceId
```

### Zod schema for feedback POST body

```ts
// Source: project convention (src/app/api/chat/route.ts:24 pattern),
// Zod 4.3.6 (installed)
import { z } from "zod"

export const feedbackRequestSchema = z.object({
  traceId: z
    .string()
    .regex(/^[a-f0-9]{32}$/, "traceId must be a 32-char hex OTel trace ID"),
  score: z.union([z.literal(-1), z.literal(1)]),
  comment: z.string().max(500).optional(),
  messageId: z.string().min(1).optional(),
})

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
| ------------ | ---------------- | ------------ | ------ |
| Langfuse v2/v3 `langfuse` package with `.score()` method | `@langfuse/tracing` + `@langfuse/client` split; score via `LangfuseClient.legacy.scoreV1.create()` | Langfuse JS v5 (mid-2025) | Scoring moved to a different package; `@langfuse/tracing` is OTel-only now |
| AI SDK v4 `toDataStreamResponse()` with custom headers | AI SDK v6 `toUIMessageStreamResponse({ messageMetadata })` with typed `UIMessage<META>` | AI SDK v6 (late 2025) | Headers still work but metadata is idiomatic and type-safe |
| `maxSteps: N` on `streamText` | `stopWhen: stepCountIs(N)` | AI SDK v6 | Project is already on v6 pattern |
| `useChat` from `ai/react` | `useChat` from `@ai-sdk/react` (separate package) | AI SDK v6 | Project already imports correctly |

**Deprecated/outdated:**

- `langfuse` (the single-package v2/v3 SDK) -- replaced by split `@langfuse/tracing` / `@langfuse/client` / `@langfuse/otel` in v5. Don't install.
- Using a response header for trace ID propagation with `DefaultChatTransport` -- verified not supported without a custom fetch. Use `messageMetadata` instead.
- Scoring from inside the agent's `onFinish` callback -- was a pattern in v2 when the Langfuse SDK was stateful. In v5, the `@langfuse/tracing` package does not have a score method; scoring is a separate API call that can happen anywhere.

## Validation Architecture

### Test Framework

| Property | Value |
| -------- | ----- |
| Framework | None installed |
| Config file | None (no `vitest.config.*`, `jest.config.*`, `pytest.ini`, etc.) |
| Quick run command | N/A -- manual verification only |
| Full suite command | N/A |

Project has no automated test framework. Validation is exclusively manual: run `npm run dev`, interact with the chat, verify in Langfuse dashboard. `npm run lint` (Biome) is the only automated check. This is consistent with the greenfield demo nature (documented in `project/research/20260330-011345-drizzle-neon-data-layer.md` and subsequent research).

### Requirements → Test Map

| Requirement | Behavior | Test Type | Automated Command | File Exists? |
| ----------- | -------- | --------- | ----------------- | ------------ |
| TypeScript compiles | `npm run build` succeeds after changes | build | `npm run build` | existing |
| Biome lint passes | No lint errors in new files | lint | `npm run lint` | existing |
| `/api/feedback` route exists and validates input | POST valid body → 200 OK; POST invalid → 400 with error | manual (curl) | `curl -X POST localhost:3000/api/feedback -d '{...}'` | NO -- needs creating |
| `messageMetadata` carries trace ID to client | Check `message.metadata?.langfuseTraceId` in React DevTools after a chat response | manual (browser devtools) | Open devtools, inspect messages array | existing chat UI |
| Thumbs buttons render on substantive messages | Send a message that triggers a text response; buttons appear. Send a message that only triggers a tool call; no buttons. | manual (click-through) | Run dev, click through UI | NO -- component needs creating |
| Double-click prevention | Click thumbs up twice rapidly; only one score submitted | manual (check Langfuse dashboard) | Click, refresh Langfuse dashboard | N/A |
| Score appears on the correct trace in Langfuse | Submit a thumbs up; open Langfuse; find the trace; see a `user-feedback=1` score | manual (dashboard check) | Log in to cloud.langfuse.com | N/A |
| Error resilience: Langfuse down | Set LANGFUSE_SECRET_KEY to invalid; click thumbs; chat still works, server logs error | manual | Edit `.env.local`, restart dev, click | existing |

### Gaps (files to create before implementation)

- [ ] `src/app/api/feedback/route.ts` -- POST handler with Zod validation
- [ ] `src/components/chat/feedback-buttons.tsx` -- presentational component
- [ ] `src/lib/langfuse/client.ts` -- singleton Langfuse API client
- [ ] `src/types/chat.ts` (OR inline in chat-panel.tsx) -- `ChatMessage = UIMessage<{ langfuseTraceId?: string }>` type
- [ ] Modifications to `src/app/api/chat/route.ts` -- capture `getActiveTraceId()`, add `messageMetadata` callback
- [ ] Modifications to `src/components/chat/message.tsx` -- add `feedbackStatus`/`onFeedback` props, render `<FeedbackButtons>` conditionally
- [ ] Modifications to `src/components/chat/chat-panel.tsx` -- add `feedbackState` Map, `handleFeedback` callback, pass to `<Message>`, use typed `useChat<ChatMessage>`

No test infrastructure to set up. Verification is manual: run dev, interact, check Langfuse dashboard.

## Open Questions

1. **Exact constructor API of `@langfuse/client@5.0.2`**
   - What we know: It is a sibling package of `@langfuse/tracing`/`@langfuse/core`/`@langfuse/otel` in the langfuse-js monorepo, pinned at the same major version (5.0.2). It is described as "Langfuse API client for universal JavaScript environments". The underlying `@langfuse/core` `LangfuseAPIClient` takes `{ environment, username, password }` with username/password as the public/secret key pair.
   - What's unclear: Whether `LangfuseClient` is a thin wrapper that accepts `{ publicKey, secretKey, baseUrl }` (matching the `LangfuseSpanProcessor` constructor used in `src/instrumentation.ts`) or exposes `LangfuseAPIClient` directly. Whether `.score()` or `.createScore()` exists as an ergonomic shortcut vs. requiring the user to go through `client.legacy.scoreV1.create()`.
   - Recommendation: At implementation time, install the package, open `node_modules/@langfuse/client/dist/index.d.ts`, and scan exports. If the API differs from Pattern 3, fall back to Pattern 4 which is 100% verified against local sources. Either way, the call to `/api/public/scores` is the same under the hood.

2. **Whether to validate comment length or rely on Langfuse's server-side limit**
   - What we know: `ScoreBody.comment` is typed as `string | undefined` with no max-length annotation in the TypeScript definitions. Langfuse's API reference likely documents a limit (probably 10K chars based on typical API limits).
   - What's unclear: Exact maximum. Pattern 5 caps at 500 defensively.
   - Recommendation: Cap at 500 client-side and server-side (matches typical UX for a "why?" textarea). Adjust if the API rejects.

3. **Should scoring be session-scoped (matterId) or trace-scoped (message)?**
   - What we know: `CreateScoreRequest` supports both `traceId` and `sessionId`. The project passes `sessionId: matterId` via `propagateAttributes()`, so Langfuse already groups traces by matter.
   - What's unclear: Which axis is more useful for the interview demo narrative.
   - Recommendation: Trace-scoped (per-message). It's the roadmap intent, higher granularity, better signal, and Langfuse's dashboard supports rolling up trace scores to sessions automatically. Use `{ traceId }` without `sessionId` in the score request -- Langfuse's dashboard will show the score on the trace, which is itself linked to the session.

4. **Does `after()` block the serverless function long enough for the score POST to complete?**
   - What we know: Next.js 15+ `after()` is designed to run after the response is sent but before the function shuts down. It's used elsewhere in the project for `langfuseSpanProcessor.forceFlush()`.
   - What's unclear: On Vercel with Fluid Compute, the exact maximum duration of `after()` callbacks (is it bounded by `maxDuration`? by a separate limit?).
   - Recommendation: For a score call that takes <1 second, this is a non-issue on any sane serverless platform. Worst case the callback is truncated on shutdown and one score is lost -- the user already saw "submitted" so they don't notice. Not worth deeper investigation for a demo.

5. **User feedback on content vs. confidence**
   - What we know: The roadmap says thumbs up/down; we're using BOOLEAN. The scoring API also supports NUMERIC (0-1 range) and CATEGORICAL.
   - What's unclear: Whether the interview narrative is better told with a simple BOOLEAN ("we measure binary satisfaction") or a richer NUMERIC ("we measure confidence 0-1, which lets us do correlation analysis with stage outcomes").
   - Recommendation: BOOLEAN for phase 1 (ships faster, matches the thumbs UI). Mention in interview talking points that a NUMERIC score enables richer analytics (threshold alerts, trend analysis).

6. **Should we verify the trace exists before scoring?**
   - What we know: `client.trace.get(traceId)` exists and throws `NotFoundError` on invalid traces. But it adds a round trip.
   - What's unclear: Whether Langfuse's score POST silently creates a "dangling score" if the trace doesn't exist yet (trace ingestion is async via OTel; score ingestion is sync).
   - Recommendation: Do not pre-verify. Rely on the fact that by the time the user clicks thumbs (after `status === "ready"`), the `onFinish` + `after(flush)` have run and the trace has been pushed to Langfuse. Any timing bug there is orthogonal to the feedback feature.

## Sources

### Primary (HIGH confidence) -- verified from local node_modules

- [@langfuse/tracing@5.0.2 -- package.json](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/tracing/package.json) -- confirmed only exports span instrumentation, NOT scoring
- [@langfuse/tracing@5.0.2 -- index.d.ts exports at line 2117](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/tracing/dist/index.d.ts) -- full export list including `getActiveTraceId`, no score functions
- [@langfuse/tracing@5.0.2 -- index.mjs line 764 `getActiveTraceId` impl](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/tracing/dist/index.mjs) -- verified: `return trace.getActiveSpan()?.spanContext().traceId`
- [@langfuse/tracing@5.0.2 -- index.mjs line 665 `observe()` impl](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/tracing/dist/index.mjs) -- verified: uses `context.with(activeContext, ...)` so trace ID is active within wrapped function
- [@langfuse/core@5.0.2 -- index.d.ts line 8102 `LangfuseAPIClient`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/core/dist/index.d.ts) -- verified class and namespace Options with `{ environment, username, password, baseUrl }`
- [@langfuse/core@5.0.2 -- index.d.ts line 6156 `ScoreV1.create`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/core/dist/index.d.ts) -- verified: `create(request: CreateScoreRequest): HttpResponsePromise<CreateScoreResponse>`
- [@langfuse/core@5.0.2 -- index.d.ts line 2895 `CreateScoreRequest`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/core/dist/index.d.ts) -- verified fields: `traceId, name, value, dataType, comment, metadata, sessionId, ...`
- [@langfuse/core@5.0.2 -- index.mjs line 5617 `ScoreV1` impl](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/core/dist/index.mjs) -- verified: POSTs to `/api/public/scores` with Basic auth
- [@langfuse/core@5.0.2 -- index.mjs line 1580 `BasicAuth`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/core/dist/index.mjs) -- verified basic auth uses `btoa("username:password")`
- [@langfuse/otel@5.0.2 -- exports (index.d.ts:246)](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/otel/dist/index.d.ts) -- verified: only `LangfuseSpanProcessor`, no score API
- [@langfuse/tracing README.md](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/tracing/README.md) -- lists `@langfuse/client` as the universal JS API client package
- [ai@6.0.146 -- index.d.ts line 2347 `messageMetadata` type](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/ai/dist/index.d.ts) -- verified callback signature `({part}) => InferUIMessageMetadata<UI_MESSAGE> | undefined`
- [ai@6.0.146 -- index.d.ts line 1659 `UIMessage<METADATA, ...>`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/ai/dist/index.d.ts) -- verified: `metadata?: METADATA`
- [ai@6.0.146 -- index.d.ts line 2592 `toUIMessageStreamResponse`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/ai/dist/index.d.ts) -- verified accepts `UIMessageStreamResponseInit & UIMessageStreamOptions<UI_MESSAGE>` (so both `headers` and `messageMetadata`)
- [ai@6.0.146 -- index.mjs line 7791, 7981-7998, 8016-8021 transform impl](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/ai/dist/index.mjs) -- verified callback fires per part, attaches to start/finish, emits standalone `message-metadata` chunks for other parts
- [ai@6.0.146 -- index.mjs line 12778 `HttpChatTransport.sendMessages`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/ai/dist/index.mjs) -- verified: returns `processResponseStream(response.body)` without exposing `response.headers` (eliminates Option A)
- [@ai-sdk/react@3.0.148 -- index.d.ts line 39 `useChat`](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@ai-sdk/react/dist/index.d.ts) -- verified: `useChat<UI_MESSAGE extends UIMessage>(...): UseChatHelpers<UI_MESSAGE>`
- [Existing code: src/instrumentation.ts](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/src/instrumentation.ts) -- env var names (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL`), pattern for constructing Langfuse config
- [Existing code: src/app/api/chat/route.ts](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/src/app/api/chat/route.ts) -- current observe() + propagateAttributes() + streamText pattern to extend
- [Existing code: src/components/chat/message.tsx](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/src/components/chat/message.tsx) -- text/tool part rendering to extend with feedback button slot
- [Existing code: src/components/chat/chat-panel.tsx](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/src/components/chat/chat-panel.tsx) -- useChat invocation site to type with `ChatMessage`
- [Existing code: src/components/matter/stage-progress.tsx](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/src/components/matter/stage-progress.tsx) -- inline SVG pattern for icons (no icon library installed)
- [Existing code: package.json](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/package.json) -- confirmed installed versions, no test framework, no icon library

### Secondary (MEDIUM confidence) -- documented but not directly verified in this session

- [Langfuse JS SDK Docs](https://langfuse.com/docs/sdk/typescript) -- Accessed: 2026-04-07 (referenced in `@langfuse/tracing/README.md`, could not be fetched in this session)
- [Langfuse JS Reference](https://js.reference.langfuse.com) -- Accessed: 2026-04-07 (referenced in `@langfuse/tracing/README.md`, could not be fetched in this session)
- [langfuse/langfuse-js monorepo](https://github.com/langfuse/langfuse-js) -- Accessed: 2026-04-07 (source repo for the installed packages, referenced in `package.json` of each langfuse package)
- [langfuse/langfuse-vercel-ai-nextjs-example](https://github.com/langfuse/langfuse-vercel-ai-nextjs-example) -- Accessed: 2026-04-07 (official example repo; confirmed as authoritative reference in memory)
- [Project research: 20260330-042523-langfuse-otel-nextjs16-integration.md](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/research/20260330-042523-langfuse-otel-nextjs16-integration.md) -- prior research on the Langfuse OTel setup
- [Project research: 20260406-180000-matter-lifecycle-agent.md](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/research/20260406-180000-matter-lifecycle-agent.md) -- prior research on Option A (streamText + tools) that established current chat/route.ts pattern

### Tertiary (LOW confidence / to-be-validated)

- `@langfuse/client` exact API surface -- LOW because not installed; documented reference exists in sibling READMEs but type definitions not directly readable. Mitigated by a verified fallback path using `@langfuse/core`'s `LangfuseAPIClient`.

## Metadata

**Confidence breakdown:**

- Langfuse scoring SDK (create path): **HIGH** -- verified against local node_modules source of `@langfuse/core@5.0.2` and `@langfuse/tracing@5.0.2`. The exact call `client.legacy.scoreV1.create({ traceId, name, value, dataType })` is 100% verified including HTTP endpoint and auth header format.
- AI SDK v6 `messageMetadata` callback: **HIGH** -- verified against local node_modules source of `ai@6.0.146`. The type signature, when-it-fires semantics, and client-side `message.metadata` surfacing are all confirmed.
- Trace ID capture timing inside observe(): **HIGH** -- verified by reading the `observe()` implementation and confirming it uses `context.with(activeContext, fn)`. The closure-capture pattern is straightforward from that.
- Option A (custom header) not viable: **HIGH** -- verified by reading `HttpChatTransport.sendMessages` and confirming headers are not exposed after `processResponseStream` returns.
- `@langfuse/client` package API: **MEDIUM** -- package is documented in sibling READMEs with a matching version number but not installed. Recommendation: install and verify at implementation time. Fallback to `@langfuse/core` is 100% safe.
- Frontend UX patterns (button rendering, state management): **MEDIUM** -- standard React patterns, follows existing project conventions (inline SVG, Tailwind classes, "use client" boundaries). No external verification needed beyond the existing codebase.
- Security (architectural risks, CVEs): **MEDIUM** -- no CVEs found in installed versions; architectural risks identified from first principles (secret key exposure, traceId spoofing, rate limiting). External CVE databases not queryable in this session.

**Research date:** 2026-04-07
**Researcher:** `run-researcher` agent
**Intended consumer:** Planner for Feature #5 implementation
