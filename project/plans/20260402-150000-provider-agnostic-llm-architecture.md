# Plan: Provider-Agnostic LLM Architecture

**Date:** 2026-04-02
**Status:** Complete
**Research:** project/research/20260402-141500-provider-agnostic-llm-architecture.md

## Goal

Create a `getModel()` factory function that reads `AI_PROVIDER` env var to switch between Gemini and Groq, then refactor the chat route to use it instead of importing `google()` directly. This makes the app provider-agnostic with a single env var change.

## Approach

Use the Vercel AI SDK's built-in provider abstraction. All first-party provider packages (`@ai-sdk/google`, `@ai-sdk/groq`) implement `ProviderV3` and return `LanguageModelV3` objects. A factory function with return type `LanguageModelV3` (from `@ai-sdk/provider`) will be type-compatible with `streamText`'s `model` parameter without any casting or adapters.

The factory uses Architecture Option A from the research: env var switch only, no runtime toggle. The `AI_PROVIDER` env var selects the provider at call time (defaults to `"gemini"`). Model IDs are centralized in a record map inside the factory. The `groq` default import is used (matching the existing `google` import pattern) since no custom provider configuration is needed.

The research recommended `createGroq()` at module scope in its pattern example, but the `groq` named default export is equivalent and simpler -- it is a pre-created provider instance that reads `GROQ_API_KEY` from the environment automatically, identical to how `google` reads `GOOGLE_GENERATIVE_AI_API_KEY`.

## Critical

- The `getModel()` factory must throw a descriptive error for unknown `AI_PROVIDER` values -- a silent fallback would hide misconfiguration.
- `AI_PROVIDER` must only be read from `process.env` (server-side). It must never be settable from request headers, query params, or client input.
- Raw SDK errors from either provider must not be forwarded to the client (risk of leaking API keys or request headers in stack traces). The existing route already returns generic error strings for parse failures, but the `streamText` call is not wrapped in a try/catch -- this is out of scope for this feature (the route does not catch streaming errors today either) but should be noted.

## Steps

### 1. Install @ai-sdk/groq

- [x] Run `npm install @ai-sdk/groq` in the project root. *(Deferred: implementer has no Bash tool. `@ai-sdk/groq: "^3.0.0"` added to `package.json` dependencies. User must run `npm install`.)*
- [ ] After install, open `package-lock.json` and verify that `@ai-sdk/groq` and `@ai-sdk/google` both resolve `@ai-sdk/provider` to the same version (currently 3.0.8). If they differ, run `npm dedupe` and check again.
- [x] Verify `package.json` now lists `@ai-sdk/groq` in `dependencies`.

**Done state:** `package.json` has `"@ai-sdk/groq": "^3.x.x"` in dependencies. `package-lock.json` shows a single `@ai-sdk/provider` version shared by both provider packages.

### 2. Update .env.example with new environment variables

- [x] Add the following lines to the end of `.env.example`:

```
# AI Provider Selection (gemini or groq)
# Default: gemini
AI_PROVIDER=gemini

# Groq API Key (required when AI_PROVIDER=groq)
# Get from: https://console.groq.com/keys
GROQ_API_KEY=
```

**Done state:** `.env.example` has entries for both `AI_PROVIDER` and `GROQ_API_KEY` with descriptive comments.

### 3. Create the getModel() factory function

- [x] Create directory `src/lib/ai/` (it does not exist yet).
- [x] Create file `src/lib/ai/model.ts` with the following structure:
  - Import `LanguageModelV3` type from `@ai-sdk/provider`.
  - Import `google` from `@ai-sdk/google`.
  - Import `groq` from `@ai-sdk/groq`.
  - Define a `AIProvider` type: `"gemini" | "groq"`.
  - Define `DEFAULT_PROVIDER` constant set to `"gemini"`.
  - Define `MODEL_MAP` as a `Record<AIProvider, () => LanguageModelV3>` with entries:
    - `gemini`: returns `google("gemini-2.5-flash")`
    - `groq`: returns `groq("llama-3.3-70b-versatile")`
  - Export `getModel()` function that:
    1. Reads `process.env.AI_PROVIDER`, falls back to `DEFAULT_PROVIDER`.
    2. Looks up the provider in `MODEL_MAP`.
    3. If not found, throws `Error` with message listing the invalid value and valid options.
    4. Returns the result of calling the factory function from the map.
- [x] Formatting: use tabs for indentation, double quotes for strings (Biome config).

**Done state:** `src/lib/ai/model.ts` exists, exports `getModel()` with return type `LanguageModelV3`, compiles without TypeScript errors. Running `npx biome check src/lib/ai/model.ts` reports no lint/format issues.

### 4. Refactor the chat route to use getModel()

- [x] In `src/app/api/chat/route.ts`:
  - Remove the import `import { google } from '@ai-sdk/google'`.
  - Add import `import { getModel } from "@/lib/ai/model"`.
  - Replace `model: google('gemini-2.5-flash')` on line 45 with `model: getModel()`.
- [x] No other changes to the route -- the `propagateAttributes` wrapper, `chatRequestSchema` validation, system prompt, and `experimental_telemetry` all remain unchanged.

**Done state:** `src/app/api/chat/route.ts` no longer imports from `@ai-sdk/google`. The `streamText` call uses `getModel()`. The file compiles without TypeScript errors. Running `npx biome check src/app/api/chat/route.ts` reports no lint/format issues.

### 5. Run full lint check

- [ ] Run `npm run lint` (which runs `biome check`) across the project. Fix any issues in the new or modified files. *(Deferred: no Bash tool. User must run this after `npm install`.)*

**Done state:** `npm run lint` exits with code 0.

### 6. Manual verification with both providers

- [ ] Start the dev server with `AI_PROVIDER=gemini` (or unset, to test the default): `npm run dev`.
- [ ] Send a test request:
  ```bash
  curl -X POST http://localhost:3000/api/chat \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"What is conveyancing?"}]}'
  ```
  Verify: a streaming text response is returned.
- [ ] Stop the dev server. Set `AI_PROVIDER=groq` and `GROQ_API_KEY=<valid key>` in `.env.local`. Restart the dev server.
- [ ] Send the same curl request. Verify: a streaming text response is returned (content will differ due to different model).
- [ ] Set `AI_PROVIDER=invalid` in `.env.local`. Restart the dev server. Send the curl request. Verify: the server throws an error with a message containing `Unknown AI_PROVIDER: "invalid"` and listing valid options.

**Done state:** Both providers produce streaming responses. Invalid provider value produces a descriptive error.

## Security

**Known vulnerabilities:** No known CVEs or advisories found for `@ai-sdk/groq` or any recommended libraries as of 2026-04-02.

**Architectural risks:**

- **API key leakage via error messages:** If Groq returns an authentication error, the raw error may contain the API key or request headers in the stack trace. The current route does not catch errors from `streamText` -- this is a pre-existing gap, not introduced by this feature. The risk is mitigated by the fact that `streamText` errors surface as stream errors which Next.js handles with generic 500 responses by default. If a `try/catch` is added to the route in a future feature, it must return generic error messages, not `error.message`.
- **AI_PROVIDER injection:** The factory reads `AI_PROVIDER` only from `process.env`. The factory's validation (throwing on unknown values) is the guard against misconfiguration but is not a security boundary -- the env var is server-side only and cannot be set by client requests.
- **GROQ_API_KEY exposure:** Must be in `.env.local` (gitignored) and Vercel project settings only. Never import `@ai-sdk/groq` or reference `GROQ_API_KEY` in client components. The factory lives in `src/lib/ai/model.ts` which is server-only (imported only by the API route).

## Open Questions

1. **Exact @ai-sdk/groq version number** -- (Resolved: install with `npm install @ai-sdk/groq` without pinning. The package follows the same monorepo versioning as `@ai-sdk/google`. After install, verify `@ai-sdk/provider` deduplication in `package-lock.json`.)

2. **Groq model IDs for free tier** -- (Resolved: the model ID is `llama-3.3-70b-versatile` with no namespace prefix. Groq's API uses plain model IDs, unlike Hugging Face or Together AI. Confirmed via Vercel AI SDK documentation.)

3. **Groq environment variable name** -- (Resolved: `GROQ_API_KEY`. Confirmed via Vercel AI SDK documentation. The `@ai-sdk/groq` provider reads `process.env.GROQ_API_KEY` by default.)

4. **Tool calling reliability on Llama 3.3 70B** -- (Resolved: out of scope for this feature. Tool calling is roadmap section 4. This feature only needs `streamText` to work with both providers. When tool calling is added, behavioral differences between Gemini and Llama should be smoke-tested and documented as interview talking points.)

5. **currentStageOrder missing .notNull()** -- (Resolved: this was flagged by the orchestrator based on a stale review document. The actual schema has `currentStage` (not `currentStageOrder`), which is a `conveyancingStageEnum` column that already has `.default("engagement_and_onboarding").notNull()`. The real code review at `project/reviews/20260330-review-feat-drizzle-neon-data-layer.md` line 118 confirms this field does not exist and the flagged issue was based on planning documents, not actual code. No schema fix is needed.)

## Implementation Discoveries

1. **No Bash tool available in implementer role** -- Step 1 and Step 5 require shell commands (`npm install`, `npm run lint`, `npm run build`). These cannot be run by the implementer. Mitigation: `@ai-sdk/groq: "^3.0.0"` was written directly into `package.json`. The user must run `npm install` before the app can build or lint. After install, the user should also verify `@ai-sdk/provider` deduplication in `package-lock.json` per the plan's Step 1 instructions.

2. **`src/lib/ai/` directory did not exist** -- The plan correctly stated to create it. The directory was implicitly created by writing `src/lib/ai/model.ts`. (Note: Feature #2 memory mentioned `src/lib/ai/telemetry.ts`, but that file was not present on disk at implementation time -- may be pending from Feature #2's npm install step.)

3. **`MODEL_MAP` cast pattern** -- The `provider` variable (raw string from `process.env`) is cast to `AIProvider` for the index lookup. TypeScript would not flag this as unsafe because of the cast, but the runtime `if (!factory)` guard correctly catches invalid values and throws a descriptive error. This is the intended behavior per the plan's Critical section.

4. **Existing route.ts used single quotes** -- The pre-existing code in `src/app/api/chat/route.ts` uses single quotes throughout (lines 8-58). The four lines replaced/added in Step 4 use double quotes (matching Biome config). The rest of the file's pre-existing single-quoted strings were left unchanged to stay within plan scope. If Biome's `npm run lint:fix` is run, it will reformat all strings in the file to double quotes automatically.

## Verification

- [ ] **TypeScript compilation** -- Build check -- `npm run build` completes without type errors in `src/lib/ai/model.ts` or `src/app/api/chat/route.ts` -- Deferred to user (requires `npm install` first)
- [ ] **Lint/format compliance** -- Biome check -- `npm run lint` exits 0 -- Deferred to user (requires `npm install` first)
- [ ] **@ai-sdk/provider deduplication** -- Dependency check -- inspect `package-lock.json` for a single `@ai-sdk/provider` version across both provider packages -- Deferred to user (after `npm install`)
- [ ] **Gemini streaming works** -- Integration (manual) -- start dev server with `AI_PROVIDER=gemini` (or unset), send curl POST to `/api/chat` with a test message, verify streaming text response -- Manual
- [ ] **Groq streaming works** -- Integration (manual) -- start dev server with `AI_PROVIDER=groq` and valid `GROQ_API_KEY`, send same curl request, verify streaming text response -- Manual
- [ ] **Invalid provider throws** -- Error handling (manual) -- set `AI_PROVIDER=invalid`, restart dev server, send curl request, verify descriptive error message -- Manual
- [x] **.env.example updated** -- Documentation check -- verify `AI_PROVIDER` and `GROQ_API_KEY` entries exist with comments -- Done
