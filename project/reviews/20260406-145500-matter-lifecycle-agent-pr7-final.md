# Code Review: Matter Lifecycle Progression Agent (PR #7) — Final

**Date:** 2026-04-06
**PR:** https://github.com/codeinaire/langfuse-with-legal-exploration/pull/7
**Branch:** feature/matter-lifecycle-agent
**Verdict:** BLOCK
**Files reviewed:** Full review — all 13 new files + modified route.ts

---

## What Was Reviewed

PR #7 delivers Feature #4: a conversational AI agent with 6 database-backed tools, a 10-stage NSW conveyancing state machine, a streaming chat UI (ChatPanel, Message, ToolIndicator), a stage progress sidebar, and supporting API routes. `route.ts` is updated to emit `toUIMessageStreamResponse()` with tools and `stopWhen: stepCountIs(5)`.

Files receiving full review:
- `src/app/api/chat/route.ts`
- `src/lib/ai/tools.ts`
- `src/lib/ai/prompts.ts`
- `src/lib/ai/agent-context.ts`
- `src/lib/state-machine/conveyancing.ts`
- `src/lib/db/queries/matters.ts`, `stages.ts`, `actions.ts`
- `src/app/api/matters/[id]/route.ts`
- `src/app/matters/[id]/page.tsx`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/message.tsx`
- `src/components/chat/tool-indicator.tsx`
- `src/components/matter/stage-progress.tsx`

Static analysis: `npm run build` passes, `npm run lint` (Biome) passes.

---

## Behavioral Delta

The system gains a full conversational agent. A lawyer navigating to `/matters/:id` sees a two-column layout: stage progress sidebar (auto-refreshing via `CustomEvent`) + chat panel. The LLM can call up to 5 tools per turn, reading and mutating the DB directly on the server. The client uses `useChat` from `@ai-sdk/react` with a pluggable transport.

---

## Findings

### [HIGH] `TextStreamChatTransport` is mismatched with `toUIMessageStreamResponse()`

**File:** `src/components/chat/chat-panel.tsx:23-30`

The server returns `result.toUIMessageStreamResponse()`, which emits structured JSON SSE events. The client uses `TextStreamChatTransport`, which treats the response as plain text — it pipes every raw byte through `transformTextToUiMessageStream` and emits `text-delta` for each byte. The JSON SSE protocol is never parsed.

Consequence: chat bubble renders raw SSE JSON strings; `ToolIndicator` never receives tool parts and never renders.

Fix: replace `TextStreamChatTransport` with `DefaultChatTransport` (imported from `"ai"`), which uses `parseJsonEventStream` to decode the SSE protocol.

---

### [MEDIUM] Stage advancement performs three non-atomic DB updates

**File:** `src/lib/state-machine/conveyancing.ts:102-115`

Three sequential `db.update()` calls without a transaction. Partial failure leaves the matter in a corrupt state.

Important constraint: `drizzle-orm/neon-http` throws `"No transactions support in neon-http driver"` from `db.transaction()` — the pre-written review doc's fix is wrong. Real options: `sql.transaction()` from `@neondatabase/serverless` directly, or switch to the WebSocket driver. Minimum safe fix for demo: `db.batch([...])` (one HTTP round-trip, not a true transaction).

---

### [MEDIUM] `markActionComplete` can return `undefined`

**File:** `src/lib/db/queries/actions.ts:75-86`

After the ownership SELECT, `const [updated] = await db.update(...).returning(...)` is `undefined` if the row is deleted between SELECT and UPDATE (TOCTOU). The caller in `tools.ts` accesses `.id`, `.description` etc. unconditionally — a `TypeError`.

Fix: add `if (!updated) { throw new Error(...); }` before `return updated`.

---

### [LOW] `MatterPage` passes unvalidated `id` to Postgres UUID column

**File:** `src/app/matters/[id]/page.tsx:13-18`

A non-UUID route param causes Postgres to throw `invalid input syntax for type uuid` — a 500 instead of a 404. The API route already validates with a UUID regex; the page should do the same with `notFound()`.

---

## Review Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 1     |
| MEDIUM   | 2     |
| LOW      | 1     |

**Verdict: BLOCK**

The HIGH finding (transport/protocol mismatch) breaks the core demo experience. The rest of the implementation is well-structured. Fix `TextStreamChatTransport` → `DefaultChatTransport` and address the two MEDIUM issues before merge.

## GitHub Posting Status

Posted as a comment on PR #7 (GitHub blocked `REQUEST_CHANGES` because the reviewer owns the PR). Comment confirmed visible via `gh pr view 7 --comments`.
