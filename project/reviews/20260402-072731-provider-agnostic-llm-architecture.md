---
pr: 3
branch: feature/provider-agnostic-llm
date: 2026-04-02
verdict: BLOCK
reviewer: code-reviewer agent
---

# Review: PR #3 — Provider-Agnostic LLM with getModel() Factory

## Verdict: BLOCK

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 2     |
| MEDIUM   | 1     |
| LOW      | 3     |

## What Was Reviewed

PR #3 (`feature/provider-agnostic-llm` → `main`). Stated scope: add `getModel()` factory in `src/lib/ai/model.ts`, refactor `route.ts` to use it, install `@ai-sdk/groq`, update `.env.example`.

Actual scope included undisclosed changes to `route.ts`: `startActiveObservation` wrapper, `span.update` I/O capture, and removal of `traceName` from `propagateAttributes`.

## Files Reviewed (full coverage)

- `src/lib/ai/model.ts` (new file)
- `src/app/api/chat/route.ts` (modified — beyond stated scope)
- `package.json` (modified — new dependency)
- `.env.example` (modified — two new env vars)
- `tsconfig.json` (reformatting only — no functional changes)
- `package-lock.json` (dependency resolution verified)
- `project/reviews/20260402-160000-provider-agnostic-llm-architecture.md` (pre-written review doc — inaccurate)
- `project/orchestrator/PIPELINE-STATE.md` (stale status)

## Key Findings

### [HIGH] `await result.text` / `toTextStreamResponse()` ordering — `src/app/api/chat/route.ts`

`result.toTextStreamResponse()` is called to begin streaming, then `await result.text` is called before the response is returned. `result.text` resolves by consuming the underlying token generator. This either races with the stream response or blocks streaming until the full response is buffered — both break the streaming contract. Fix: fire `.then()` on `result.text` in the background after returning `result.toTextStreamResponse()`.

### [HIGH] Undisclosed route.ts scope changes — `src/app/api/chat/route.ts`

Three behavioural changes not in the PR description:
1. `startActiveObservation("test-capture-i-o-explicit-update", ...)` wrapper added.
2. `span.update({ input/output })` calls added.
3. `traceName: 'matter-chat'` silently removed from `propagateAttributes` — Langfuse traces will no longer carry this label, breaking the demo dashboard narrative.

### [MEDIUM] `@ai-sdk/groq` version lower bound too broad — `package.json`

`"^3.0.0"` allows resolving any 3.x version; `@ai-sdk/google` uses `"^3.0.54"`. Lockfile currently resolves to `3.0.32`. A fresh install without the lockfile could resolve an older version and pull a divergent `@ai-sdk/provider`, breaking `LanguageModelV3` type compatibility.

### [LOW] Redundant `as string` cast — `src/lib/ai/model.ts:15`

`process.env.AI_PROVIDER ?? DEFAULT_PROVIDER` is already `string`; the outer `as string` is a no-op.

### [LOW] Pre-written review doc committed with inaccuracies — `project/reviews/20260402-160000-provider-agnostic-llm-architecture.md`

Claims "Route change is surgical — only the model instantiation changed" (false) and "No pre-written review doc committed" (self-contradicting). Delete or replace before merge.

### [LOW] Stale PIPELINE-STATE.md — `project/orchestrator/PIPELINE-STATE.md`

Committed with `Status: in-progress`, steps 4–5 `pending`. Update before merge.

## What Is Clean

- `getModel()` factory logic is correct: typed `MODEL_MAP`, descriptive error message on unknown `AI_PROVIDER`, no silent fallback.
- `@ai-sdk/provider@3.0.8` is deduplicated across all four AI SDK packages in the lockfile.
- `GROQ_API_KEY` and `AI_PROVIDER` are well-documented in `.env.example`.
- Biome formatting applied consistently (tabs, double quotes) across all new/modified source files.
- No secrets committed.

## Note on Pre-Written Review Doc

The existing `project/reviews/20260402-160000-provider-agnostic-llm-architecture.md` (committed as part of this PR) was written speculatively before the code was finalised. It gave an APPROVE verdict with 0 HIGH findings and missed both HIGH issues found in this review. Per established pattern for this repo, pre-written review docs should not be committed or should be clearly marked as provisional.
