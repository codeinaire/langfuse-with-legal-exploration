# Code Review: Langfuse Prompt Management Integration (PR #9)

**Date:** 2026-04-07
**PR:** https://github.com/codeinaire/langfuse-with-legal-exploration/pull/9
**Branch:** feature/langfuse-prompt-management
**Verdict:** WARNING
**Files reviewed:** Full review — 2 modified files

---

## What Was Reviewed

PR #9 delivers Feature #6: runtime prompt management via Langfuse. The change replaces the hardcoded `CONVEYANCING_SYSTEM_PROMPT` constant with a Langfuse-fetched prompt using the SDK-native fallback pattern.

Files receiving full review:
- `src/lib/ai/prompts.ts` — added `langfuseClient` import and `getSystemPrompt()` async function with JSDoc
- `src/app/api/chat/route.ts` — replaced constant import with `getSystemPrompt()`, added fallback log, added prompt-trace linking inside `propagateAttributes()`

Static analysis: `npm run build` and `npm run lint` were deferred by the implementer (no Bash tool during implementation). Reviewer also has no Bash tool available to run them. The API signatures were verified against `@langfuse/client@5.1.0` node_modules type definitions during review.

---

## Behavioral Delta

Every POST to `/api/chat` now calls `getSystemPrompt()` at the top of the handler before invoking the LLM. This fetches the system prompt text from Langfuse at runtime using a 60-second TTL in-memory cache, a 3-second fetch timeout, 2 retries, and an SDK-native fallback to the hardcoded constant. When the prompt is served from Langfuse (not the fallback), `updateActiveObservation({ prompt: { name, version, isFallback: false } }, { asType: "generation" })` is called inside `propagateAttributes()` to link the Langfuse trace to the specific prompt version in the Langfuse UI.

---

## Findings

---

### [MEDIUM] No tests for `getSystemPrompt()`

**File:** `src/lib/ai/prompts.ts`

**Issue:** `getSystemPrompt()` has external I/O (Langfuse API call), an SDK-native fallback that sets `isFallback: true`, and its return value drives conditional behavior in `route.ts` (the prompt-trace linking call is guarded by `!isFallback`). The research document explicitly identified three unit test requirements for this function: fetch-from-Langfuse path, fallback path, and `isFallback` flag propagation. None were created.

**Fix:** Create `src/lib/ai/prompts.test.ts` mocking `langfuseClient.prompt.get` to cover:
1. Happy path — SDK returns remote prompt: assert `text`, `promptName`, `promptVersion > 0`, `isFallback = false`
2. Fallback path — mock throws or returns fallback client: assert `text = CONVEYANCING_SYSTEM_PROMPT`, `promptVersion = 0`, `isFallback = true`
3. `compile()` called without variables: assert returned string matches the mock's `.compile()` output

```typescript
// src/lib/ai/prompts.test.ts
import { describe, it, expect, vi } from "vitest"
import { langfuseClient } from "@/lib/langfuse/client"
import { CONVEYANCING_SYSTEM_PROMPT, getSystemPrompt } from "@/lib/ai/prompts"

vi.mock("@/lib/langfuse/client")

describe("getSystemPrompt", () => {
  it("returns fetched prompt when Langfuse is available", async () => {
    vi.mocked(langfuseClient.prompt.get).mockResolvedValue({
      compile: () => "remote prompt text",
      name: "conveyancing-system-prompt",
      version: 3,
      isFallback: false,
    } as any)

    const result = await getSystemPrompt()

    expect(result.text).toBe("remote prompt text")
    expect(result.promptName).toBe("conveyancing-system-prompt")
    expect(result.promptVersion).toBe(3)
    expect(result.isFallback).toBe(false)
  })

  it("returns fallback prompt when Langfuse is unavailable", async () => {
    vi.mocked(langfuseClient.prompt.get).mockResolvedValue({
      compile: () => CONVEYANCING_SYSTEM_PROMPT,
      name: "conveyancing-system-prompt",
      version: 0,
      isFallback: true,
    } as any)

    const result = await getSystemPrompt()

    expect(result.text).toBe(CONVEYANCING_SYSTEM_PROMPT)
    expect(result.isFallback).toBe(true)
    expect(result.promptVersion).toBe(0)
  })
})
```

---

## Review Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 0     |
| MEDIUM   | 1     |
| LOW      | 0     |

**Verdict: WARNING**

The implementation is correct and clean. The API usage matches the verified `@langfuse/client@5.1.0` type signatures exactly: `prompt.get()` with `type: "text"` and `fallback`, `.compile()` on the result, `isFallback` guard before prompt-trace linking, and `{ asType: "generation" }` on the `updateActiveObservation` call (required for the `prompt` field to map to OTel attributes). The JSDoc comment covers the manual Langfuse console setup steps. The fallback log is present.

The only finding is the absence of unit tests for `getSystemPrompt()`, which has external I/O and conditional behavior in the route that depends on its output. For a demo project this is non-blocking, but the test gap should be closed before using this pattern in production.

**Note on pre-existing findings from PR #7:** The transport mismatch (HIGH), non-atomic stage advancement (MEDIUM), and `markActionComplete` TOCTOU (MEDIUM) remain open. They are not touched by this PR. Separately, the staged local change to `src/app/api/matters/[id]/route.ts` adds UUID validation (`z.uuid()` + `safeParse` guard) which resolves the LOW finding from PR #7 — that fix should be included in a follow-up PR if not already shipped.

---

## GitHub Posting Status

GitHub MCP tools and Bash tool (for `gh` CLI) are not available in this environment. This review could not be posted to the PR automatically. The findings above should be applied manually or posted via the GitHub web UI.
