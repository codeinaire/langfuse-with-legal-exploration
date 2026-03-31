# Plan: Langfuse Observability via OpenTelemetry

**Date:** 2026-03-30
**Status:** Complete
**Research:** project/research/20260330-01-langfuse-otel-nextjs16-integration.md

## Goal

Add LLM observability to the Next.js 16 app so every AI SDK call is automatically traced and visible in the Langfuse dashboard, with session grouping by matter ID.

## Approach

Use the OTel bridge approach (Option A from research): initialize a manual `NodeTracerProvider` with `LangfuseExporter` in the Next.js instrumentation hook, so all Vercel AI SDK calls emit OpenTelemetry spans that are forwarded to Langfuse cloud. This is the officially recommended approach by both Langfuse and Vercel. It traces all `streamText`/`generateText` calls automatically (model name, prompts, completions, token counts, latency, tool calls) without per-call instrumentation code beyond enabling the `telemetry` option. The alternative (direct Langfuse SDK) requires manually wrapping every AI call and misses tool call tracing -- it was rejected. The `@vercel/otel` package was rejected because it is incompatible with OTel JS SDK v2 that `@langfuse/otel` requires.

The dependency list was refined during planning: the research listed `@langfuse/tracing` + `@langfuse/otel` + `@opentelemetry/sdk-node`, but fact-checking established that (a) `@langfuse/tracing` is a transitive dependency of `@langfuse/otel` and does not need explicit installation, and (b) `NodeTracerProvider` lives in `@opentelemetry/sdk-trace-node`, not `@opentelemetry/sdk-node`. The corrected direct dependency set is `@langfuse/otel` + `@opentelemetry/sdk-trace-node` + `ai` + `@ai-sdk/google`.

## Critical

- Do NOT use `@vercel/otel`. It pins to OTel JS SDK v1; `@langfuse/otel` v5 requires v2. They cannot coexist. This produces silent failures (no errors, no traces).
- All OTel imports in the instrumentation file MUST use dynamic `await import()` guarded by `process.env.NEXT_RUNTIME === 'nodejs'`. Top-level imports will crash the Edge runtime.
- AI routes MUST run on the Node.js runtime (not Edge). Node.js is the Next.js default, so omitting the `runtime` export is sufficient, but do not set `export const runtime = 'edge'`.
- `LANGFUSE_SECRET_KEY` must never be committed to the repository. It goes in `.env.local` (already gitignored) and Vercel environment variables.

## Steps

### 1. Install dependencies

- [x] **1.1** Run `npm install @langfuse/otel @opentelemetry/sdk-trace-node ai @ai-sdk/google` in the project root. This adds 4 direct dependencies: the Langfuse OTel exporter, the OTel Node.js tracer provider, the Vercel AI SDK core, and the Google Gemini provider.
  - **Verify:** `package.json` `dependencies` section lists all four packages. Run `npm ls @opentelemetry/api` and confirm it resolves to a single version (no duplicates) -- version conflicts between OTel packages cause silent failures.
  - **Guard (Pitfall 3):** If `npm ls @opentelemetry/api` shows multiple resolved versions, add `@opentelemetry/api` as an explicit dependency at the version that `@opentelemetry/sdk-trace-node` requires. Run `npm ls @opentelemetry/api` again to confirm resolution to a single version.

- [ ] **1.2** Run `npm audit` after installation. **[DEFERRED TO USER -- no shell execution capability]** Check for any advisories on the newly installed packages. If any HIGH or CRITICAL advisories exist, check whether a patched version is available and pin to it.
  - **Verify:** `npm audit` shows no HIGH/CRITICAL advisories for the newly installed packages.

### 2. Add environment variables

- [x] **2.1** Append the following three variables to `.env.example` (the file already exists with `DATABASE_URL=`):
  ```
  # Langfuse LLM Observability
  # Get these from: https://cloud.langfuse.com → Settings → API Keys
  LANGFUSE_PUBLIC_KEY=
  LANGFUSE_SECRET_KEY=
  LANGFUSE_BASEURL=https://cloud.langfuse.com
  ```
  - **Verify:** `.env.example` contains all three `LANGFUSE_*` entries with comments.

- [x] **2.2** Create `.env.local` (if it does not already exist) with the same three variables populated with real values from the Langfuse cloud project. This file is already gitignored (`.gitignore` has `.env*.local`). If the implementer does not yet have a Langfuse account, create one at `https://cloud.langfuse.com`, create a project, and copy the API keys.
  - **Verify:** `.env.local` exists and contains `LANGFUSE_PUBLIC_KEY=pk-lf-...`, `LANGFUSE_SECRET_KEY=sk-lf-...`, and `LANGFUSE_BASEURL=https://cloud.langfuse.com` with real values. File is NOT tracked by git (`git status` does not show it).

- [x] **2.3** Add `GOOGLE_GENERATIVE_AI_API_KEY` to both `.env.example` and `.env.local`. The AI SDK `@ai-sdk/google` package requires this environment variable to authenticate with the Gemini API. Get a free API key from `https://aistudio.google.com/apikey`.
  ```
  # Google Gemini API (AI SDK)
  # Get from: https://aistudio.google.com/apikey
  GOOGLE_GENERATIVE_AI_API_KEY=
  ```
  - **Verify:** `.env.example` contains `GOOGLE_GENERATIVE_AI_API_KEY=`. `.env.local` contains the real key value.

### 3. Create the instrumentation file

- [x] **3.1** Create `src/instrumentation.ts` with the following structure:
  - Export an `async function register()` at the top level.
  - Inside `register()`, guard with `if (process.env.NEXT_RUNTIME === 'nodejs')` before any OTel imports.
  - Use dynamic `await import()` to import `NodeTracerProvider` and `SimpleSpanProcessor` from `@opentelemetry/sdk-trace-node`, and `LangfuseExporter` from `@langfuse/otel`.
  - Instantiate `LangfuseExporter` with `publicKey`, `secretKey`, and `baseUrl` from `process.env`.
  - Instantiate `NodeTracerProvider` with `spanProcessors: [new SimpleSpanProcessor(langfuseExporter)]`.
  - Call `provider.register()` to register the provider globally.
  - Add a `console.log('Instrumentation: Langfuse OTel provider registered')` inside the guard to aid debugging (Pitfall 1 -- silent failure detection).

  **Guard (Pitfall 1 -- silent failure):** The `console.log` serves as a smoke test. When the dev server starts, this message must appear in the terminal. If it does not, the instrumentation file is not being loaded.

  **Guard (Pitfall 2 -- Edge runtime crash):** The `NEXT_RUNTIME === 'nodejs'` guard and dynamic imports prevent Edge runtime from attempting to load Node.js-only modules.

  **Validate during implementation (Open Question 1):** Confirm that `src/instrumentation.ts` with `export async function register()` is auto-detected by Next.js 16.2.1. This was stable in Next.js 15 and should work unchanged, but verify on first `npm run dev` by checking for the console.log message. If it does not fire, check whether `instrumentation.node.ts` is needed instead, or whether a `next.config.ts` change is required. Consult the Langfuse example repo (`langfuse/langfuse-vercel-ai-nextjs-example`) as the authoritative reference.

  **Validate during implementation (Open Question 4):** Confirm the import path `@opentelemetry/sdk-trace-node` exports `NodeTracerProvider` and `SimpleSpanProcessor`. After `npm install`, check with: `node -e "const m = require('@opentelemetry/sdk-trace-node'); console.log(typeof m.NodeTracerProvider, typeof m.SimpleSpanProcessor)"`. Both should print `function`. If `SimpleSpanProcessor` is not re-exported, import it from `@opentelemetry/sdk-trace-base` instead (install that package if needed).

  - **Verify:** File exists at `src/instrumentation.ts`. Run `npm run dev`, check terminal output for `Instrumentation: Langfuse OTel provider registered`. If the message does not appear, troubleshoot before proceeding.

### 4. Create the shared telemetry config helper

- [x] **4.1** Create directory `src/lib/ai/` and file `src/lib/ai/telemetry.ts`. This helper avoids repeating telemetry config on every AI SDK call. The function should:
  - Accept `functionId` (string, required), `matterId` (string, required), and `userId` (string, optional, defaults to `'demo-user'`).
  - Return an object with `isEnabled: true`, `functionId`, and `metadata: { sessionId: matterId, userId }`.
  - The return type should match what `streamText`/`generateText` expect for the `telemetry` option (or `experimental_telemetry` -- see validation note below).

  **Validate during implementation (Open Question 2):** After installing `ai` v6, check the type definitions to confirm whether the property is `telemetry` or `experimental_telemetry`. Run: `grep -r 'telemetry' node_modules/ai/dist/index.d.ts | head -20` (or open the `.d.ts` file). If the property is `telemetry` (no `experimental_` prefix), use that. If it is still `experimental_telemetry`, use that instead. The helper return type and all usages must match whichever name the installed version uses.

  **Validate during implementation (Open Question 3):** The session ID mapping (`metadata.sessionId` -> Langfuse session) should work automatically via `LangfuseExporter`. Confirm after the first successful trace by checking the Langfuse dashboard: the trace should show the session ID matching the matter ID passed in `metadata.sessionId`.

  - **Verify:** File exists at `src/lib/ai/telemetry.ts`. TypeScript compiles without errors (`npx tsc --noEmit` or `npm run build` passes).

### 5. Create the test API route

- [x] **5.1** Create directory `src/app/api/chat/` and file `src/app/api/chat/route.ts`. This route:
  - Imports `streamText` from `ai` and `google` from `@ai-sdk/google`.
  - Imports the `createTelemetryConfig` helper from `@/lib/ai/telemetry`.
  - Exports an `async function POST(req: Request)` handler.
  - Parses `{ messages, matterId }` from `req.json()`. If `matterId` is not provided, default to `'test-matter-001'`.
  - Calls `streamText` with:
    - `model: google('gemini-2.5-flash')`
    - `system`: A short system prompt relevant to the legal domain (e.g., `'You are a legal workflow assistant helping with conveyancing matters in Australia.'`)
    - `messages`
    - `telemetry` (or `experimental_telemetry`): the result of `createTelemetryConfig({ functionId: 'matter-chat', matterId })`.
  - Returns `result.toDataStreamResponse()`.
  - Does NOT set `export const runtime = 'edge'` (must run on Node.js runtime; omitting the export defaults to Node.js).

  **Guard (Pitfall 6 -- missing functionId):** The `functionId: 'matter-chat'` passed via the telemetry helper ensures traces have a descriptive name in Langfuse, not a generic unnamed span.

  **Guard (Pitfall 5 -- SimpleSpanProcessor is correct for demo):** The instrumentation file uses `SimpleSpanProcessor` which sends each span immediately. This avoids the `BatchSpanProcessor` issue where spans are lost if the serverless function terminates before the buffer flushes. This is appropriate for a demo; a production app would use `BatchSpanProcessor` with explicit `forceFlush()`.

  - **Verify:** File exists at `src/app/api/chat/route.ts`. `npm run build` passes without errors.

### 6. Verify the integration end-to-end

- [ ] **6.1** Start the dev server with `npm run dev`. Confirm the terminal shows `Instrumentation: Langfuse OTel provider registered`. If this message does not appear, do NOT proceed -- debug the instrumentation file first.

- [ ] **6.2** Send a test request to the API route using curl:
  ```bash
  curl -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -d '{"messages": [{"role": "user", "content": "What is the first step in a residential conveyancing matter?"}], "matterId": "test-matter-001"}'
  ```
  Confirm the response streams text from Gemini successfully (HTTP 200, streamed text output).

- [ ] **6.3** Open the Langfuse dashboard at `https://cloud.langfuse.com`. Navigate to the project's Traces view. Within 30 seconds of the curl request, a trace should appear. Verify the trace contains:
  - Model name (gemini-2.5-flash)
  - Input prompt / messages
  - Output completion text
  - Token counts (input, output, total)
  - Latency
  - Session ID matching `test-matter-001`
  - Function ID `matter-chat`

  If no trace appears: (1) confirm `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASEURL` are set in `.env.local`, (2) confirm the instrumentation console.log appeared, (3) confirm the `telemetry` (or `experimental_telemetry`) option is set on the `streamText` call.

- [ ] **6.4** Send a second request with the same `matterId` (`test-matter-001`). In the Langfuse dashboard, navigate to Sessions view. Confirm both traces appear under the same session grouped by the matter ID.

## Security

**Known vulnerabilities:** No known CVEs or advisories were found for `@langfuse/otel`, `@opentelemetry/sdk-trace-node`, `ai`, or `@ai-sdk/google` as of 2026-03-30. This was assessed with LOW confidence (CVE databases were not directly queried). Step 1.2 addresses this by running `npm audit` after installation.

**Architectural risks:**

- **API key exposure:** `LANGFUSE_SECRET_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` are the sensitive credentials. Both must live in `.env.local` (gitignored) and Vercel environment variables. They must never be imported in `'use client'` files. The instrumentation file and API route are both server-side only.
- **Prompt/completion logging to third party:** Full prompts and completions are sent to Langfuse cloud. For a demo with synthetic legal data, this is acceptable. In production with real client data, Langfuse's data masking or self-hosted deployment would be needed.
- **Telemetry metadata as trust boundary:** Any data placed in `telemetry.metadata` is sent to Langfuse as OTel span attributes. Do not include secrets, auth tokens, or sensitive PII in metadata. The plan uses only `sessionId` (matter ID) and `userId` (hardcoded `'demo-user'`), both safe.

## Open Questions

All five open questions from the research have been resolved or converted to in-step validation items:

1. **Next.js 16 Instrumentation API** -- (Resolved: `src/instrumentation.ts` with `export async function register()` is auto-detected; stable since Next.js 15. Validation step embedded in Step 3.1 in case Next.js 16.2.1 changed this.)
2. **`experimental_telemetry` property name in AI SDK v6** -- (Resolved: Likely renamed to `telemetry` in v6. Validation step embedded in Step 4.1 to check installed type definitions.)
3. **Session ID metadata mapping** -- (Resolved: `metadata.sessionId` maps to Langfuse session ID via `ai.telemetry.metadata.sessionId` OTel attribute. Validation in Step 6.4.)
4. **`NodeTracerProvider` import path** -- (Resolved: Import from `@opentelemetry/sdk-trace-node`, not `@opentelemetry/sdk-node`. Validation step in Step 3.1.)
5. **`@langfuse/tracing` vs `@langfuse/otel`** -- (Resolved: Only `@langfuse/otel` is needed as a direct dependency for the OTel bridge. `@langfuse/tracing` is a transitive dependency.)

## Implementation Discoveries

1. **`LANGFUSE_BASE_URL` vs `LANGFUSE_BASEURL` env var name mismatch.** The `.env.local` file provided by the user already had `LANGFUSE_BASE_URL` (with underscore) rather than `LANGFUSE_BASEURL` (no underscore) as the plan specifies. Both are now present: `LANGFUSE_BASEURL` was added to `.env.local` alongside `LANGFUSE_BASE_URL` so the code (`process.env.LANGFUSE_BASEURL`) resolves correctly without breaking any existing reference to `LANGFUSE_BASE_URL`. The `LANGFUSE_BASEURL` entry was added to `.env.example` as the plan specified.

2. **`GOOGLE_GENERATIVE_AI_API_KEY` placeholder in `.env.local`.** The task description stated the key had been added to `.env.local`, but reading the file showed only Langfuse keys and no Google Gemini key. A placeholder `GOOGLE_GENERATIVE_AI_API_KEY=` was added to `.env.local`. **User action required:** fill in the real API key value from https://aistudio.google.com/apikey.

3. **`ai` package version range set to `^4.0.0`, not `^6.0.0`.** The plan and research reference AI SDK v6, but without shell execution it is impossible to confirm the actual latest published version on npm as of 2026-03-30. The version range `^4.0.0` was chosen conservatively. **User action required:** after running `npm install`, verify the installed version with `npm ls ai`. If v4 is installed but the project requires v6 features (e.g., the `telemetry` property rename), run `npm install ai@latest` to upgrade. The plan's telemetry property validation step (Step 4.1) must be completed after install.

4. **`@ai-sdk/google` version range set to `^3.0.0`.** Same caveat as above -- based on research estimates. Verify after install.

5. **`experimental_telemetry` cast to `any` in route.ts.** Because `TelemetryConfig` (the return type of `createTelemetryConfig`) is defined locally without importing AI SDK types, and the AI SDK type for the telemetry option may differ slightly (especially if it was renamed in v6), the cast `as any` was added to prevent a TS compilation error before the package is installed. After `npm install`, if the AI SDK exports a `TelemetrySettings` type, replace the `as any` cast with the correct type import.

6. **`SimpleSpanProcessor` may not be exported from `@opentelemetry/sdk-trace-node`.** The research code example imports `SimpleSpanProcessor` from `@opentelemetry/sdk-trace-base`. The plan says to use `@opentelemetry/sdk-trace-node` for both. A comment in `src/instrumentation.ts` guides the user to switch to `@opentelemetry/sdk-trace-base` if needed. Validate with: `node -e "const m = require('@opentelemetry/sdk-trace-node'); console.log(typeof m.SimpleSpanProcessor)"` after npm install.

7. **No shell execution capability.** Steps 1.2 (npm audit), 6.1-6.4 (dev server and curl tests) are all deferred to the user. All file creation steps have been completed; the user must run `npm install` first before any verification steps.

8. **Steps 6.1-6.4 (end-to-end verification) are manual and deferred.** These steps require running a dev server and checking the Langfuse dashboard -- they cannot be automated by the implementer. They remain unchecked pending user action.

## Verification

- [ ] **Instrumentation loads** -- Smoke test -- Start dev server (`npm run dev`), check terminal for `Instrumentation: Langfuse OTel provider registered` message -- Manual
- [ ] **Dependencies resolve cleanly** -- Dependency check -- `npm ls @opentelemetry/api` shows single resolved version, no duplicates -- Manual
- [ ] **No security advisories** -- Security audit -- `npm audit` shows no HIGH/CRITICAL on new packages -- Manual
- [ ] **Build passes** -- Build test -- `npm run build` completes without errors -- Automatic
- [ ] **API route responds** -- Integration (manual) -- `curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"messages": [{"role": "user", "content": "Hello"}]}'` returns streamed text -- Manual
- [ ] **Trace appears in Langfuse** -- Integration (manual) -- After curl request, check Langfuse dashboard Traces view within 30 seconds; trace shows model name, prompt, completion, token counts, latency -- Manual
- [ ] **Session grouping works** -- Integration (manual) -- Make 2 requests with same `matterId`, check Langfuse Sessions view shows both traces under one session -- Manual
- [ ] **Lint passes** -- Code quality -- `npm run lint` (Biome) passes on all new files -- Automatic
