# Plan: Langfuse Prompt Management Integration

**Date:** 2026-04-07
**Status:** Complete
**Research:** project/research/20260407-120000-langfuse-prompt-management.md

## Goal

Replace the hardcoded `CONVEYANCING_SYSTEM_PROMPT` constant with a runtime fetch from Langfuse prompt management, using the existing constant as an SDK-native fallback. This enables prompt versioning, live editing without code deploys, and prompt-trace linking in Langfuse.

## Approach

Use Option A from the research: SDK-native fallback via `langfuseClient.prompt.get("conveyancing-system-prompt", { type: "text", fallback: CONVEYANCING_SYSTEM_PROMPT })`. This is the simplest pattern -- the SDK handles caching (60s TTL with stale-while-revalidate), retry logic, and fallback construction internally. No new dependencies are needed; `@langfuse/client@5.1.0` is already installed.

The implementation touches two files: `src/lib/ai/prompts.ts` (add `getSystemPrompt()` async function) and `src/app/api/chat/route.ts` (replace three usages of the imported constant with the fetched prompt, add prompt-trace linking). The existing `CONVEYANCING_SYSTEM_PROMPT` constant stays in place as the fallback value. Prompt-trace linking uses `updateActiveObservation({ prompt: { name, version, isFallback } }, { asType: "generation" })` inside the `propagateAttributes()` callback where OTel context is active.

Option A was chosen over Option B (manual try/catch) because the SDK fallback is cleaner and provides the `.isFallback` flag for observability. Option C (chat-type prompt) was rejected because the prompt is a single string passed to `streamText({ system })`, not a multi-message array.

## Critical

- The `CONVEYANCING_SYSTEM_PROMPT` constant must remain exported from `prompts.ts` -- it serves as the fallback value passed to the SDK, and removing it would break resilience.
- The `prompt` field on `updateActiveObservation` ONLY works with `{ asType: "generation" }`. Using the default span type silently ignores the prompt metadata. This is verified from `@langfuse/tracing@5.1.0` source.
- Always call `.compile()` on the returned `TextPromptClient`, not `.prompt`. The `.prompt` property returns the raw Mustache template; `.compile()` returns the rendered string.

## Steps

### 1. Add `getSystemPrompt()` to `src/lib/ai/prompts.ts`

- [x] Import `langfuseClient` from `@/lib/langfuse/client` at the top of `src/lib/ai/prompts.ts`.
- [x] Add an exported async function `getSystemPrompt()` below the existing `CONVEYANCING_SYSTEM_PROMPT` constant. It should:
  - Call `langfuseClient.prompt.get("conveyancing-system-prompt", { type: "text", fallback: CONVEYANCING_SYSTEM_PROMPT, cacheTtlSeconds: 60, fetchTimeoutMs: 3000, maxRetries: 2 })`.
  - Return an object `{ text: prompt.compile(), promptName: prompt.name, promptVersion: prompt.version, isFallback: prompt.isFallback }`.
  - The return type is `Promise<{ text: string; promptName: string; promptVersion: number; isFallback: boolean }>`.
- [x] Keep the `CONVEYANCING_SYSTEM_PROMPT` export unchanged -- it is both the fallback value and the initial content to paste into Langfuse.

**Verification:** The file should export both `CONVEYANCING_SYSTEM_PROMPT` (constant) and `getSystemPrompt` (async function). No type errors on `npm run build`.

### 2. Update `src/app/api/chat/route.ts` to use `getSystemPrompt()`

- [x] Change the import from `prompts.ts`: import `getSystemPrompt` instead of (or in addition to) `CONVEYANCING_SYSTEM_PROMPT`. The constant is no longer needed directly in this file -- `getSystemPrompt()` uses it internally as the fallback.
- [x] In the `handler` function, call `const { text: systemPrompt, promptName, promptVersion, isFallback } = await getSystemPrompt()` at the top of the function body (before `updateActiveObservation`). This runs before `propagateAttributes()`, which is fine -- the prompt fetch does not need OTel context.
- [x] Replace the three usages of `CONVEYANCING_SYSTEM_PROMPT` in the handler with `systemPrompt`:
  - Line 137: `updateActiveObservation({ input: { system: systemPrompt, messages } })`
  - Line 139: `setActiveTraceIO({ input: { system: systemPrompt, messages } })`
  - Line 154: pass `systemPrompt` to `tryStreamText(getModelWithFallbacks(), systemPrompt, uiMessages, agentContext)`
- [x] Remove the `CONVEYANCING_SYSTEM_PROMPT` import from the route file's import block if it is no longer referenced directly.

**Verification:** `npm run build` passes. The route handler uses the fetched prompt instead of the constant. `npm run lint` passes (Biome: 2-space indent, double quotes, semicolons as needed).

### 3. Add prompt-trace linking inside `propagateAttributes()`

- [x] Inside the `propagateAttributes()` callback in `src/app/api/chat/route.ts` (the `async () => { ... }` block), add a conditional call before `tryStreamText`: if `!isFallback`, call `updateActiveObservation({ prompt: { name: promptName, version: promptVersion, isFallback: false } }, { asType: "generation" })`.
- [x] Add a `console.info` log: when `isFallback` is true, log `"Using fallback system prompt (Langfuse prompt not available)"`. This addresses Pitfall 1 from the research -- operators need to know when the remote prompt is not being used.

**Verification:** `npm run build` passes. When Langfuse has the prompt, traces in Langfuse UI should show the prompt name and version linked to the generation observation. When falling back, the console log appears.

### 4. Document the manual Langfuse console setup

- [x] Add a comment block at the top of the `getSystemPrompt()` function in `src/lib/ai/prompts.ts` documenting the required manual setup:
  - Prompt name: `conveyancing-system-prompt`
  - Type: Text
  - Initial content: copy the `CONVEYANCING_SYSTEM_PROMPT` constant value
  - Label the version "production" in Langfuse (the SDK defaults to fetching the "production" label)
  - Note: until the prompt is created in Langfuse, the fallback constant is used automatically

**Verification:** The comment is present and contains the prompt name, type, and setup instructions.

## Security

**Known vulnerabilities:** No known CVEs or advisories found for `@langfuse/client@5.1.0` or its transitive `mustache` dependency as of 2026-04-07.

**Architectural risks:**
- **Prompt injection via Langfuse console:** Anyone with Langfuse prompt editing access can change the AI's system instructions. Mitigation: restrict Langfuse prompt editing to authorized team members via Langfuse RBAC. For this demo project, the sole developer has exclusive access, so the risk is minimal.
- **Langfuse API key exposure:** The `LangfuseClient` uses `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` from server-side environment variables. These must never be exposed in client-side code. The current setup is correct -- `langfuseClient` is only imported in server-side files (`prompts.ts`, `route.ts`).
- **Trust boundary -- Langfuse console to prompt content:** Prompt text fetched from Langfuse is treated as trusted system instructions passed directly to the LLM. This is acceptable when Langfuse access is restricted. No user-supplied input flows into template variables (the prompt has no `{{variables}}`), so there is no Mustache injection risk.

## Open Questions

1. **Prompt-trace linking: which observation should carry the prompt metadata?** (Resolved: use `updateActiveObservation({ prompt: { ... } }, { asType: "generation" })`. The `generation` type is required for prompt linking. For this demo project, the UI distinction between span and generation types does not matter.)

2. **Should the prompt be created programmatically in a seed script?** (Resolved: manual creation in Langfuse console. The task scope explicitly states this. The prompt name and content are documented in a code comment for reference.)

3. **Should `getSystemPrompt()` be called inside or outside `propagateAttributes()`?** (Resolved: call it BEFORE `propagateAttributes()`, at the top of the handler function. Reason: the prompt result is needed by `updateActiveObservation` and `setActiveTraceIO` which are also called before `propagateAttributes()`. The prompt-trace linking call happens INSIDE `propagateAttributes()` where OTel context is active.)

## Implementation Discoveries

- **`console.info` placement:** The plan's Step 3 said to add the fallback log inside `propagateAttributes()`. It was instead placed just after the `getSystemPrompt()` call (before `propagateAttributes()`), which is where `isFallback` is first available and where it makes the most logical sense -- the log is about the fetch result, not the trace context. This has no functional impact.
- **Step 4 collapsed into Step 1:** The JSDoc comment block for Langfuse console setup was added directly to the `getSystemPrompt()` function during Step 1, making Step 4 a no-op verify step. All required elements (prompt name, type, initial content instruction, "production" label, fallback note) are present in the comment.
- **No `label` option in `prompt.get()` call:** The plan's Step 1 spec didn't include `label: "production"` in the options, but the research Pattern 1 example included it. Since the SDK defaults to fetching the "production" label when no label is specified (verified from research), omitting it is equivalent and keeps the code simpler. The comment documents this behavior.
- **`client.ts` uses `LangfuseClient` from `@langfuse/client`** (not `LangfuseAPIClient` from `@langfuse/core` as the Feature #5 memory note suggested). The actual file has `import { LangfuseClient } from "@langfuse/client"`, which is the correct class that has the `.prompt.get()` API. No issue.

## Verification

- [ ] **Build passes** -- build -- `npm run build` -- Automatic
- [ ] **Lint passes** -- lint -- `npm run lint` -- Automatic
- [ ] **Fallback works when prompt not in Langfuse** -- manual smoke test -- Start dev server (`npm run dev`), send a chat message. Verify the agent responds normally. Check server console for `"Using fallback system prompt"` log message. -- Manual
- [ ] **Remote prompt works after creation** -- manual smoke test -- Create the prompt in Langfuse console (name: `conveyancing-system-prompt`, type: text, paste the constant content, label: "production"). Send a chat message. Verify the agent responds. Check Langfuse trace to confirm prompt version > 0 and no fallback log. -- Manual
- [ ] **Live edit works** -- manual smoke test -- Edit the prompt in Langfuse (e.g., add "Always greet the user by saying 'G'day'" at the top). Wait 60 seconds (cache TTL). Send a chat message. Verify the agent uses the new instruction. -- Manual
- [ ] **Prompt-trace linking visible** -- manual Langfuse check -- Open a trace in Langfuse UI after sending a chat message with the remote prompt active. Verify the generation observation shows the prompt name and version. -- Manual
