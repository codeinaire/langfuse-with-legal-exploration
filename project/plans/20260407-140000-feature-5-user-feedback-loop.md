# Plan: Feature #5 -- User Feedback Loop (Thumbs Up/Down + Langfuse Scores)

**Date:** 2026-04-07
**Status:** Complete
**Research:** project/research/20260407-feature-5-user-feedback-loop.md
**Depends on:** 20260406-190000-matter-lifecycle-agent.md, 20260330-180000-langfuse-otel-observability.md

## Goal

Let users attach a thumbs up/down score to each substantive assistant message, persisted against the corresponding Langfuse trace as a `user-feedback` BOOLEAN score that surfaces in the Langfuse dashboard's score aggregates.

## Approach

Wire Feature #5 as three coordinated changes. First, propagate the Langfuse trace ID from the streaming backend to the client using AI SDK v6's idiomatic `messageMetadata` callback on `toUIMessageStreamResponse()` (Option B from the research) -- this is the only propagation path that works with `DefaultChatTransport`, because Option A (custom header) is verified-NOT-viable in the installed transport, and Option C (polling endpoint) has race conditions. Second, capture the trace ID synchronously inside the existing `propagateAttributes()` block with `getActiveTraceId()` and close over it in the callback, because the stream transform runs lazily after the route handler returns -- at which point the OTel context is no longer active and `getActiveTraceId()` would return undefined if called inside the callback. Third, POST `{ traceId, score, comment? }` from the client to a new `/api/feedback` route that validates with Zod and submits a BOOLEAN score to Langfuse via the `@langfuse/client` SDK (to be installed), with a concrete verified fallback to `@langfuse/core`'s `LangfuseAPIClient.legacy.scoreV1.create()` if the `@langfuse/client` API surface differs from research expectations at install time. Score submission is wrapped in `after()` so the HTTP response returns instantly and the 200-800ms Langfuse round trip runs post-response. Feedback state lives in the `ChatPanel` parent as a `Map<messageId, FeedbackStatus>` so re-renders from new streaming chunks don't reset it.

## Critical

- **`getActiveTraceId()` MUST be called synchronously inside `propagateAttributes()` / the `tryStreamText` function body**, NOT inside the `messageMetadata` callback. The callback fires inside a lazy `TransformStream` after the route handler has returned and the OTel context has been unwound -- calling `getActiveTraceId()` at that point returns `undefined`. Capture to a `const traceId` and close over it.
- **`messageMetadata` callback MUST guard `part.type === "start"` and return `undefined` for all other parts**. The SDK emits a standalone `message-metadata` wire chunk for every non-null return; emitting on every part wastes bytes and may break client assumptions about single-metadata-per-message semantics.
- **Score MUST be submitted via the server-side `/api/feedback` route only**. Never import `@langfuse/client` or `@langfuse/core` into any file under a `"use client"` boundary, and never prefix Langfuse env vars with `NEXT_PUBLIC_`. Exposing `LANGFUSE_SECRET_KEY` to the browser lets anyone submit arbitrary scores under the project.
- **Feedback buttons MUST only render when ALL of these hold**: (a) `message.role === "assistant"`, (b) `message.parts.filter(isTextUIPart).some(p => p.text.trim().length > 0)` (at least one non-empty text part), (c) `message.metadata?.langfuseTraceId` is present, (d) `status === "ready"` in `useChat` (NOT while streaming). Missing any one of these causes the buttons to leak onto tool-call-only messages or into the streaming-in-progress window where the trace ID may not yet be attached.
- **Button `disabled` state MUST be updated synchronously before the fetch call, not in the `.then()` callback**. Otherwise click-spam between click and fetch resolution creates duplicate scores on the same trace.
- **`dataType` MUST be `"BOOLEAN"`** with `value: 0 | 1` (thumbs up = 1, thumbs down = 0). Langfuse renders BOOLEAN scores as thumbs icons and aggregates them as percentages in the dashboard. NUMERIC would require an aggregation config and displays as decimals.
- **Score submission MUST be wrapped in `after()`** with `langfuseSpanProcessor.forceFlush()` also called in `after()` so both the score POST and the OTel span flush complete post-response. The feedback HTTP response returns `{ ok: true }` immediately regardless of whether the Langfuse POST has resolved.

## Steps

### 1. Install `@langfuse/client` and verify the API surface

- [x] Run `npm install @langfuse/client@^5.0.2` in the project root. This adds a direct dependency that matches the installed `@langfuse/tracing@5.0.2` / `@langfuse/otel@5.0.2` / `@langfuse/core@5.0.2` major version.
- [x] Read `node_modules/@langfuse/client/dist/index.d.ts` and find the default exported class (expected: `LangfuseClient`). Confirm its constructor options shape. The research's assumption is `{ publicKey, secretKey, baseUrl }` matching the `LangfuseSpanProcessor` constructor in `src/instrumentation.ts`. If the actual constructor takes something different (e.g. `{ environment, username, password }` passthrough to `LangfuseAPIClient.Options`), note the actual shape.
- [x] Confirm whether the exported class has an ergonomic `.score.create({ ... })` method (or similar) OR whether scoring goes through `client.legacy.scoreV1.create({ ... })`. Write the actual method path in a comment at the top of `src/lib/langfuse/client.ts` (created in step 2) for future reference.
- [x] **Branch decision:** If `@langfuse/client` exports a usable scoring class/method, proceed with that in step 2. If the API is missing/incompatible/unreadable (e.g. package not resolvable, no usable exports), fall back to Pattern 4 in the research: use `LangfuseAPIClient` from `@langfuse/core` directly (already installed as a transitive dependency, no additional install needed). This fallback path is 100% verified against local node_modules -- see `node_modules/@langfuse/core/dist/index.d.ts` line 8102 for the class and line 2895 for `CreateScoreRequest`. Uninstall `@langfuse/client` if using the fallback: `npm uninstall @langfuse/client`.

### 2. Create singleton Langfuse client for scoring

- [x] Create `src/lib/langfuse/client.ts` exporting a singleton Langfuse client instance. Use the env vars already present in `src/instrumentation.ts`: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL`.
- [x] **Primary path (if step 1 confirmed `@langfuse/client` works):** Import `LangfuseClient` from `@langfuse/client` and construct with the verified options shape. Export as `langfuseClient`.
- [x] **Fallback path (if step 1 indicated fallback):** Import `LangfuseAPIClient` from `@langfuse/core`. Construct with `{ environment: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com", username: process.env.LANGFUSE_PUBLIC_KEY, password: process.env.LANGFUSE_SECRET_KEY }`. `LangfuseAPIClient.Options` is verified at `node_modules/@langfuse/core/dist/index.d.ts` line ~5183. Export as `langfuseClient`.
- [x] Add a top-of-file comment noting which SDK path was chosen and the verified method path for scoring (e.g. `// Scores via langfuseClient.legacy.scoreV1.create({...})`). This is a debugging aid for the implementer and future maintainers.
- [x] Do NOT import anything from this file in a client component. Only server routes (`src/app/api/**`) and server-only utilities should reference `@/lib/langfuse/client`.
- [x] Biome format: 2-space indent, double quotes, no semicolons (matches `src/instrumentation.ts` style).

### 3. Create the shared `ChatMessage` type

- [x] Create `src/lib/ai/chat-types.ts` (sibling to `src/lib/ai/tools.ts`, `prompts.ts`, `model.ts`) with the following content shape:
  - Import `UIMessage` type from `"ai"`.
  - Export `type ChatMessageMetadata = { langfuseTraceId?: string }`.
  - Export `type ChatMessage = UIMessage<ChatMessageMetadata>`.
- [x] This file is imported by the server route (`src/app/api/chat/route.ts`), the feedback route (`src/app/api/feedback/route.ts`), and the client components (`src/components/chat/chat-panel.tsx`, `src/components/chat/message.tsx`). It is a type-only file -- no runtime imports, so it is safe to import from both server and client files.
- [x] Why `src/lib/ai/` and not `src/types/`: the codebase already organizes AI-related code under `src/lib/ai/` (`tools.ts`, `prompts.ts`, `model.ts`, `agent-context.ts`) and does not have a `src/types/` directory. Keeping the new type file in the same folder matches existing conventions.

### 4. Create the `/api/feedback` route handler

- [x] Create `src/app/api/feedback/route.ts` with a POST handler.
- [x] Define a Zod schema `feedbackRequestSchema` with these fields:
  - `traceId: z.string().min(1)` -- use the orchestrator's chosen minimal validation. (Research Pitfall 5 notes that OTel trace IDs are always 32-char lowercase hex, so a stricter `regex(/^[a-f0-9]{32}$/)` is a defense-in-depth option -- pick `min(1)` for MVP alignment with orchestrator brief.)
  - `score: z.union([z.literal(0), z.literal(1)])` -- 0 = thumbs down, 1 = thumbs up. Directly maps to Langfuse BOOLEAN value per `CreateScoreRequest.value` typed at `node_modules/@langfuse/core/dist/index.d.ts:2895` ("Boolean score values must equal either 1 or 0").
  - `comment: z.string().max(500).optional()` -- 500-char cap is the orchestrator's chosen value, enforced both client and server side.
- [x] Handler body:
  1. Try to parse `await req.json()` -- on failure return `new Response("Invalid JSON", { status: 400 })`.
  2. `safeParse` the body against `feedbackRequestSchema` -- on failure return `new Response(parsed.error.issues[0].message, { status: 400 })`.
  3. Destructure `{ traceId, score, comment }`.
  4. Wrap the score submission in `after(async () => { ... })` from `next/server`. Inside:
     - `try { await langfuseClient.<verified score path>({ traceId, name: "user-feedback", value: score, dataType: "BOOLEAN", comment }) } catch (err) { console.error("Failed to submit Langfuse score:", err instanceof Error ? err.message : String(err)) }`.
     - Also call `await langfuseSpanProcessor.forceFlush()` from `@/instrumentation` inside the same `after()` callback so any lingering trace spans flush before function shutdown. Mirror the pattern in `src/app/api/chat/route.ts:77`.
  5. Return `Response.json({ ok: true })` -- HTTP 200 -- immediately after scheduling `after()`.
- [x] Import `langfuseClient` from `@/lib/langfuse/client`.
- [x] Import `langfuseSpanProcessor` from `@/instrumentation`.
- [x] Import `after` from `next/server`.
- [x] Import `z` from `zod`.
- [x] Biome format: 2-space indent, double quotes, no semicolons.

### 5. Modify `src/app/api/chat/route.ts` to capture and propagate the trace ID

- [x] Add `getActiveTraceId` to the existing import from `@langfuse/tracing` at line 2-7 (already imports `observe`, `propagateAttributes`, `setActiveTraceIO`, `updateActiveObservation`).
- [x] Add `import type { ChatMessage } from "@/lib/ai/chat-types"` below the existing imports.
- [x] Inside `tryStreamText`, immediately before the `try { const result = streamText({ ... }) }` block (around current line 61-62), add:
  ```ts
  const traceId = getActiveTraceId()
  if (!traceId) {
    console.warn("No active Langfuse trace ID at stream start -- user feedback will be unavailable for this message")
  }
  ```
  This runs inside `propagateAttributes()` -> `observe()` context, so the OTel context is active and `getActiveTraceId()` returns the current trace ID. Capture to a `const` so it is closed over by the `messageMetadata` callback.
- [x] Change `return result.toUIMessageStreamResponse()` (current line 79) to:
  ```ts
  return result.toUIMessageStreamResponse<ChatMessage>({
    messageMetadata: ({ part }) => {
      if (part.type === "start" && traceId) {
        return { langfuseTraceId: traceId }
      }
      return undefined
    },
  })
  ```
  The generic type parameter `<ChatMessage>` tells the SDK what metadata shape to expect; without it the callback's return type defaults to `unknown`. The `part.type === "start"` guard ensures metadata is emitted only once per message (not on every text-delta or tool part).
- [x] Do NOT change anything else in the file. The existing `observe()` wrapper, `propagateAttributes()` call, `onFinish` handler, provider fallback loop, and `after(() => langfuseSpanProcessor.forceFlush())` pattern are all preserved.
- [x] Verify Biome formatting: the edit should use 2-space indent, double quotes, no semicolons.

### 6. Update `src/components/chat/message.tsx` to render feedback buttons conditionally

- [x] Replace the existing `import type { UIMessage } from "ai"` with `import type { ChatMessage } from "@/lib/ai/chat-types"`.
- [x] Add type `FeedbackStatus = "idle" | "submitting" | "submitted-up" | "submitted-down" | "error"` (exported so `chat-panel.tsx` can import it).
- [x] Change the `MessageProps` interface:
  ```ts
  interface MessageProps {
    message: ChatMessage
    feedbackStatus?: FeedbackStatus
    onFeedback?: (score: 0 | 1) => void
  }
  ```
- [x] Add a helper function `hasSubstantiveText(message: ChatMessage): boolean` that returns `message.parts.filter(isTextUIPart).some((p) => p.text.trim().length > 0)`. `isTextUIPart` is already imported at line 4.
- [x] Inside `Message`, compute `showFeedback`:
  ```ts
  const showFeedback =
    !isUser &&
    hasSubstantiveText(message) &&
    message.metadata?.langfuseTraceId != null &&
    onFeedback != null
  ```
- [x] Inside the assistant-message JSX block (the `<div className="space-y-2">` around current line 35-58), add after the `{message.parts.map(...)}` call, still inside the same `<div>`:
  ```tsx
  {showFeedback && (
    <FeedbackButtons
      status={feedbackStatus ?? "idle"}
      onSubmit={onFeedback!}
    />
  )}
  ```
  The non-null assertion `onFeedback!` is safe here because `showFeedback` already guarded `onFeedback != null`.
- [x] Import `FeedbackButtons` from `./feedback-buttons` (to be created in step 7). Place import near the top of the file alongside existing chat component imports.
- [x] Do NOT track feedback state inside `Message`. It must live in the parent (`ChatPanel`) -- see Pitfall 6 in research. The Message component stays presentational; it only renders based on props.

### 7. Create `src/components/chat/feedback-buttons.tsx`

- [x] Create a new `"use client"` component file at `src/components/chat/feedback-buttons.tsx`.
- [x] Import `type { FeedbackStatus } from "./message"`.
- [x] Define `FeedbackButtonsProps`:
  ```ts
  interface FeedbackButtonsProps {
    status: FeedbackStatus
    onSubmit: (score: 0 | 1) => void
  }
  ```
- [x] Render a flex row (`<div className="mt-2 flex items-center gap-1">`) containing two `<button type="button">` elements (thumbs up and thumbs down).
- [x] Each button:
  - `disabled={status === "submitting" || status === "submitted-up" || status === "submitted-down"}` -- disables after the first click and stays disabled permanently after submission.
  - `onClick={() => onSubmit(1)}` for thumbs up, `onClick={() => onSubmit(0)}` for thumbs down.
  - Inline SVG thumbs icon -- do NOT use an icon library (none installed). Mirror the inline-SVG pattern from `src/components/matter/stage-progress.tsx` lines 66-81 (existing checkmark SVG). Use Heroicons outline `hand-thumb-up` and `hand-thumb-down` paths.
  - Include `<title>Helpful</title>` / `<title>Not helpful</title>` inside the SVG for accessibility (same pattern as `stage-progress.tsx`).
  - Tailwind: `rounded p-1 text-gray-400 transition hover:text-gray-700 disabled:opacity-50` as the base. Tint green (`text-green-600`) when `status === "submitted-up"` and on the thumbs up button; tint red (`text-red-600`) when `status === "submitted-down"` and on the thumbs down button.
- [x] If `status === "error"`, render a small `<span className="text-xs text-red-500">Failed, try again</span>` after the buttons. If this state happens, the buttons should become re-enabled (add the error state to the disabled check inversion).
- [x] Biome format: 2-space indent, double quotes, no semicolons.

### 8. Update `src/components/chat/chat-panel.tsx` to wire state and the `onFeedback` callback

- [x] Add `import type { ChatMessage } from "@/lib/ai/chat-types"` and `import type { FeedbackStatus } from "./message"` near the top.
- [x] Add `useCallback` to the existing `react` import (currently imports `useEffect, useMemo, useRef, useState`). Change to `useCallback, useEffect, useMemo, useRef, useState`.
- [x] Change `const { messages, sendMessage, status, error } = useChat({ transport })` (current line 28-30) to `useChat<ChatMessage>({ transport })`. The generic flows through and types `message.metadata` on each message as `ChatMessageMetadata | undefined`.
- [x] Add a `feedbackState` state variable inside `ChatPanel`, immediately after the existing `const [inputValue, ...]` declaration:
  ```ts
  const [feedbackState, setFeedbackState] = useState<Map<string, FeedbackStatus>>(
    () => new Map(),
  )
  ```
- [x] Add a `handleFeedback` callback, memoized with `useCallback`:
  ```ts
  const handleFeedback = useCallback(
    async (messageId: string, traceId: string, score: 0 | 1) => {
      // Synchronously set to submitting BEFORE the fetch -- this prevents click-spam
      // from creating duplicate scores. React re-renders before the second onClick runs.
      setFeedbackState((prev) => new Map(prev).set(messageId, "submitting"))
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traceId, score }),
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
  ```
- [x] Update the message rendering loop (current line 118-120) to pass the new props:
  ```tsx
  {messages.map((message) => {
    const traceId = message.metadata?.langfuseTraceId
    const canGiveFeedback = status === "ready" && traceId != null
    return (
      <Message
        key={message.id}
        message={message}
        feedbackStatus={feedbackState.get(message.id) ?? "idle"}
        onFeedback={
          canGiveFeedback
            ? (score) => handleFeedback(message.id, traceId, score)
            : undefined
        }
      />
    )
  })}
  ```
  The `status === "ready"` guard (NOT "streaming") prevents the buttons from appearing on a message that is still streaming in (the `langfuseTraceId` metadata arrives on the `start` chunk, but we still want to avoid showing interaction affordances during streaming). Passing `undefined` for `onFeedback` when the guard fails makes `showFeedback` in `Message.tsx` evaluate to false.
- [x] Do NOT change the other `useChat` destructured values, the `DefaultChatTransport` config, the welcome-message buttons, the auto-scroll effect, or the `router.refresh` effect. Only the `useChat` generic type parameter and the message rendering loop change.
- [x] Biome format check.

### 9. (Only if fallback path was used in step 1) Update package.json to clean up unused install

- [x] Skip this step unless the fallback branch in step 1 was taken.
- [x] If `@langfuse/client` was installed and then the fallback path was chosen in step 2: run `npm uninstall @langfuse/client` to remove the unused dependency. Verify `package.json` no longer lists it.

## Security

### Known vulnerabilities

No known CVEs or security advisories for the recommended libraries as of 2026-04-07 per the research doc (verified against installed versions: `@langfuse/tracing@5.0.2`, `@langfuse/core@5.0.2`, `@langfuse/otel@5.0.2`, `ai@6.0.146`). `@langfuse/client@^5.0.2` is newly added in step 1 and has no known advisories against it. Run `npm audit` after step 1 and before marking implementation complete -- if any advisory appears for `@langfuse/client`, fall back to the verified `@langfuse/core` path (step 1 branch decision).

### Architectural risks

- **Secret key exposure:** `LANGFUSE_SECRET_KEY` MUST remain server-only. Never prefix with `NEXT_PUBLIC_`. The `src/lib/langfuse/client.ts` module MUST NOT be imported from any `"use client"` component. Feedback submission is mediated by the `/api/feedback` route; the client only knows `{ traceId, score, comment }` and never sees the Langfuse credentials. Validation: search `src/components/` for any import of `@/lib/langfuse/client` -- there should be zero results.
- **Trace ID spoofing:** The client can send any string as `traceId`. `z.string().min(1)` validates presence only (per orchestrator decision); Langfuse's own API will reject malformed trace IDs with a 400. The `/api/feedback` route logs failures to `console.error`, so spoofed or invalid IDs are at least visible in server logs. For production this should be upgraded to a stricter `regex(/^[a-f0-9]{32}$/)` check and/or a lookup that verifies the trace's `sessionId` matches the authenticated user's matterId -- flag in "Implementation Discoveries" if trivially testable.
- **Score value tampering:** The Zod union `z.union([z.literal(0), z.literal(1)])` rejects any non-0/1 value server-side. A client sending `{ score: 999 }` gets a 400. This is the correct and minimal validation for BOOLEAN scores.
- **Comment injection / stored XSS:** The optional comment field is capped at 500 chars server-side. The app never renders the comment in its own dashboard (Langfuse's dashboard is the only display surface, and Langfuse escapes HTML per their contract). No stored XSS vector in the project itself. Do NOT render `comment` string in the chat UI.
- **Score flooding / DoS:** No rate limiting on `/api/feedback`. Not a security issue for a demo but flag as a known production gap. A malicious client could spam the endpoint; mitigation would be per-IP / per-session rate limiting (e.g. Upstash ratelimit or Next.js middleware). Noted for follow-up, not in scope.
- **Cross-matter scoring:** Since the demo has no real authentication, any client with the page open for any matter could POST a traceId for any other matter's trace. Acceptable for an interview demo -- flag as a production gap in talking points. Mitigation would be looking up the trace's `sessionId` (which equals `matterId` per the existing `propagateAttributes` call in `src/app/api/chat/route.ts:129`) and verifying the authenticated user has access.

### Trust boundaries

- **Boundary: POST `/api/feedback` body.** MUST be validated with the Zod schema before any Langfuse call. Validation required: `traceId` non-empty string, `score` is literally `0` or `1`, `comment` at most 500 chars. What happens if skipped: the Langfuse API may reject with a 400 (caught by `console.error` inside `after()`), or worse, arbitrary strings get persisted as score values/comments. Zod catches this at the edge.
- **Boundary: `message.metadata.langfuseTraceId` server -> client -> server.** The server stamps the trace ID on the stream start chunk. The client echoes it back in `/api/feedback` requests. The echo is trusted only insofar as the earlier Zod validation allows -- a client can tamper with the value freely. This is a known and acceptable trust model for the demo; production would pair it with session auth.
- **Boundary: Langfuse SDK <-> cloud.langfuse.com.** Handled by the SDK over HTTPS with Basic auth (username = public key, password = secret key per `node_modules/@langfuse/core/dist/index.mjs:1580`). Not an application-layer concern.

## Open Questions

All open questions from the research doc have been resolved per orchestrator direction:

- **Q1 (exact `@langfuse/client` constructor):** (Resolved: step 1 reads the installed type definitions and branches between `@langfuse/client` and the 100%-verified `@langfuse/core` fallback.)
- **Q2 (comment length):** (Resolved: cap at 500 chars client and server side.)
- **Q3 (trace vs. session scoped):** (Resolved: trace-scoped. Pass `{ traceId }` only; do not add `sessionId`. The trace is already linked to the session via `propagateAttributes({ sessionId: matterId })` in the chat route, so Langfuse rolls up trace scores to the session in its dashboard.)
- **Q4 (`after()` duration):** (Resolved: non-issue for a <1s score POST on Vercel Fluid Compute. Worst-case one lost score per truncated shutdown, which the user never sees.)
- **Q5 (BOOLEAN vs. NUMERIC):** (Resolved: BOOLEAN. Langfuse renders BOOLEAN as thumbs icons and aggregates as percentages; NUMERIC would render as decimals and require an aggregation config. Noted for interview talking points: NUMERIC unlocks richer analytics -- threshold alerts, trend analysis, correlation with stage outcomes -- as a future enhancement.)
- **Q6 (pre-verify trace exists):** (Resolved: no. By the time `status === "ready"` on the client, the `onFinish` callback + `after(flush)` have run and the trace is flushed to Langfuse. Adding a `langfuseClient.trace.get(traceId)` pre-check would double the latency for no real-world benefit.)

## Implementation Discoveries

- **`@langfuse/client` was never installed** -- `node_modules/@langfuse/client` did not exist at implementation time. The implementer has no Bash tool to run `npm install`, so the fallback path (`@langfuse/core` / `LangfuseAPIClient`) was used directly. No `npm install @langfuse/client` was attempted. The user must confirm whether to keep the fallback permanently or install `@langfuse/client` later.
- **Fallback path confirmed correct** -- `LangfuseAPIClient` from `@langfuse/core` is exported at the top level (`node_modules/@langfuse/core/dist/index.d.ts` line 8522). Constructor takes `{ environment, username, password }` (line 8068). Score path is `langfuseClient.legacy.scoreV1.create(CreateScoreRequest)` (line 6188). `CreateScoreRequest` has `{ traceId, name, value, dataType, comment }` (line 2895). All verified.
- **`getActiveTraceId` confirmed exported** -- `@langfuse/tracing` exports `getActiveTraceId(): string | undefined` at line 2105 of its type definitions. No additional install needed.
- **`TextStreamPart.type === "start"` confirmed** -- The `TextStreamPart` union includes a `{ type: "start" }` variant (line 2670 in `ai/dist/index.d.ts`). The plan's `messageMetadata` guard on `part.type === "start"` is correct.
- **Two imports from `./message` in `chat-panel.tsx` merged** -- Biome's `organizeImports` would flag two separate import statements from the same module. They were merged into a single `import { Message, type FeedbackStatus } from "./message"`.
- **`convertToModelMessages` accepts `ChatMessage[]`** -- The function is generic over `UI_MESSAGE extends UIMessage`, and `ChatMessage` satisfies that constraint. No casting needed beyond the original `messages as ChatMessage[]` cast from the Zod-parsed body.
- **`npm audit` deferred to user** -- Cannot run shell commands. User should run `npm audit` after the session to confirm no new advisories from any package changes.
- **`npm run lint` and `npm run build` deferred to user** -- These verification steps cannot be run in the implementer role. User should run both to confirm zero errors.

## Verification

Project has no automated test framework (verified in research `Validation Architecture` section). All verification is manual or via `npm run build` / `npm run lint`.

- [ ] **Lint passes cleanly** -- `npm run lint` -- Automatic. Must report zero errors and zero warnings across all new/modified files: `src/lib/langfuse/client.ts`, `src/lib/ai/chat-types.ts`, `src/app/api/feedback/route.ts`, `src/app/api/chat/route.ts`, `src/components/chat/feedback-buttons.tsx`, `src/components/chat/message.tsx`, `src/components/chat/chat-panel.tsx`.
- [ ] **Build passes cleanly** -- `npm run build` -- Automatic. Next.js build runs `tsc` for type checking. Must succeed with no type errors. Specifically validates: (a) `@langfuse/client` (or `@langfuse/core`) exports used in step 2 exist at runtime; (b) `ChatMessage` generic flows through `useChat<ChatMessage>` and `toUIMessageStreamResponse<ChatMessage>` without type errors; (c) `messageMetadata` callback return type matches `ChatMessageMetadata | undefined`.
- [ ] **`npm audit` shows no new advisories** -- `npm audit` -- Automatic. Run after step 1 to catch any newly-flagged CVE in `@langfuse/client`.
- [ ] **`/api/feedback` route validates input** -- `curl -X POST http://localhost:3000/api/feedback -H "Content-Type: application/json" -d '{"traceId":"","score":1}'` -- Manual. Expect HTTP 400 with an error body mentioning the validation failure (empty traceId). Then `curl -X POST .../api/feedback -d 'not json'` should also return 400 ("Invalid JSON"). Then `curl -X POST .../api/feedback -d '{"traceId":"abc","score":2}'` should return 400 (score not in literal union).
- [ ] **`/api/feedback` route accepts valid input** -- `curl -X POST http://localhost:3000/api/feedback -H "Content-Type: application/json" -d '{"traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","score":1}'` -- Manual. Expect HTTP 200 with body `{"ok":true}`. Note this will also trigger a Langfuse POST for a non-existent trace; check server logs for a warning from the `console.error` inside `after()`.
- [ ] **`messageMetadata` carries the trace ID to the client** -- Manual via browser DevTools. Run `npm run dev`, open the app, send a message to the agent. In DevTools, open React DevTools (or use `console.log(JSON.stringify(messages, null, 2))` inside `ChatPanel`), inspect the assistant message object. Expect `message.metadata.langfuseTraceId` to be a 32-char hex string once the message finishes streaming.
- [ ] **Feedback buttons render on substantive assistant messages** -- Manual click-through. Send `"What should I do next?"` to the agent. Wait for the agent to respond with substantive text. Expect: two inline SVG thumbs up/down buttons rendered below the message text, disabled appearance greyed. Hover -- expect a transition to darker color.
- [ ] **Feedback buttons do NOT render on tool-call-only messages** -- Manual click-through. Send a message that triggers a tool call (e.g. `"What's the current status?"`) and watch the intermediate rendering. If AI SDK v6 emits an intermediate assistant message with only tool parts (no text), confirm no thumbs buttons appear on that intermediate state. Once the final text part arrives, buttons appear.
- [ ] **Feedback buttons do NOT render during streaming** -- Manual. Send a long-response prompt. While `status === "streaming"`, confirm no buttons visible on the in-progress message. Buttons appear only once `status === "ready"`.
- [ ] **Submitting a thumbs up transitions the UI state** -- Manual click. Click the thumbs up button on a completed message. Expect the button to immediately disable. Expect the thumbs up icon to tint green once the fetch resolves. Expect both thumbs up AND thumbs down to stay disabled permanently for that message.
- [ ] **Submitting a thumbs down transitions the UI state** -- Manual click. Same as above but with the thumbs down button; expect red tint on the thumbs down icon.
- [ ] **Double-click prevention works** -- Manual click-spam. Click the thumbs up button as fast as possible (5-10 clicks). Open Langfuse dashboard. Expect only ONE score created on the trace, not multiple. This validates the "synchronous setFeedbackState before fetch" pattern in step 8.
- [ ] **Score appears in Langfuse on the correct trace** -- Manual dashboard check. After clicking thumbs up or down on a message, open `cloud.langfuse.com`, navigate to the project's traces list, find the trace with the matching ID (visible in DevTools via `message.metadata.langfuseTraceId`). Expect a `user-feedback` score attached to that trace with `dataType: BOOLEAN` and `value: 1` (or `0` for thumbs down). The Langfuse UI should render the score as a thumbs icon. Allow ~5 seconds for the score POST to propagate.
- [ ] **Chat still works when Langfuse scoring fails** -- Manual resilience check. Edit `.env.local` to set `LANGFUSE_SECRET_KEY=invalid`. Restart `npm run dev`. Send a message -- chat should still work (the chat streams normally; OTel tracing just silently fails to flush). Click thumbs up -- the button should still transition to "submitted" visually (the feedback endpoint returns 200 because `after()` swallows the error). Check the dev server terminal -- expect a `console.error` log about the Langfuse auth failure. Revert `.env.local` after.
- [ ] **No Langfuse imports in client components** -- Manual grep. Run `rg "@/lib/langfuse" src/components` and `rg "@langfuse/client" src/components` and `rg "@langfuse/core" src/components`. All three should return zero matches. Violation = secret key exposure risk.
- [ ] **No `NEXT_PUBLIC_LANGFUSE` env vars** -- Manual grep. Run `rg "NEXT_PUBLIC_LANGFUSE"` across the whole project. Expect zero matches.
