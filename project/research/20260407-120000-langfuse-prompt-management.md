# Langfuse Prompt Management Integration - Research

**Researched:** 2026-04-07
**Domain:** Langfuse prompt management SDK (@langfuse/client v5.1.0), runtime prompt fetching with caching and fallback
**Confidence:** HIGH

## Summary

The `@langfuse/client` package (v5.1.0, already installed) provides a fully-featured prompt management system via `langfuseClient.prompt.get()`. It supports text and chat prompt types, built-in in-memory caching with a 60-second default TTL, SDK-native fallback strings, Mustache-style `{{variable}}` template compilation, and automatic stale-while-revalidate cache refresh. The system is designed specifically for the use case described: fetch a managed prompt at runtime, fall back to a hardcoded default on failure.

The existing project has a single `CONVEYANCING_SYSTEM_PROMPT` constant (74-line text string, no template variables) used in two places in the chat route handler. Replacing it with a runtime fetch requires: (1) calling `langfuseClient.prompt.get()` with a fallback, (2) using `.compile()` on the result (even without variables, to get the string), and (3) optionally linking the prompt version to the Langfuse trace via OTel span attributes. The SDK handles caching, retries, and fallback construction internally -- no custom caching logic is needed.

**Primary recommendation:** Use `langfuseClient.prompt.get("conveyancing-system-prompt", { type: "text", fallback: CONVEYANCING_SYSTEM_PROMPT })` with the existing hardcoded constant as the SDK-native fallback. The SDK returns a `TextPromptClient` with `.compile()` to get the string, and `.isFallback` to know if the fetch failed.

## Standard Stack

### Core

| Library | Version | Purpose | License | Maintained? | Why Standard |
| --- | --- | --- | --- | --- | --- |
| @langfuse/client | 5.1.0 | Prompt management, scoring, datasets | MIT | Yes (active) | Already installed; official Langfuse JS client for v5 package split |
| @langfuse/tracing | 5.1.0 | OTel-based tracing (observe, updateActiveObservation) | MIT | Yes (active) | Already installed; provides prompt-trace linking via OTel span attributes |

### Supporting

| Library | Version | Purpose | When to Use |
| --- | --- | --- | --- |
| mustache | ^4.2.0 | Template variable substitution in prompts | Transitive dependency of @langfuse/client -- used internally by `.compile()`, no direct import needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
| --- | --- | --- |
| SDK-native `fallback` param | Manual try/catch with local constant | SDK fallback is cleaner, sets `.isFallback = true` on the returned client, and handles retry logic internally. Manual try/catch only makes sense if you need custom retry logic. |
| `type: "text"` prompt | `type: "chat"` prompt | Chat prompts return an array of `{role, content}` messages. For a system prompt that's a single string passed to `streamText({ system })`, text type is the correct fit. Chat type would require extracting the content from the first message. |
| `cacheTtlSeconds` (default 60s) | `cacheTtlSeconds: 0` (no cache) | Disabling cache means every request hits the Langfuse API. The default 60s TTL with stale-while-revalidate is appropriate for a system prompt that changes rarely. |

**Installation:**
```bash
# Already installed -- no new dependencies needed
# @langfuse/client@5.1.0 is in package.json
```

## Architecture Options

### Option A: SDK-native fallback (recommended)

Pass the hardcoded prompt as the `fallback` option to `prompt.get()`. The SDK handles all error cases internally.

| Aspect | Detail |
| --- | --- |
| Description | Use `prompt.get(name, { type: "text", fallback: HARDCODED_PROMPT })` |
| Pros | Zero custom error handling; `.isFallback` flag on response; SDK manages retries; cache still works for future calls |
| Cons | Cannot distinguish between "Langfuse is down" vs "prompt doesn't exist yet" -- both trigger fallback silently |
| Best When | You want production resilience with minimal code |

### Option B: Manual try/catch with separate fallback

Wrap `prompt.get()` in a try/catch and return the hardcoded constant on any error.

| Aspect | Detail |
| --- | --- |
| Description | `try { prompt = await langfuseClient.prompt.get(name) } catch { prompt = HARDCODED_PROMPT }` |
| Pros | Full control over error handling; can log different error types differently; can distinguish "not found" from "network error" |
| Cons | More code; duplicates what the SDK already does; must manually construct the prompt string from the constant |
| Best When | You need granular error reporting or different fallback behavior per error type |

### Option C: Chat-type prompt with role extraction

Store the system prompt as a `type: "chat"` prompt in Langfuse, with a single `{role: "system", content: "..."}` message.

| Aspect | Detail |
| --- | --- |
| Description | Use `prompt.get(name, { type: "chat" })` and extract `compiled[0].content` |
| Pros | Matches the mental model of "system message"; could later add few-shot examples as additional messages |
| Cons | Extra extraction step; fallback must be `ChatMessage[]` not a string; more complex for a single system prompt |
| Best When | You plan to evolve toward multi-message prompts with few-shot examples |

**Recommended:** Option A -- SDK-native fallback. It's the simplest, most resilient pattern and the SDK was designed for this exact use case. The `.isFallback` flag provides observability without custom error handling.

### Counterarguments

Why someone might NOT choose Option A:

- **"We need to know WHY the fallback triggered":** The SDK logs warnings internally but doesn't expose the error to the caller. **Response:** You can check `prompt.isFallback` and log it. For debugging, set `LANGFUSE_DEBUG=true` to get SDK-level error logs. In production, the important thing is that the system keeps working, not the specific Langfuse error.
- **"What if the prompt doesn't exist in Langfuse yet?":** On first deploy, before anyone creates the prompt in the Langfuse console, every request will use the fallback. **Response:** This is fine -- it's the expected bootstrap behavior. The hardcoded prompt is the same one being used today. Create the prompt in Langfuse when ready; the SDK will pick it up within 60 seconds (cache TTL).

## Architecture Patterns

### Recommended Project Structure

```
src/
  lib/
    ai/
      prompts.ts        # Keep CONVEYANCING_SYSTEM_PROMPT as fallback constant
                        # Add getSystemPrompt() async function that fetches from Langfuse
    langfuse/
      client.ts         # Existing singleton (unchanged)
  app/
    api/
      chat/
        route.ts        # Import getSystemPrompt() instead of the constant directly
```

### Pattern 1: Prompt Fetching with SDK-Native Fallback

**What:** Async function that fetches the prompt from Langfuse with the hardcoded constant as fallback.

**When to use:** Every time you need the system prompt at runtime.

**Example:**
```typescript
// Source: Verified from @langfuse/client@5.1.0 node_modules (index.d.ts + index.mjs)

import { langfuseClient } from "@/lib/langfuse/client"

// Keep as fallback AND as the initial version to paste into Langfuse console
export const CONVEYANCING_SYSTEM_PROMPT = `...existing 74-line prompt...`

export async function getSystemPrompt(): Promise<{
  text: string
  promptName: string
  promptVersion: number
  isFallback: boolean
}> {
  const prompt = await langfuseClient.prompt.get(
    "conveyancing-system-prompt",
    {
      type: "text",
      fallback: CONVEYANCING_SYSTEM_PROMPT,
      label: "production",     // fetches the version labeled "production"
      cacheTtlSeconds: 60,     // default; explicit for clarity
      fetchTimeoutMs: 3000,    // don't block the request for too long
      maxRetries: 2,           // retry twice on transient failures
    }
  )

  return {
    text: prompt.compile(),          // no variables needed, returns the string
    promptName: prompt.name,
    promptVersion: prompt.version,
    isFallback: prompt.isFallback,
  }
}
```

### Pattern 2: Prompt-Trace Linking via OTel Span Attributes

**What:** After fetching the prompt, set the prompt name and version on the active observation so Langfuse links the trace to the prompt version.

**When to use:** When you want Langfuse to show which prompt version was used in a given trace.

**Example:**
```typescript
// Source: Verified from @langfuse/tracing@5.1.0 node_modules

import { updateActiveObservation } from "@langfuse/tracing"

// After fetching the prompt:
const { text, promptName, promptVersion, isFallback } = await getSystemPrompt()

// Link the prompt version to the trace observation (only if not fallback)
if (!isFallback) {
  updateActiveObservation(
    {
      prompt: {
        name: promptName,
        version: promptVersion,
        isFallback: false,
      },
    },
    { asType: "generation" }
  )
}
```

**IMPORTANT:** The `prompt` field in observation attributes is ONLY available on `LangfuseGenerationAttributes` (i.e., `{ asType: "generation" }`). It is NOT available on `LangfuseSpanAttributes` (the default). The current chat route uses `updateActiveObservation({ input: ... })` without `asType`, which means it writes span-type attributes. Setting `prompt` on a span-type observation will be silently ignored.

The underlying mechanism: `createObservationAttributes()` in `@langfuse/tracing` only maps the `prompt` field to OTel attributes `langfuse.observation.prompt.name` and `langfuse.observation.prompt.version` when it's present AND `prompt.isFallback` is false.

### Pattern 3: Using Labels for Environment-Based Prompt Selection

**What:** Use Langfuse prompt labels ("production", "staging", "latest") to control which prompt version is served.

**When to use:** When you want to test new prompt versions before deploying them to production.

**Example:**
```typescript
// Source: Verified from @langfuse/client@5.1.0 prompt cache key generation

// Default: fetches the "production" label (SDK default when no label/version specified)
const prodPrompt = await langfuseClient.prompt.get("conveyancing-system-prompt")

// Explicit label:
const stagingPrompt = await langfuseClient.prompt.get("conveyancing-system-prompt", {
  label: "staging",
})

// Pin to a specific version (ignores labels):
const v3Prompt = await langfuseClient.prompt.get("conveyancing-system-prompt", {
  version: 3,
})
```

**Cache key structure** (verified from source): `"{name}-label:{label}"` or `"{name}-version:{version}"`. When neither label nor version is specified, the cache key defaults to `"{name}-label:production"`.

### Anti-Patterns to Avoid

- **Caching the prompt yourself:** The SDK has a built-in in-memory cache with stale-while-revalidate. Adding another cache layer (e.g., in a module-level variable) creates staleness bugs and defeats the purpose of runtime prompt management.
- **Calling `.prompt` property instead of `.compile()`:** The `.prompt` property on `TextPromptClient` gives the raw template string with `{{variable}}` placeholders un-rendered. Always call `.compile()` even if you have no variables -- it runs Mustache rendering and returns the final string. (Mustache configured with `escape = identity`, so no HTML escaping occurs.)
- **Using `prompt.get()` without fallback in a request handler:** If Langfuse is unreachable and there's no fallback, `prompt.get()` throws. This would 500 the user's request. Always provide a fallback.
- **Setting `prompt` on a span-type observation:** The `prompt` field only maps to OTel attributes on `generation`-type observations. Setting it via `updateActiveObservation({ prompt: ... })` without `{ asType: "generation" }` does nothing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
| --- | --- | --- | --- |
| Prompt caching | Module-level `let cachedPrompt` with manual TTL | SDK built-in cache (`cacheTtlSeconds`) | SDK handles stale-while-revalidate, concurrent refresh deduplication, and cache key management |
| Prompt fallback | try/catch around fetch with manual constant return | `prompt.get(name, { fallback: constant })` | SDK constructs a proper `TextPromptClient` from the fallback with `.isFallback = true`, `.version = 0`, etc. |
| Template rendering | String `.replace()` for `{{variable}}` | `prompt.compile({ key: "value" })` | SDK uses Mustache with HTML escaping disabled; handles edge cases around JSON-in-templates |
| Prompt-trace linking | Manual OTel attribute setting | `updateActiveObservation({ prompt: { name, version, isFallback } }, { asType: "generation" })` | SDK maps to the correct `langfuse.observation.prompt.name` and `.version` attributes |

## Common Pitfalls

### Pitfall 1: Prompt Not Found on First Deploy

**What goes wrong:** Before anyone creates the prompt in the Langfuse console, `prompt.get()` returns the fallback on every request. This is expected behavior but can confuse debugging.
**Why it happens:** The prompt must exist in Langfuse before it can be fetched. The SDK treats "not found" the same as "network error" when a fallback is provided.
**How to avoid:** (1) Document that the prompt must be created in Langfuse as a setup step. (2) Log when `prompt.isFallback` is true so operators know the remote prompt isn't being used. (3) Consider creating the prompt programmatically via `langfuseClient.prompt.create()` as a seed/setup script.

### Pitfall 2: Cache Returns Stale Prompt After Langfuse Update

**What goes wrong:** You update the prompt in Langfuse, but the running server keeps using the old version for up to 60 seconds.
**Why it happens:** The SDK caches prompts for `cacheTtlSeconds` (default 60). After expiry, it serves the stale version while refreshing in the background (stale-while-revalidate pattern). This means the old prompt can be served for up to 2x the TTL (60s stale cache + 60s until next refresh check).
**How to avoid:** This is by design and usually acceptable. If you need faster updates, reduce `cacheTtlSeconds` (but this increases Langfuse API calls). Setting `cacheTtlSeconds: 0` disables caching entirely.

### Pitfall 3: Prompt Labels vs Versions

**What goes wrong:** You create version 2 of a prompt in Langfuse, but the app still fetches version 1.
**Why it happens:** When fetching by label (or with no label/version specified), the SDK fetches the version that has the "production" label. Creating a new version does NOT automatically move the "production" label to it.
**How to avoid:** After creating and testing a new prompt version in Langfuse, explicitly assign the "production" label to it in the Langfuse console. Only then will the SDK start serving it.

### Pitfall 4: `updateActiveObservation` asType Mismatch

**What goes wrong:** You set `prompt: { name, version, isFallback }` on the observation, but Langfuse doesn't show the prompt link on the trace.
**Why it happens:** The `prompt` field is only recognized in `LangfuseGenerationAttributes`. The current code uses `updateActiveObservation({ input: ... })` without `asType`, which defaults to `"span"`. Span attributes do not include prompt linking.
**How to avoid:** When setting prompt metadata, use `updateActiveObservation({ prompt: { ... } }, { asType: "generation" })`. Note: this also sets the observation type to "generation" on that span, which changes how it appears in Langfuse UI. If this is undesirable, you can set the raw OTel attributes directly on the span instead.

### Pitfall 5: HTML Escaping in Compiled Prompts

**What goes wrong:** Template variables containing `<`, `>`, `&` characters get HTML-escaped in the compiled output.
**Why it happens:** Mustache's default behavior is to HTML-escape rendered values.
**How to avoid:** The SDK already disables Mustache's HTML escaping (`mustache.escape = function(text) { return text; }`). This was verified in the source code. No action needed -- just be aware that this is a deliberate SDK choice, not a bug.

## Security

### Known Vulnerabilities

No known CVEs or advisories found for recommended libraries as of 2026-04-07.

| Library | CVE / Advisory | Severity | Status | Action |
| --- | --- | --- | --- | --- |
| @langfuse/client@5.1.0 | none found | -- | -- | Monitor |
| mustache@4.2.0 | none found | -- | -- | Transitive dep; monitor |

### Architectural Security Risks

| Risk | Affected Architecture Options | How It Manifests | Secure Pattern | Anti-Pattern to Avoid |
| --- | --- | --- | --- | --- |
| Prompt injection via Langfuse console | All options | A Langfuse user with prompt editing access could inject malicious system prompt content (e.g., instructions to ignore safety guidelines) | Restrict Langfuse prompt editing to authorized team members; use Langfuse's role-based access control | Giving broad team access to production prompt editing without review |
| Secrets in prompt templates | Options with `{{variable}}` | If template variables contain API keys, tokens, or PII, they would be logged in Langfuse traces | Never pass secrets as template variables; secrets should be injected server-side outside the prompt | `prompt.compile({ apiKey: process.env.SECRET })` |
| Langfuse API key exposure | All options | The `LangfuseClient` uses `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` env vars; if these leak, an attacker could read/modify prompts | Keep keys in server-side env vars only; never expose in client bundles | Importing @langfuse/client in client-side code |

### Trust Boundaries

- **Langfuse console -> prompt content:** The prompt text fetched from Langfuse is treated as trusted system instructions. Anyone with Langfuse prompt editing access can change the AI's behavior. Validation: restrict editing access via Langfuse RBAC.
- **User messages -> template variables:** If the prompt ever uses `{{variable}}` with user-supplied input, the user could inject Mustache template syntax. Current state: the prompt has no variables, so this is not an active risk. If variables are added later, sanitize user input before passing to `.compile()`.

## Performance

| Metric | Value / Range | Source | Notes |
| --- | --- | --- | --- |
| Cache TTL (default) | 60 seconds | @langfuse/client source code (`DEFAULT_PROMPT_CACHE_TTL_SECONDS = 60`) | In-memory Map-based cache per LangfuseClient instance |
| Cold fetch latency | ~100-500ms | Langfuse Cloud API (estimated) | First request or after cache miss; depends on network to cloud.langfuse.com |
| Cached fetch latency | ~0ms (sync Map.get) | @langfuse/client source code | Returns cached `TextPromptClient` instance directly |
| Stale-while-revalidate | Yes | @langfuse/client source code (lines 1538-1554) | Expired cache serves stale value while background refresh runs |
| Concurrent refresh deduplication | Yes | @langfuse/client source code (`_refreshingKeys` Map) | Multiple concurrent `prompt.get()` calls share a single refresh promise |
| Prompt payload size | ~2-5KB | Estimated for 74-line system prompt | Negligible network overhead |

## Code Examples

### Complete Integration (Verified API Signatures)

```typescript
// Source: @langfuse/client@5.1.0 node_modules/dist/index.d.ts

// prompt.get() overload for text type:
get(name: string, options?: {
  version?: number;
  label?: string;
  cacheTtlSeconds?: number;
  fallback?: string;            // string for text type
  maxRetries?: number;
  type?: "text";
  fetchTimeoutMs?: number;
}): Promise<TextPromptClient>;

// TextPromptClient properties and methods:
class TextPromptClient extends BasePromptClient {
  readonly name: string;
  readonly version: number;
  readonly config: unknown;
  readonly labels: string[];
  readonly tags: string[];
  readonly isFallback: boolean;
  readonly type: "text" | "chat";
  readonly prompt: string;              // raw template string
  compile(variables?: Record<string, string>): string;  // rendered string
}
```

### Minimal Integration Example

```typescript
// Source: @langfuse/client@5.1.0 verified API surface

import { langfuseClient } from "@/lib/langfuse/client"
import { CONVEYANCING_SYSTEM_PROMPT } from "@/lib/ai/prompts"

const prompt = await langfuseClient.prompt.get("conveyancing-system-prompt", {
  type: "text",
  fallback: CONVEYANCING_SYSTEM_PROMPT,
})

const systemPromptText = prompt.compile()  // string
// prompt.isFallback === true if Langfuse fetch failed
// prompt.version === 0 if using fallback
// prompt.name === "conveyancing-system-prompt"
```

### Cache Behavior (Verified from Source)

```typescript
// Source: @langfuse/client@5.1.0 src/prompt/promptCache.ts

// Cache key format:
// "{name}-label:{label}" or "{name}-version:{version}"
// Default (no label/version): "{name}-label:production"

// Cache flow:
// 1. No cache entry: fetch from API, cache result, return
// 2. Fresh cache entry (< TTL): return immediately from cache
// 3. Expired cache entry (> TTL): return stale, trigger background refresh
// 4. cacheTtlSeconds: 0: always fetch from API (bypass cache)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
| --- | --- | --- | --- |
| `langfuse.getPrompt()` (method on LangfuseClient) | `langfuse.prompt.get()` (via PromptManager) | v5.0.0 (2025) | Old method still exists as deprecated alias; new namespace pattern is the canonical API |
| Monolithic `langfuse` package | Split into @langfuse/client, @langfuse/tracing, @langfuse/otel, @langfuse/core | v5.0.0 (2025) | Prompt management lives in @langfuse/client; tracing in @langfuse/tracing |
| `prompt.getLangchainPrompt()` for variable syntax | Direct `prompt.compile()` for any framework | v5.0.0 | LangChain-specific method still available but not needed for Vercel AI SDK |

**Deprecated/outdated:**

- `langfuseClient.getPrompt()`: Deprecated alias for `langfuseClient.prompt.get()`. Still works but should use the namespace form.
- `langfuseClient.createPrompt()`: Deprecated alias for `langfuseClient.prompt.create()`.

## Validation Architecture

### Test Framework

| Property | Value |
| --- | --- |
| Framework | vitest@4.1.4 |
| Config file | `vitest.config.ts` (exists, configured with `@` alias) |
| Quick run command | `npm test` (runs `vitest run`) |
| Full suite command | `npm test` |

### Requirements -> Test Map

| Requirement | Behavior | Test Type | Automated Command | File Exists? |
| --- | --- | --- | --- | --- |
| Fetch prompt from Langfuse | `getSystemPrompt()` returns text from Langfuse when available | unit (mock langfuseClient) | `npx vitest run src/lib/ai/prompts.test.ts` | No -- needs creating |
| Fallback to hardcoded on fetch failure | `getSystemPrompt()` returns CONVEYANCING_SYSTEM_PROMPT when Langfuse is down | unit (mock langfuseClient to throw) | `npx vitest run src/lib/ai/prompts.test.ts` | No -- needs creating |
| isFallback flag propagation | `getSystemPrompt()` returns `isFallback: true` when using fallback | unit (mock langfuseClient) | `npx vitest run src/lib/ai/prompts.test.ts` | No -- needs creating |
| Prompt text used in streamText | Chat route passes fetched prompt text to `streamText({ system })` | integration (mock both langfuse + AI SDK) | `npx vitest run src/app/api/chat/route.test.ts` | No -- needs creating |
| Prompt version in trace metadata | When prompt is not fallback, observation attributes include prompt name/version | unit (mock tracing) | `npx vitest run src/lib/ai/prompts.test.ts` | No -- needs creating |
| Compile without variables | `prompt.compile()` returns the full prompt text without variable substitution | unit | `npx vitest run src/lib/ai/prompts.test.ts` | No -- needs creating |

### Gaps (files to create before implementation)

- [ ] `src/lib/ai/prompts.test.ts` -- covers prompt fetching, fallback, isFallback flag, compile behavior
- [ ] Potentially `src/app/api/chat/route.test.ts` -- covers integration of fetched prompt into the chat handler (this may be complex due to streaming; could be deferred)

## Open Questions

1. **Prompt-trace linking: which observation should carry the prompt metadata?**
   - What we know: The `prompt` field only works on `generation`-type observations. The current `updateActiveObservation({ input: ... })` in the route handler uses the default `span` type.
   - What's unclear: Should the implementer change the observation type to `generation` (which changes how it appears in Langfuse UI), or set the raw OTel attributes directly (`langfuse.observation.prompt.name`, `langfuse.observation.prompt.version`) on the span?
   - Recommendation: The planner should decide based on how the Langfuse UI is being used. If the team relies on the generation/span type distinction for filtering, use raw OTel attributes. If not, `asType: "generation"` is simpler.

2. **Should the prompt be created programmatically in a seed script?**
   - What we know: The SDK supports `langfuseClient.prompt.create()` to create prompts programmatically. The prompt must exist in Langfuse before it can be fetched (otherwise fallback is used).
   - What's unclear: Is it acceptable to manually create the prompt in the Langfuse console, or should there be a script (like the existing `db:seed`) that creates/upserts it?
   - Recommendation: For a demo project, manual creation in the console is fine. Document the prompt name and initial content. A seed script is nice-to-have but not blocking.

3. **Should `getSystemPrompt()` be called inside or outside `propagateAttributes()`?**
   - What we know: The prompt fetch is an async operation. If called inside `propagateAttributes()`, it runs within the OTel trace context. If called outside, it runs before the trace starts.
   - What's unclear: Whether the prompt fetch latency should be visible in the trace (inside) or not (outside). Also, if called inside, the OTel span is active and `updateActiveObservation` can set prompt metadata.
   - Recommendation: Call it inside `propagateAttributes()` so the prompt fetch latency is visible in traces and the OTel context is available for prompt-trace linking.

## Sources

### Primary (HIGH confidence)

- [@langfuse/client@5.1.0 type definitions](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/client/dist/index.d.ts) -- Complete API surface: LangfuseClient, PromptManager, TextPromptClient, ChatPromptClient, BasePromptClient. All method signatures, overloads, and JSDoc verified.
- [@langfuse/client@5.1.0 source code](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/client/dist/index.mjs) -- Implementation details: prompt cache (DEFAULT_PROMPT_CACHE_TTL_SECONDS = 60, LangfusePromptCache, stale-while-revalidate logic), PromptManager.get() fallback construction, Mustache escape override, compile() implementation.
- [@langfuse/tracing@5.1.0 source code](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/tracing/dist/index.mjs) -- Prompt-trace linking: `createObservationAttributes()` maps `prompt.name` and `prompt.version` to OTel attributes only when `prompt.isFallback` is false. Verified the `prompt` field is ONLY in `LangfuseGenerationAttributes`, not `LangfuseSpanAttributes`.
- [@langfuse/core@5.1.0 type definitions](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/node_modules/@langfuse/core/dist/index.d.ts) -- `LangfuseOtelSpanAttributes` enum: `OBSERVATION_PROMPT_NAME = "langfuse.observation.prompt.name"`, `OBSERVATION_PROMPT_VERSION = "langfuse.observation.prompt.version"`.
- [GitHub: langfuse/langfuse-js](https://github.com/langfuse/langfuse-js) -- Repository for @langfuse/client, mono-repo with packages/client directory. MIT license confirmed from package.json.

### Secondary (MEDIUM confidence)

- Project codebase files: `src/lib/langfuse/client.ts`, `src/lib/ai/prompts.ts`, `src/app/api/chat/route.ts`, `src/instrumentation.ts` -- current integration points verified by reading source.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- verified from installed node_modules source code and type definitions
- Architecture (prompt fetching pattern): HIGH -- all API signatures, cache behavior, fallback logic verified from source
- Architecture (prompt-trace linking): HIGH -- OTel attribute mapping verified from @langfuse/tracing source, asType constraint verified from type definitions
- Pitfalls: HIGH -- cache behavior, label vs version semantics, and asType mismatch all verified from source code
- Performance (cache): HIGH -- TTL, stale-while-revalidate, and deduplication verified from source
- Performance (network latency): LOW -- estimated, not measured
- Security: MEDIUM -- no CVE search tools available; assessed based on architecture analysis

**Research date:** 2026-04-07
