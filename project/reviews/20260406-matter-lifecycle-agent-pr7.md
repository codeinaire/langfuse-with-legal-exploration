# Code Review: Matter Lifecycle Progression Agent (PR #7)

**Date:** 2026-04-06
**PR:** https://github.com/codeinaire/langfuse-with-legal-exploration/pull/7
**Branch:** feature/matter-lifecycle-agent
**Verdict:** BLOCK
**Files reviewed:** Full review of all 13 new files + modified route.ts

---

## Behavioral Delta

This PR delivers the core Feature #4: a conversational AI agent with 6 database-backed tools, a 10-stage NSW conveyancing state machine, a streaming chat UI (ChatPanel, Message, ToolIndicator), and a stage progress sidebar. The route.ts is rewritten to emit `toUIMessageStreamResponse()` with tools and `stopWhen: stepCountIs(5)`. Thirteen new files are added. The existing Langfuse + provider-fallback infrastructure is preserved.

---

## Findings

---

### [HIGH] Client transport is mismatched with server stream protocol

**File:** `src/components/chat/chat-panel.tsx:25`

**Issue:** The server returns `toUIMessageStreamResponse()`, which emits JSON-encoded SSE events (e.g., `data: {"type":"start",...}`). The client uses `TextStreamChatTransport`, which treats the response body as plain text and wraps every raw byte as a `text-delta` event. This means the client renders the raw SSE JSON as literal chat text. Tool call parts are never parsed into `UIMessageChunk` objects — the `ToolIndicator` component receives no tool parts, and the user sees raw JSON strings like `data: {"type":"tool-call-delta",...}` in the chat.

The correct pairing for `toUIMessageStreamResponse()` is `DefaultChatTransport`, which uses `parseJsonEventStream` to decode the SSE protocol.

```ts
// current — wrong transport for UIMessage stream protocol
const transport = useMemo(
  () =>
    new TextStreamChatTransport({
      api: "/api/chat",
      body: { matterId },
    }),
  [matterId],
);
```

```ts
// fix — DefaultChatTransport parses the JSON SSE protocol correctly
import { DefaultChatTransport } from "ai";

const transport = useMemo(
  () =>
    new DefaultChatTransport({
      api: "/api/chat",
      body: { matterId },
    }),
  [matterId],
);
```

---

### [MEDIUM] Stage advancement is not atomic — three updates without a transaction

**File:** `src/lib/state-machine/conveyancing.ts:102-115`

**Issue:** `tryAdvanceStage` performs three separate `db.update()` calls in sequence: marking the current stage `completed`, marking the next stage `in_progress`, and updating `matters.currentStage`. If the second or third update fails (e.g., DB error), the DB is left in a partially advanced state. The Neon HTTP driver via `drizzle-orm/neon-http` supports `db.transaction()` — these three writes should be wrapped in one.

```ts
// current — three independent writes
await db.update(matterStages).set({ status: "completed", completedAt: now })
  .where(eq(matterStages.id, currentStageRow.id));
await db.update(matterStages).set({ status: "in_progress", startedAt: now })
  .where(eq(matterStages.id, nextStageRow.id));
await db.update(matters).set({ currentStage: nextStage, updatedAt: now })
  .where(eq(matters.id, matterId));
```

```ts
// fix — single transaction
await db.transaction(async (tx) => {
  await tx.update(matterStages).set({ status: "completed", completedAt: now })
    .where(eq(matterStages.id, currentStageRow.id));
  await tx.update(matterStages).set({ status: "in_progress", startedAt: now })
    .where(eq(matterStages.id, nextStageRow.id));
  await tx.update(matters).set({ currentStage: nextStage, updatedAt: now })
    .where(eq(matters.id, matterId));
});
```

---

### [MEDIUM] `markActionComplete` can return `undefined` — callers access properties unconditionally

**File:** `src/lib/db/queries/actions.ts:75-86`

**Issue:** After the ownership guard passes, array destructuring `const [updated] = await db.update(...).returning(...)` yields `undefined` if the action was deleted between the SELECT and the UPDATE (TOCTOU). The function returns `undefined`, but callers in tools.ts access `.id`, `.description` etc. directly — a TypeError that propagates as an unhandled tool error.

```ts
// fix
const [updated] = await db.update(matterActions)
  .set({ status: "completed", completedAt: new Date() })
  .where(eq(matterActions.id, actionId))
  .returning({ ... });

if (!updated) {
  throw new Error(`Action ${actionId} was not updated — it may have been deleted.`);
}
return updated;
```

---

### [LOW] `MatterPage` passes unvalidated route `id` to DB queries

**File:** `src/app/matters/[id]/page.tsx:13-18`

**Issue:** A non-UUID `id` causes Postgres to throw "invalid input syntax for type uuid" — a 500 instead of a 404. Add UUID validation before the DB calls (matching the pattern already used in `/api/matters/[id]/route.ts`).

```ts
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(id)) {
  notFound();
}
```

---

## Review Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 1     |
| MEDIUM   | 2     |
| LOW      | 1     |

**Verdict: BLOCK**

The HIGH finding is a functional correctness bug: the `TextStreamChatTransport`/`toUIMessageStreamResponse()` protocol mismatch breaks tool call indicator rendering — the core demo experience. Swap to `DefaultChatTransport` and the rest of the implementation (tools, state machine, prompts, query functions, agent architecture) is solid and well-structured.

---

## GitHub Posting Status

GitHub MCP tools and `gh` CLI were not available in this environment. This review could not be posted to the PR. The findings above should be applied manually or posted via the GitHub web UI.
