---
plan: project/plans/20260402-150000-provider-agnostic-llm-architecture.md
date: 2026-04-02
status: file-scaffolding complete; user must run npm install and manual verification
---

# Implementation: Provider-Agnostic LLM Architecture

## Steps Completed

**Step 1 (Install @ai-sdk/groq):** Added `"@ai-sdk/groq": "^3.0.0"` to `package.json` dependencies. The `npm install` command and `package-lock.json` deduplication check are deferred to the user (no Bash tool in implementer role).

**Step 2 (Update .env.example):** Appended `AI_PROVIDER` and `GROQ_API_KEY` entries with descriptive comments to `/Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/.env.example`.

**Step 3 (Create getModel() factory):** Created `/Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/src/lib/ai/model.ts` with:
- `LanguageModelV3` return type (from `@ai-sdk/provider`)
- `MODEL_MAP` with `gemini` -> `google("gemini-2.5-flash")` and `groq` -> `groq("llama-3.3-70b-versatile")`
- `getModel()` that reads `process.env.AI_PROVIDER`, defaults to `"gemini"`, throws descriptive error on unknown values
- Biome-compliant formatting: tabs, double quotes

**Step 4 (Refactor chat route):** Modified `/Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/src/app/api/chat/route.ts`:
- Removed `import { google } from '@ai-sdk/google'`
- Added `import { getModel } from "@/lib/ai/model"`
- Replaced `model: google('gemini-2.5-flash')` with `model: getModel()`
- All other route logic unchanged

## Steps Skipped / Deferred

**Step 1 sub-step (npm install):** Cannot run shell commands. User must run `npm install` to install `@ai-sdk/groq` and then verify `@ai-sdk/provider` deduplication in `package-lock.json`.

**Step 5 (npm run lint):** Deferred to user. Files were written to Biome's formatting conventions (tabs, double quotes) but cannot be verified without running the linter.

## Deviations from Plan

None substantive. The plan noted the `groq` named default export pattern; the implementation uses `import { groq } from "@ai-sdk/groq"` as specified. The cast pattern for `MODEL_MAP` lookup (`provider as AIProvider`) is an implementation detail needed because `process.env` returns `string | undefined`, not `AIProvider`.

The pre-existing single-quoted strings in `route.ts` (lines 8-58) were left as-is per plan scope ("No other changes to the route"). Running `npm run lint:fix` after install will auto-fix these to double quotes.

## Issues Deferred

1. **npm install required** -- User must run `npm install` before build/lint/dev-server can work with the new package.
2. **package-lock.json deduplication check** -- User must inspect after install and run `npm dedupe` if `@ai-sdk/provider` resolves to multiple versions.
3. **All manual verification steps** (Gemini streaming, Groq streaming, invalid provider error) -- Require a running dev server with real API keys.

## Verification Results

- TypeScript compilation: deferred to user
- Lint/format: deferred to user
- @ai-sdk/provider deduplication: deferred to user
- .env.example updated: confirmed (AI_PROVIDER and GROQ_API_KEY entries added)
- Integration tests (Gemini, Groq, invalid provider): deferred to user
