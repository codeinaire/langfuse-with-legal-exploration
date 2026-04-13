---
# Code Review: Langfuse Prompt Management Integration (PR #9)

**Date:** 2026-04-13
**PR:** https://github.com/codeinaire/langfuse-with-legal-exploration/pull/9
**Branch:** feature/langfuse-prompt-management
**Verdict:** WARNING
**Files reviewed:** Full review — 2 modified source files

---

## What Was Reviewed

PR #9 delivers Feature #6: runtime prompt management via Langfuse. The change replaces the hardcoded `CONVEYANCING_SYSTEM_PROMPT` constant with a Langfuse-fetched prompt using the SDK-native fallback pattern.

Files receiving full review:
- `src/lib/ai/prompts.ts` — added `langfuseClient` import and `getSystemPrompt()` async function
- `src/app/api/chat/route.ts` — replaced constant import with `getSystemPrompt()`, added fallback log, added prompt-trace linking inside `propagateAttributes()`

Static analysis: `npm run build` passes cleanly (TypeScript, no errors). `npm run lint` produces 7 warnings all in `src/lib/state-machine/conveyancing.test.ts` (`noExplicitAny`) — pre-existing, not introduced by this PR.

---

## Behavioral Delta

Every POST to `/api/chat` now calls `getSystemPrompt()` at the top of the handler before invoking the LLM. This fetches the system prompt text from Langfuse using the prompt name `complete-prompts/conveyancing/buyer-nsw`, with a 60-second TTL in-memory cache, 3-second fetch timeout, 2 retries, and SDK-native fallback to the hardcoded constant. When the prompt is served from Langfuse (not the fallback), `updateActiveObservation({ prompt: { name, version, isFallback: false } }, { asType: "generation" })` is called inside `propagateAttributes()` to link the Langfuse trace to the specific prompt version.

---

## Findings

---

### [MEDIUM] Duplicate fallback log on every fallback request

**File:** `src/app/api/chat/route.ts:143-145` and `src/lib/ai/prompts.ts:103-104`

**Issue:** `prompts.ts` already logs on both the fallback and non-fallback paths (lines 103-107): `console.warn` when `isFallback`, and `console.info` with the prompt name/version otherwise. Then `route.ts` adds a second fallback log at lines 143-145: `console.info("Using fallback system prompt ...")`. On every fallback request the operator sees two log lines from two different locations — one warn-level and one info-level — saying the same thing. The non-fallback path is logged correctly only once (from `prompts.ts`).

**Fix:** Remove the redundant log block from `route.ts` since `prompts.ts` already owns the logging responsibility:

```typescript
// route.ts — remove these 4 lines
  if (isFallback) {
    console.info("Using fallback system prompt (Langfuse prompt not available)")
  }
```

---

### [MEDIUM] Pre-written review document has inaccurate content

**File:** `project/reviews/20260407-langfuse-prompt-management-pr9.md`

**Issue:** This review was committed as part of the PR (line 723+ in the diff) but contains at least two factual inaccuracies that contradict the actual implementation:

1. **Wrong prompt name.** The committed review says the SDK is called with `"conveyancing-system-prompt"` (referenced in its test template at line 55 and line 71). The actual code uses `"complete-prompts/conveyancing/buyer-nsw"`. Any engineer copying the test template from this file will write tests against the wrong prompt name — tests would pass by coincidence but assert incorrect behavior.

2. **Wrong logging location and severity.** The committed review says the fallback log is placed in `route.ts` as `console.info`. The actual code logs from within `getSystemPrompt()` in `prompts.ts` using `console.warn` (fallback) and `console.info` (non-fallback). The route has an additional redundant log (finding above).

The review also says "Reviewer also has no Bash tool available to run them" — this is stale boilerplate from a different session. Build and lint have since been verified to pass.

**Fix:** Either delete `project/reviews/20260407-langfuse-prompt-management-pr9.md` before merging (it's superseded by the actual post-implementation review), or correct the two inaccuracies above. The file should not be treated as an authoritative review.

---

### [MEDIUM] No tests for `getSystemPrompt()`

**File:** `src/lib/ai/prompts.ts`

**Issue:** `getSystemPrompt()` has external I/O, an SDK-native fallback that sets `isFallback: true`, and its return value drives conditional behavior in `route.ts` (the prompt-trace linking call is guarded by `!isFallback`). No unit tests were created.

**Fix:** Create `src/lib/ai/prompts.test.ts` mocking `langfuseClient.prompt.get` to cover the fetch path, fallback path, and `isFallback` flag. Note: the test template in the committed review document uses the wrong prompt name (`"conveyancing-system-prompt"`) — use `"complete-prompts/conveyancing/buyer-nsw"` instead:

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
      name: "complete-prompts/conveyancing/buyer-nsw",
      version: 3,
      isFallback: false,
    } as any)

    const result = await getSystemPrompt()

    expect(result.text).toBe("remote prompt text")
    expect(result.promptName).toBe("complete-prompts/conveyancing/buyer-nsw")
    expect(result.promptVersion).toBe(3)
    expect(result.isFallback).toBe(false)
  })

  it("returns fallback prompt when Langfuse is unavailable", async () => {
    vi.mocked(langfuseClient.prompt.get).mockResolvedValue({
      compile: () => CONVEYANCING_SYSTEM_PROMPT,
      name: "complete-prompts/conveyancing/buyer-nsw",
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
| MEDIUM   | 3     |
| LOW      | 0     |

**Verdict: WARNING**

The core implementation is correct. The API usage matches the verified `@langfuse/client@5.1.0` type signatures: `prompt.get()` with `type: "text"` and `fallback`, `.compile()` on the result, `isFallback` guard before prompt-trace linking, and `{ asType: "generation" }` on the `updateActiveObservation` call. Build and lint pass cleanly.

Three MEDIUM findings: (1) duplicate fallback logging — `prompts.ts` already logs and `route.ts` adds a redundant second log on every fallback request; (2) the committed pre-written review in `project/reviews/` has the wrong Langfuse prompt name and inaccurate logging description — it should be deleted or corrected before merge; (3) no unit tests for `getSystemPrompt()`.

None are blockers for a demo project, but (1) and (2) are one-line fixes that should land before merge.
