# Orchestrator Pipeline Summary: Feature #5 — User Feedback Loop

**Date:** 2026-04-07
**PR:** https://github.com/codeinaire/langfuse-with-legal-exploration/pull/8
**Branch:** `feature/user-feedback-loop`
**Final verdict:** WARNING (0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW — both advisory)

## Original Task

Feature #5: User Feedback Loop — thumbs up/down buttons attached to agent responses, POST to `/api/feedback`, attach Langfuse scores to traces via SDK `score()` method. Key architectural challenge: plumbing the Langfuse trace ID from the streaming response to the frontend so feedback can be correlated to the exact trace.

Roadmap reference: `project/roadmaps/20260330-01-legal-agent-flow-demo-roadmap.md` lines 403-482.

## Research

**Artifact:** `project/research/20260407-feature-5-user-feedback-loop.md`

Key findings:
- **Trace ID plumbing** — the only architectural choice that actually mattered. Recommendation: capture `getActiveTraceId()` synchronously inside `propagateAttributes()` before the stream callback is registered, then close over it in the `messageMetadata` callback (guarded by `part.type === "start"` to emit once per message). This approach sidesteps the `@langfuse/otel` async context hazards.
- **Langfuse SDK package selection** — `@langfuse/client` was not installed; research recommended `@langfuse/core` as a fallback with verified method path `LangfuseAPIClient.legacy.scoreV1.create()`.
- **Score semantics** — BOOLEAN dataType with value 0 or 1, matching Langfuse's "Boolean score values must equal either 1 or 0" constraint.
- **Six open questions flagged**, all resolved by orchestrator per research recommendations before planning.

## Plan

**Artifact:** `project/plans/20260407-140000-feature-5-user-feedback-loop.md`

9 implementation steps (step 9 was no-op), 15 verification items including manual UI checks and Langfuse dashboard confirmation. Covered:
1. Install Langfuse SDK with @langfuse/core fallback
2. Create server-side `langfuseClient` wrapper
3. Define `chat-types.ts` for `ChatMessageMetadata` shape with `langfuseTraceId`
4. Implement `/api/feedback` route with Zod validation (traceId min 1, score literal 0|1, comment max 500 optional)
5. Extend chat route to emit trace ID via `messageMetadata` on start parts
6. Build `FeedbackButtons` component (SVG thumbs, click-spam prevention, disabled states)
7. Wire `Message` component to render buttons when metadata + text + role=assistant
8. Thread feedback state Map through `ChatPanel` to prevent streaming re-renders from clobbering submitted/error state

**User decisions during planning:**
- Q1: Install `@langfuse/client`, fall back to `@langfuse/core` if not available
- Q2: Cap comment at 500 chars
- Q3: Trace-scoped scoring (not session-scoped)
- Q4: `after()` callback pattern acceptable for the Langfuse call
- Q5: BOOLEAN dataType
- Q6: No pre-verification step for the fallback package path

## Implementation

**Artifact:** `project/implemented/20260407-140000-feature-5-user-feedback-loop.md`

**Files produced:**
- `src/lib/langfuse/client.ts` (new) — server-side wrapper around `LangfuseAPIClient`
- `src/lib/ai/chat-types.ts` (new) — `ChatMessageMetadata` type with `langfuseTraceId`
- `src/app/api/feedback/route.ts` (new) — Zod-validated POST handler, `after()` callback submits score
- `src/components/chat/feedback-buttons.tsx` (new) — SVG thumbs buttons with submitting/submitted/error states
- `src/app/api/chat/route.ts` (modified) — captures `getActiveTraceId()` inside `propagateAttributes()`, emits via `messageMetadata` on start parts
- `src/components/chat/message.tsx` (modified) — renders feedback buttons when conditions met
- `src/components/chat/chat-panel.tsx` (modified) — owns `feedbackState: Map<string, FeedbackStatus>` to survive streaming re-renders

**Deviations:**
- `@langfuse/client` not installed — fell back to `@langfuse/core` as researched. Import path used: `import { LangfuseAPIClient } from "@langfuse/core"`. Method path verified against local `.d.ts`: `legacy.scoreV1.create()` with fields `traceId`, `name`, `value`, `dataType: "BOOLEAN"`, `comment`.
- Pipeline was initially blocked at Step 4 because the implementer session had no Bash tool. Resumed in a Bash-capable session for verification and shipping.

## Ship

- **PR:** https://github.com/codeinaire/langfuse-with-legal-exploration/pull/8
- **Branch:** `feature/user-feedback-loop`
- **Lint fix applied during ship:** removed non-null assertion `onFeedback!` in `src/components/chat/message.tsx`, replaced with explicit `&& onFeedback` guard (Biome lint warning — redundant since `showFeedback` already guards `onFeedback != null`, but harmless).
- **Feature #4 pre-existing uncommitted changes carried along:** `src/app/api/matters/[id]/route.ts`, `src/instrumentation.ts` — per user approval.

## Code Review

**Artifact:** `project/reviews/20260407-160000-user-feedback-loop-pr8.md`
**Verdict:** WARNING

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 0     |
| MEDIUM   | 1     |
| LOW      | 1     |

### Verified correct

- **Trace ID plumbing** — `getActiveTraceId()` called at the top of `tryStreamText` inside the `propagateAttributes()` async context, captured in closure, emitted once per message via `part.type === "start"` guard
- **`@langfuse/core` fallback** — `LangfuseAPIClient` constructor, `legacy.scoreV1.create` method path, and `CreateScoreRequest` fields (`traceId`, `name`, `value`, `dataType: "BOOLEAN"`, `comment`) all verified against `node_modules/@langfuse/core/dist/index.d.ts`
- **Input validation** — Zod schema enforces `traceId: min(1)`, `score: literal(0)|literal(1)`, `comment: max(500).optional()`
- **Security** — zero Langfuse imports in `src/components/`, no `NEXT_PUBLIC_LANGFUSE_*` env vars, `LANGFUSE_SECRET_KEY` stays server-only
- **Click-spam prevention** — `setFeedbackState(..., "submitting")` called synchronously before `fetch()`, not in `.then()` — React re-renders disable the button before next click can fire
- **`onFeedback!` lint fix** — explicit `&& onFeedback` guard is correct
- **Feedback state in parent** — `feedbackState: Map<string, FeedbackStatus>` lives in `ChatPanel`, not `Message`, so streaming re-renders don't reset submitted/error states
- **`dataType: "BOOLEAN"`** — confirmed as a valid `ScoreDataType` literal

### Findings

**[MEDIUM] `@langfuse/core` imported directly but not declared as a direct dependency** (`src/lib/langfuse/client.ts:9`)
`@langfuse/core` is not in `package.json` under `dependencies` — it exists only as a transitive dep of `@langfuse/otel`/`@langfuse/tracing`. Works under npm today (both pin `"@langfuse/core": "^5.0.2"`), but the contract is fragile: a future semver-compatible update to either package that drops or replaces the `@langfuse/core` dep would silently break the import with no `package.json` signal. Amplified if the project ever migrates to pnpm.
**Fix:** `npm install @langfuse/core@^5.0.2`.

**[LOW] `forceFlush()` unguarded after the score try/catch** (`src/app/api/feedback/route.ts:42`)
If `forceFlush()` throws, it becomes a silent unhandled rejection inside `after()`. The same gap exists in the pre-existing chat route (`src/app/api/chat/route.ts:85`). The feedback route is a good place to tighten because the pattern is already structured as a try/catch.
**Fix:** Wrap `forceFlush()` in its own try/catch.

**GitHub posting status:** The review was written to `project/reviews/20260407-160000-user-feedback-loop-pr8.md` but NOT posted to GitHub — the reviewer agent had neither the GitHub MCP tools nor a Bash tool available. Manual posting command from the review file:

```bash
gh pr review 8 --repo codeinaire/langfuse-with-legal-exploration \
  --comment \
  --body "$(cat project/reviews/20260407-160000-user-feedback-loop-pr8.md)"
```

## Follow-up Items

1. **Declare `@langfuse/core` as a direct dependency** — `npm install @langfuse/core@^5.0.2` (MEDIUM).
2. **Guard `forceFlush()` with its own try/catch** — in both `src/app/api/feedback/route.ts:42` and `src/app/api/chat/route.ts:85` (LOW, and applies to pre-existing chat route too).
3. **Post the code review comment to PR #8** — the review file is ready; run the `gh pr review` command above (orchestrator session also had no Bash).

## Artifacts

| Stage | Path |
|-------|------|
| Research | `project/research/20260407-feature-5-user-feedback-loop.md` |
| Plan | `project/plans/20260407-140000-feature-5-user-feedback-loop.md` |
| Implementation | `project/implemented/20260407-140000-feature-5-user-feedback-loop.md` |
| Review | `project/reviews/20260407-160000-user-feedback-loop-pr8.md` |
| Pipeline state | `project/orchestrator/PIPELINE-STATE.md` |
| PR | https://github.com/codeinaire/langfuse-with-legal-exploration/pull/8 |
