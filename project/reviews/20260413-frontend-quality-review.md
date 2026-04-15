---
verdict: WARNING
reviewed: 2026-04-13
scope: local changes (no PR)
files: full review of all frontend files
---

## Verdict: WARNING

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 3     |
| MEDIUM   | 5     |
| LOW      | 4     |

## HIGH

### H1 — message.tsx casing conflict breaks Linux/Vercel builds
File: `src/components/chat/message.tsx` (git) vs `src/components/chat/Message.tsx` (disk)
Git tracks `message.tsx` (lowercase); disk has `Message.tsx` (PascalCase); `ChatPanel.tsx:8` imports from `"./Message"`.
macOS silently hides this; on Linux CI/Vercel (case-sensitive FS) git checks out `message.tsx` and the `./Message` import fails at build time.
Fix: `git mv src/components/chat/message.tsx src/components/chat/Message.tsx` (with core.ignorecase=false config on macOS).

### H2 — FeedbackModal missing dialog accessibility semantics
File: `src/components/chat/FeedbackModal.tsx:40`
The modal backdrop (`div.fixed.inset-0`) has no `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby`, and no keyboard trap. Screen readers will not announce it as a dialog; focus is not constrained to the modal; pressing Escape does not close it.
Fix: Add `role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title"` to the inner container; add an `onKeyDown` handler on the backdrop that calls `onClose` on Escape; give the `<h3>` an `id="feedback-modal-title"`.

### H3 — Suggestion buttons fire sendMessage without streaming guard
File: `src/components/chat/ChatPanel.tsx:135-163`
The two "Try asking" prompt buttons are rendered only when `messages.length === 0`, but they carry no `disabled` check against `status`. If the initial stream errors before producing a message (so `messages.length` stays 0) and retries are in flight, clicking a suggestion button calls `sendMessage` concurrently. The form's `handleSubmit` guards on `status === "streaming"` but the suggestion buttons do not.
Fix: Add `disabled={isStreaming}` and a matching `disabled:opacity-50 disabled:cursor-not-allowed` class to both suggestion buttons.

## MEDIUM

### M1 — Auto-scroll only fires on new message count, not during streaming
File: `src/components/chat/ChatPanel.tsx:56-62`
The scroll effect depends on `messages.length`. During streaming, the assistant message count stays constant while content grows. Long streamed responses push content below the viewport and the user must scroll manually.
Fix: Add a second effect (or extend the dependency array) that also triggers scroll on status changes from `streaming` -> `ready`.

### M2 — MAX_CLIENT_RETRIES declared inside component body
File: `src/components/chat/ChatPanel.tsx:23`
`const MAX_CLIENT_RETRIES = 2` is re-declared on every render. While React will not re-run the retry effect because of this (the closure captures the value correctly), it is misleading and inconsistent with how the project handles module-level constants. Move to module scope.

### M3 — MatterPage passes raw non-UUID `id` to three DB queries without validation
File: `src/app/matters/[id]/page.tsx:13`
`const { id } = await params` is passed directly to `getMatterWithCurrentStage`, `getAllStages`, and `getStageWithActions` without UUID validation. An invalid UUID causes Neon/Postgres to throw a 22P02 syntax error which Next.js renders as an unhandled 500. The GET API route (`/api/matters/[id]/route.ts:15`) correctly validates with `idSchema.safeParse`; the page does not.
Fix: Validate `id` at the top of `MatterPage` and call `notFound()` on failure.

### M4 — No app-level error boundary; DB errors surface as 500 with no recovery UI
Files: `src/app/matters/[id]/page.tsx`, `src/app/page.tsx`
Neither page has a co-located `error.tsx` and neither wraps DB calls in try/catch. A transient Neon connection failure or cold-start timeout will produce a raw Next.js 500 page with no user-facing explanation. This is especially visible because `maxDuration = 60` on the chat route but there is no timeout or fallback for the SSR data fetches.
Fix: Add `src/app/matters/[id]/error.tsx` and `src/app/error.tsx` with user-friendly fallback UIs.

### M5 — `error.message` from useChat rendered directly with no sanitisation
File: `src/components/chat/ChatPanel.tsx:209`
`error.message` comes from the AI SDK error object and may contain provider API error messages (e.g., rate-limit bodies, model IDs, internal tracing context). Rendering it verbatim exposes implementation details to users.
Fix: Replace with a generic user message: `"Something went wrong. Please try again."` and log the raw error to the console only.

## LOW

### L1 — `React.SubmitEvent` is not the idiomatic type for form submit handlers
Files: `src/components/chat/ChatPanel.tsx:103`, `src/components/chat/FeedbackModal.tsx:32`
Both form submit handlers type their event parameter as `React.SubmitEvent`. The conventional React type for `<form onSubmit>` is `React.FormEvent<HTMLFormElement>`. `React.SubmitEvent` is valid (it extends `SyntheticEvent`) but is non-standard and will confuse other React developers. The TypeScript compiler accepts it, so this is LOW.

### L2 — FeedbackModal backdrop does not close on click-outside
File: `src/components/chat/FeedbackModal.tsx:40`
Clicking the dark overlay does nothing. Standard modal UX convention and WCAG 2.1 advisory technique expects backdrop click to dismiss. The Cancel button is available, but the modal lacks an `onClick={onClose}` on the backdrop with `e.stopPropagation()` on the inner container.

### L3 — `formatDate` renders "Invalid Date" for malformed `completedAt` strings
File: `src/components/matter/StageProgress.tsx:32-39`
`new Date("bad-string").toLocaleDateString(...)` returns the string `"Invalid Date"` which would be rendered in the sidebar. The `completedAt` field comes from the DB so corruption is unlikely, but defensive handling costs nothing.
Fix: Add `if (isNaN(d.getTime())) return ""` after constructing `d`.

### L4 — `updateActiveObservation` and `setActiveTraceIO` called before `propagateAttributes`
File: `src/app/api/chat/route.ts:101-104`
Both telemetry calls at lines 101-104 run before the `propagateAttributes` wrapper establishes the active observation context. They are no-ops or attach to the wrong span. The equivalent calls inside the `propagateAttributes` callback (line 117-126) are the effective ones.
Fix: Move the `input:` calls to inside the `propagateAttributes` callback, or remove the pre-callback calls.
