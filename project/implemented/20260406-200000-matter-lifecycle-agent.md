# Implementation Summary: Matter Lifecycle Progression Agent

**Date:** 2026-04-06
**Plan:** project/plans/20260406-190000-matter-lifecycle-agent.md
**Status:** Code complete -- pending npm install (step 1.1)

## Steps Completed

All steps 2-11 were completed. Step 1.1 (npm install) was deferred to the user since no bash tool is available in the implementer role.

**Step 1.2** -- useChat API surface verified via `ai/dist/index.d.ts` (no @ai-sdk/react install needed for verification).

**Steps 2-4** -- Agent context type, all three query files (matters, stages, actions), and state machine created.

**Steps 5-6** -- 6 tools in `tools.ts` and full conveyancing system prompt in `prompts.ts` created.

**Steps 7** -- `route.ts` fully rewritten: UIMessage schema, convertToModelMessages, tools, stopWhen(5), experimental_context, toUIMessageStreamResponse(), maxDuration=60.

**Step 8** -- `GET /api/matters/[id]` route created for stage progress sidebar refresh.

**Steps 9** -- Matter page (server component) and updated home page created.

**Steps 10** -- ChatPanel, Message, and ToolIndicator client components created.

**Steps 11** -- StageProgress component with custom DOM event-based refresh created.

**Steps 12** -- Manual verification steps deferred to user after npm install.

## Steps Skipped

- Step 1.1: `npm install @ai-sdk/react react-markdown remark-gfm` -- cannot run npm from implementer role. User must run before starting dev server.
- Steps 12.1-12.7: All manual verification steps require a running dev server. Code is complete; user must run npm install and start dev server to verify.

## Deviations From Plan

1. **`inputSchema` not `parameters`**: AI SDK v6 tool definitions use `inputSchema: FlexibleSchema<INPUT>` not `parameters`. Plan said "Zod v4 schemas" but didn't name the field. All tools use `inputSchema` correctly.

2. **Removed probe-first-chunk pattern from provider fallback**: The original `route.ts` probed `result.textStream` to verify provider availability before returning. With `toUIMessageStreamResponse()`, reading the textStream first would corrupt the UIMessage stream. The fallback loop structure is preserved but now only catches synchronous errors from `streamText()` call. Stream errors after the response starts are surfaced to the `useChat` client. This is a minor regression in multi-provider failover behavior but acceptable for the demo.

3. **`z.uuid()` instead of `z.string().uuid()`**: Zod v4 deprecates `z.string().uuid()` in favor of standalone `z.uuid()`. Used the non-deprecated form in chatRequestSchema and tool inputSchema.

4. **Stage refresh via DOM CustomEvent instead of `onRefresh` prop**: Plan said to pass `onRefresh` callback from parent page to StageProgress and ChatPanel. But the parent `MatterPage` is a server component that cannot hold callbacks. Implemented via `window.CustomEvent('matter-{matterId}-refresh')` dispatched by `ChatPanel` and received by `StageProgress`. Functionally equivalent.

5. **`prose` CSS class removed (no @tailwindcss/typography)**: The plan shows markdown rendering. Without `@tailwindcss/typography`, the `prose` class has no effect. Added a `markdown-body` CSS class in `globals.css` with basic markdown typography styles. The plan did not explicitly mention typography plugin dependency.

6. **Import `ToolExecutionOptions` from `ai` not `@ai-sdk/provider-utils`**: `ToolExecutionOptions` is re-exported from `ai` package. Used `import type { ToolExecutionOptions } from "ai"` for cleaner imports.

## Issues Deferred

1. **npm install step 1.1**: User must run `npm install @ai-sdk/react react-markdown remark-gfm` before the frontend will compile.

2. **TypeScript `import type { db as DbInstance }` pattern**: All query files use `db: typeof DbInstance` where `DbInstance` comes from `import type { db as DbInstance }`. This is a standard Drizzle ORM pattern. If TypeScript rejects it, the fix is to change to `import { db }; type DbType = typeof db;` and use `DbType` in parameter signatures.

3. **Production TODO (matterId trust boundary)**: The `matterId` is sent by the client in the request body. For the demo this is acceptable. Production would need to validate it against the authenticated user's matters.

4. **Groq tool calling reliability (Step 12.6)**: Not tested. The research notes LOW confidence for Groq multi-step agent reliability. Gemini is the demo default.

5. **Chat history persistence (Open Question 4)**: Confirmed not implemented. `ai_chats` and `ai_chat_messages` tables remain unused. Fresh history per page load.

## Verification Results

Manual verification steps (12.1-12.7) cannot be run without a dev server. Automatic verification (`npm run build`, `npm run lint`) cannot be run without the bash tool.

## Files Created / Modified

New files:
- `/src/lib/ai/agent-context.ts`
- `/src/lib/ai/tools.ts`
- `/src/lib/ai/prompts.ts`
- `/src/lib/db/queries/matters.ts`
- `/src/lib/db/queries/stages.ts`
- `/src/lib/db/queries/actions.ts`
- `/src/lib/state-machine/conveyancing.ts`
- `/src/app/api/matters/[id]/route.ts`
- `/src/app/matters/[id]/page.tsx`
- `/src/components/chat/chat-panel.tsx`
- `/src/components/chat/message.tsx`
- `/src/components/chat/tool-indicator.tsx`
- `/src/components/matter/stage-progress.tsx`

Modified files:
- `/src/app/api/chat/route.ts` -- switched to UIMessage format, added tools, stopWhen, toUIMessageStreamResponse()
- `/src/app/page.tsx` -- added link to seeded matter CONV-2026-0001
- `/src/app/globals.css` -- added markdown-body typography styles
