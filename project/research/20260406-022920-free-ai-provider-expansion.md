# Free AI Provider Expansion - Research

**Researched:** 2026-04-06
**Domain:** Vercel AI SDK v6 provider integration, free-tier AI inference APIs
**Confidence:** HIGH (core providers), MEDIUM (rate limits -- change frequently)

## Summary

This research evaluates 10 free AI API platforms from the source article against the project's existing provider abstraction in `src/lib/ai/model.ts`. The project currently uses `@ai-sdk/google` (Gemini 2.5 Flash) and `@ai-sdk/groq` (Llama 3.3 70B) with a `MODEL_MAP` + `FALLBACK_ORDER` pattern and `LanguageModelV3` typing.

The key finding is that only two providers have first-party AI SDK packages with native v3 specification support (Mistral and OpenRouter). Two more (Cerebras and Together AI) have official `@ai-sdk/*` packages but run in v2 compatibility mode under AI SDK v6, which works but emits console warnings. Several others are OpenAI-compatible and can use `@ai-sdk/openai-compatible`, also in v2 compat mode. The remaining providers (GPT4All/Telegram, Pollinations, Clarifai) are unsuitable for this architecture.

**Primary recommendation:** Add **Mistral** (`@ai-sdk/mistral@3.x`, native v3 spec) and **Cerebras** (`@ai-sdk/cerebras@2.x`, v2 compat mode) as they provide the best combination of AI SDK integration quality, free-tier generosity, and model quality. OpenRouter is a strong third option as an aggregator giving access to 28+ free models through one API key.

## Standard Stack

### Core (Recommended Additions)

| Library | Version | Purpose | License | Maintained? | Why Standard |
|---------|---------|---------|---------|-------------|-------------|
| `@ai-sdk/mistral` | 3.0.28 | Mistral AI provider | Apache-2.0 | Active (8 days ago) | Native v3 spec, no compat warnings. Access to Mistral Large, Small, Codestral on free tier. 1B tokens/month. |
| `@ai-sdk/cerebras` | 2.0.42 | Cerebras inference provider | Apache-2.0 | Active (recent) | Ultra-fast inference. 1M tokens/day free. Runs in v2 compat mode (functional, emits warnings). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|------------|
| `@openrouter/ai-sdk-provider` | 2.3.3 | OpenRouter aggregator | When you need access to 28+ free models through one API key. Acts as a meta-fallback across multiple providers. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|-----------|-----------|----------|
| `@ai-sdk/cerebras` | `@ai-sdk/openai-compatible` with Cerebras base URL | Same v2 compat mode behavior, but more manual configuration. Direct package is simpler. |
| `@openrouter/ai-sdk-provider` | Individual provider packages | More control per provider, but more API keys to manage and more packages to install. |
| `@ai-sdk/togetherai` | `@ai-sdk/openai-compatible` with Together base URL | Together AI has no true free tier (only $25 signup credits). Skip unless credits are available. |

**Installation:**
```bash
npm install @ai-sdk/mistral @ai-sdk/cerebras @openrouter/ai-sdk-provider
```

## Architecture Options

Two fundamentally different approaches to expanding the provider map.

| Option | Description | Pros | Cons | Best When |
|--------|------------|------|------|-----------|
| **A: Direct Provider Packages** | Install dedicated `@ai-sdk/*` package per provider. Each entry in `MODEL_MAP` uses its native import. | Type-safe, provider-specific features (reasoning, OCR), clean imports | More dependencies, each package has its own v2/v3 compat status | You want reliability and provider-specific features. Best for 2-4 providers. |
| **B: OpenRouter Aggregator** | Single `@openrouter/ai-sdk-provider` package. All free models accessed through one API key and one provider. | One package, one API key, 28+ models, automatic failover | Extra network hop (OpenRouter proxy), 50 RPD limit (free), model quality varies by routing, free models can disappear without notice | You want maximum model diversity with minimal setup. Best for experimentation. |
| **C: Hybrid** | Use direct packages for primary providers (Gemini, Groq, Mistral, Cerebras), add OpenRouter as an "escape hatch" fallback at the end of the chain. | Best of both: reliable primaries + broad fallback | Most dependencies, most env vars to configure | You want production-grade primaries with a safety net. Best for this project. |

**Recommended:** Option C (Hybrid) -- Direct packages for the providers you depend on daily, with OpenRouter as the last-resort fallback. This matches the existing `FALLBACK_ORDER` pattern naturally.

### Counterarguments

Why someone might NOT choose Option C:

- **"Too many env vars":** Each provider needs its own API key env var. -- **Response:** For a demo project this is manageable (4-5 keys). The `.env.example` already documents provider keys. The `AI_PROVIDER` env var selects the primary; fallbacks use whatever keys are available.
- **"v2 compat warnings from Cerebras are noisy":** Console will log spec warnings. -- **Response:** Suppress with `globalThis.AI_SDK_LOG_WARNINGS = false` if needed, or wait for v3 stable. The warnings are cosmetic; functionality is unaffected.
- **"OpenRouter free tier is unreliable":** 53+ outages at Cerebras in 12 months, and OpenRouter free models can disappear. -- **Response:** That is exactly why we have a fallback chain, not a single provider. The architecture absorbs individual provider failures.

## Architecture Patterns

### Recommended Project Structure

No new files needed beyond updating the existing:

```
src/lib/ai/
  model.ts          # Expand MODEL_MAP, AIProvider union, FALLBACK_ORDER
```

### Pattern 1: Expanded MODEL_MAP with Conditional Providers

**What:** Extend the existing `AIProvider` union type and `MODEL_MAP` to include new providers, keeping the same factory function pattern.

**When to use:** When adding providers that have dedicated AI SDK packages.

**Example:**
```typescript
// Source: existing pattern in src/lib/ai/model.ts
import { google } from '@ai-sdk/google'
import { groq } from '@ai-sdk/groq'
import { mistral } from '@ai-sdk/mistral'
import { cerebras } from '@ai-sdk/cerebras'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModelV3 } from '@ai-sdk/provider'

type AIProvider = 'gemini' | 'groq' | 'mistral' | 'cerebras' | 'openrouter'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

const MODEL_MAP: Record<AIProvider, () => LanguageModelV3> = {
  gemini: () => google('gemini-2.5-flash'),
  groq: () => groq('meta-llama/llama-4-scout-17b-16e-instruct'),
  mistral: () => mistral('mistral-small-latest'),
  cerebras: () => cerebras('llama3.1-8b'),
  openrouter: () => openrouter.chat('meta-llama/llama-3.3-70b-instruct:free'),
}

const FALLBACK_ORDER: Record<AIProvider, AIProvider[]> = {
  gemini: ['groq', 'mistral', 'cerebras', 'openrouter'],
  groq: ['gemini', 'mistral', 'cerebras', 'openrouter'],
  mistral: ['gemini', 'groq', 'cerebras', 'openrouter'],
  cerebras: ['gemini', 'groq', 'mistral', 'openrouter'],
  openrouter: ['gemini', 'groq', 'mistral', 'cerebras'],
}
```

### Pattern 2: Conditional Registration (Skip Missing Keys)

**What:** Only register providers whose API keys are present in the environment. Avoids runtime errors when a key is missing.

**When to use:** When not all developers will have all API keys configured.

**Example:**
```typescript
// Conceptual -- only add providers whose keys exist
const MODEL_MAP: Partial<Record<AIProvider, () => LanguageModelV3>> = {
  gemini: () => google('gemini-2.5-flash'), // always available (default)
}

if (process.env.GROQ_API_KEY) {
  MODEL_MAP.groq = () => groq('meta-llama/llama-4-scout-17b-16e-instruct')
}
if (process.env.MISTRAL_API_KEY) {
  MODEL_MAP.mistral = () => mistral('mistral-small-latest')
}
if (process.env.CEREBRAS_API_KEY) {
  MODEL_MAP.cerebras = () => cerebras('llama3.1-8b')
}
if (process.env.OPENROUTER_API_KEY) {
  MODEL_MAP.openrouter = () => openrouter.chat('meta-llama/llama-3.3-70b-instruct:free')
}
```

### Anti-Patterns to Avoid

- **Hard-coding model IDs that are being deprecated:** Cerebras deprecated `llama-3.3-70b` and `qwen-3-32b` on 2026-02-16. Always check provider docs for model lifecycle before pinning an ID.
- **Using OpenRouter's `openrouter/free` router as primary:** This auto-selects models and gives inconsistent output quality. Use specific model IDs with `:free` suffix instead.
- **Installing `@ai-sdk/togetherai` with AI SDK v6:** The package is at v2.0.42 and throws `Unsupported model version v3` errors (not just warnings -- actual errors in some configurations). Wait for v3 stable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|------------|-------------|-----|
| OpenAI-compat provider wrapper | Custom fetch-based provider adapter | `@ai-sdk/openai-compatible` | Handles auth, streaming, error mapping, token counting. Deceptively complex to get right for all edge cases. |
| Multi-provider fallback logic | Custom try/catch chains | The existing `getModelWithFallbacks()` pattern | Already handles provider iteration with error propagation. Extend, don't replace. |
| Rate limit tracking | Per-provider request counters | Provider-side rate limiting (429 responses) + fallback chain | Free tiers enforce their own limits. Your fallback chain already handles 429s by moving to the next provider. |

## Common Pitfalls

### Pitfall 1: Cerebras 8K Context Window

**What goes wrong:** Cerebras free tier has an 8,192-token context window on most models. Long conversation histories or system prompts will fail silently or get truncated.
**Why it happens:** The generous 1M tokens/day limit masks the small per-request context window. Developers assume high daily quotas mean large context.
**How to avoid:** Use Cerebras only as a fallback for short interactions. For the conveyancing chat use case, Gemini (1M context) or Groq (128K context) should remain primary.

### Pitfall 2: Mistral Free Tier 2 RPM Limit

**What goes wrong:** At 2 requests per minute, concurrent users or rapid tool calls will immediately hit 429 errors.
**Why it happens:** The 1B tokens/month sounds generous but the RPM bottleneck makes it unusable as a primary provider under any real load.
**How to avoid:** Use Mistral as a fallback, not a primary. The per-model rate limits mean you could potentially spread across models (Mistral Small for one request, Mistral Large for another) but this adds complexity.

### Pitfall 3: v2 Compat Mode Warnings Flooding Console

**What goes wrong:** `@ai-sdk/cerebras` and any `@ai-sdk/openai-compatible` based provider emit `"specificationVersion is used in a compatibility mode"` on every model instantiation.
**Why it happens:** These packages implement v2 spec while AI SDK v6 expects v3. The compat bridge works but warns.
**How to avoid:** Either suppress with `globalThis.AI_SDK_LOG_WARNINGS = false` (loses all SDK warnings) or accept the noise until v3 packages ship. The v3 betas exist (`3.0.0-beta.15`) but depend on unreleased `@ai-sdk/provider@4.0.0-beta`.

### Pitfall 4: OpenRouter Free Model Churn

**What goes wrong:** Free models on OpenRouter can be removed or have limits changed without notice. A model ID that works today may return 404 next week.
**Why it happens:** Free models are subsidized by OpenRouter and providers. When subsidies end, models leave the free tier.
**How to avoid:** Use OpenRouter only as a last-resort fallback. Pin to stable, well-established free models (Llama 3.3 70B, Gemma 3 27B) rather than new or niche ones.

### Pitfall 5: Groq Model ID Changes

**What goes wrong:** The project currently uses `groq('llama-3.3-70b-versatile')` but Groq has added newer models like `meta-llama/llama-4-scout-17b-16e-instruct` with better rate limits (30 RPM, 1K RPD, 30K TPM vs 12K TPM for llama-3.3).
**Why it happens:** Groq updates their model catalog frequently and older model IDs can have reduced quotas.
**How to avoid:** Review Groq's rate limits page periodically. The Llama 4 Scout model on Groq has higher token-per-minute limits than the currently configured Llama 3.3.

## Security

### Known Vulnerabilities

No known CVEs or advisories found for recommended libraries as of 2026-04-06. All recommended packages (`@ai-sdk/mistral`, `@ai-sdk/cerebras`, `@openrouter/ai-sdk-provider`) are Apache-2.0 licensed and maintained within the Vercel AI SDK monorepo or by the provider themselves.

### Architectural Security Risks

| Risk | Affected Architecture Options | How It Manifests | Secure Pattern | Anti-Pattern to Avoid |
|------|------------------------------|------------------|----------------|----------------------|
| API key exposure in client bundle | All options | API keys bundled into Next.js client code if imported in client components | All provider instantiation in server-only code (`src/lib/ai/model.ts` is server-side, which is correct) | Importing provider packages in `'use client'` components |
| Prompt injection via model routing | Option B (OpenRouter) | Malicious input could exploit differences in how different models handle instructions | Validate and sanitize user input before sending to any model. Use consistent system prompts. | Relying on OpenRouter's auto-router (`openrouter/free`) which may select models with weaker instruction following |
| Rate limit exhaustion as DoS vector | All options | An attacker could exhaust free-tier quotas by sending many requests | Implement request throttling at the API route level (not just relying on provider-side 429s) | No rate limiting on the `/api/chat` endpoint |

### Trust Boundaries

- **User message input (`/api/chat` POST body):** Already validated with Zod schema. Content is passed directly to LLM system -- no injection sanitization beyond schema validation. For a demo this is acceptable; for production, add content-length limits and profanity/injection filters.
- **API keys in environment:** Stored in `.env.local`, not committed. Each new provider adds another secret to manage. Document all required keys in `.env.example`.
- **OpenRouter as proxy:** When using OpenRouter, your prompts transit through a third-party proxy before reaching the actual model provider. For sensitive legal data, this adds a trust boundary. Acceptable for demo; review for production.

## Performance

| Metric | Gemini 2.5 Flash | Groq (Llama 3.3 70B) | Mistral Small | Cerebras (Llama 3.1 8B) | OpenRouter (varies) |
|--------|------------------|-----------------------|---------------|--------------------------|---------------------|
| Free RPM | 10 | 30 | 2 | 30 | 20 |
| Free RPD | 250 | 1,000 | unlimited (1B tok/mo) | unlimited (1M tok/day) | 50 (free acct) |
| Context window | 1M tokens | 128K tokens | 128K tokens | 8K tokens | varies by model |
| Inference speed | Fast | Very fast (LPU) | Moderate | Very fast (WSE) | Varies |
| Tool calling | Yes | Yes | Yes | Check per model | Varies by model |

_Note: Rate limits are approximate and subject to change. Cerebras and Groq are notably faster than other providers due to custom inference hardware._

## Code Examples

### Adding Mistral to MODEL_MAP

```typescript
// Source: https://ai-sdk.dev/providers/ai-sdk-providers/mistral
import { mistral } from '@ai-sdk/mistral'

// In MODEL_MAP:
mistral: () => mistral('mistral-small-latest'),
// Env var: MISTRAL_API_KEY (auto-detected by @ai-sdk/mistral)
```

### Adding Cerebras to MODEL_MAP

```typescript
// Source: https://ai-sdk.dev/providers/ai-sdk-providers/cerebras
import { cerebras } from '@ai-sdk/cerebras'

// In MODEL_MAP:
cerebras: () => cerebras('llama3.1-8b'),
// Env var: CEREBRAS_API_KEY (auto-detected by @ai-sdk/cerebras)
```

### Adding OpenRouter to MODEL_MAP

```typescript
// Source: https://ai-sdk.dev/providers/community-providers/openrouter
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

// In MODEL_MAP -- note the :free suffix for free models:
openrouter: () => openrouter.chat('meta-llama/llama-3.3-70b-instruct:free'),
// Env var: OPENROUTER_API_KEY
```

### Suppressing v2 Compat Warnings (if needed)

```typescript
// Place in instrumentation.ts or model.ts before provider imports
globalThis.AI_SDK_LOG_WARNINGS = false
// WARNING: This also suppresses legitimate SDK warnings
```

## Provider-by-Provider Assessment

### Providers to ADD

| Provider | Package | Free Tier | Best Model (Free) | Signup URL | Verdict |
|----------|---------|-----------|-------------------|------------|---------|
| **Mistral** | `@ai-sdk/mistral@3.0.28` | 2 RPM, 1B tokens/month, all models | `mistral-small-latest` | [console.mistral.ai](https://console.mistral.ai) | **Add.** Native v3 spec. High quality models. Low RPM makes it fallback-only. |
| **Cerebras** | `@ai-sdk/cerebras@2.0.42` | 30 RPM, 1M tokens/day | `llama3.1-8b` | [cloud.cerebras.ai](https://cloud.cerebras.ai) | **Add.** Very fast inference. v2 compat mode works. 8K context is limiting. |
| **OpenRouter** | `@openrouter/ai-sdk-provider@2.3.3` | 20 RPM, 50 RPD (free acct) | `meta-llama/llama-3.3-70b-instruct:free` | [openrouter.ai](https://openrouter.ai) | **Add as last fallback.** Aggregator with 28+ free models. Low daily limit unless credits purchased. |

### Providers to SKIP

| Provider | Why Skip |
|----------|---------|
| **Together AI** | No true free tier (requires $5 minimum purchase, or $25 signup credits that expire). `@ai-sdk/togetherai` is at v2.0.42 with known AI SDK v6 compatibility errors (GitHub issue #11780, open, no resolution). |
| **Cloudflare Workers AI** | `workers-ai-provider@3.1.10` exists but is designed for the Cloudflare Workers runtime. Using via REST API from Next.js is possible but requires Cloudflare account setup, API token generation, and neuron-based pricing that is harder to predict. Not worth the complexity for a demo. |
| **GitHub Models** | OpenAI-compatible (`https://models.github.ai/inference`), but rate limits are very low (10 RPM, 50 RPD for GPT-4o; 15 RPM, 150 RPD for DeepSeek). Requires GitHub PAT. Explicitly "not for production/commercial use." |
| **Google AI Studio** | Already in the project as the primary Gemini provider via `@ai-sdk/google`. No separate addition needed. |
| **GPT4All (Telegram)** | Telegram-bot-based API. Not compatible with AI SDK. Not suitable for server-side integration. |
| **Pollinations AI** | No API key, no authentication, no rate limit documentation. Not suitable for any application that needs reliability or deterministic behavior. |
| **Clarifai** | 1,000 requests/month total. No dedicated AI SDK package. Would need `@ai-sdk/openai-compatible` (v2 compat). The low quota does not justify the integration effort. |

### Complete Free Model Inventory (OpenRouter)

For reference, these 28 models are available free through OpenRouter as of April 2026:

| Model ID | Provider | Context | Tools | Vision |
|----------|----------|---------|-------|--------|
| `qwen/qwen3.6-plus:free` | Qwen | 1M | Yes | Yes |
| `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA | 262K | Yes | No |
| `qwen/qwen3-next-80b-a3b-instruct:free` | Qwen | 262K | Yes | No |
| `qwen/qwen3-coder:free` | Qwen | 262K | Yes | No |
| `stepfun/step-3.5-flash:free` | StepFun | 256K | Yes | No |
| `nvidia/nemotron-3-nano-30b-a3b:free` | NVIDIA | 256K | Yes | No |
| `openrouter/free` | OpenRouter (router) | 200K | Yes | Yes |
| `minimax/minimax-m2.5:free` | MiniMax | 197K | Yes | No |
| `arcee-ai/trinity-mini:free` | Arcee AI | 131K | Yes | No |
| `openai/gpt-oss-120b:free` | OpenAI | 131K | Yes | No |
| `openai/gpt-oss-20b:free` | OpenAI | 131K | Yes | No |
| `z-ai/glm-4.5-air:free` | Z.ai | 131K | Yes | No |
| `google/gemma-3-27b-it:free` | Google | 131K | No | Yes |
| `meta-llama/llama-3.2-3b-instruct:free` | Meta | 131K | No | No |
| `nousresearch/hermes-3-llama-3.1-405b:free` | Nous Research | 131K | No | No |
| `arcee-ai/trinity-large-preview:free` | Arcee AI | 131K | Yes | No |
| `nvidia/nemotron-nano-12b-v2-vl:free` | NVIDIA | 128K | Yes | Yes |
| `nvidia/nemotron-nano-9b-v2:free` | NVIDIA | 128K | Yes | No |
| `meta-llama/llama-3.3-70b-instruct:free` | Meta | 66K | Yes | No |
| `liquid/lfm-2.5-1.2b-thinking:free` | LiquidAI | 33K | No | No |
| `liquid/lfm-2.5-1.2b-instruct:free` | LiquidAI | 33K | No | No |
| `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | Venice | 33K | No | No |
| `google/gemma-3-4b-it:free` | Google | 33K | No | Yes |
| `google/gemma-3-12b-it:free` | Google | 33K | No | Yes |
| `google/gemma-3n-e2b-it:free` | Google | 8K | No | No |
| `google/gemma-3n-e4b-it:free` | Google | 8K | No | No |
| `google/lyria-3-pro-preview` | Google | 1M | No | Yes |
| `google/lyria-3-clip-preview` | Google | 1M | No | Yes |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|-------------|-----------------|--------------|--------|
| `@ai-sdk/*` v2.x with native v2 spec | `@ai-sdk/*` v3.x with native v3 spec | AI SDK v6 release (late 2025) | Providers must upgrade to v3 spec. Google, Groq, Mistral have v3 stable. Cerebras, Together AI still on v2 with compat mode. |
| `@ai-sdk/openai` with custom `baseURL` for compat providers | `@ai-sdk/openai-compatible` package | ~2025 | Dedicated package for OpenAI-compatible APIs. Still v2 spec (v3 beta exists at `3.0.0-beta.15`). |
| Groq `llama-3.3-70b-versatile` | Groq `meta-llama/llama-4-scout-17b-16e-instruct` | Early 2026 | Llama 4 Scout has better rate limits on Groq (30K TPM vs 12K TPM). Consider updating the existing Groq model ID. |
| Cerebras `llama-3.3-70b` | Cerebras `llama3.1-8b` or `gpt-oss-120b` | 2026-02-16 | Llama 3.3 70B and Qwen 3 32B deprecated on Cerebras. Current production models: `llama3.1-8b`, `gpt-oss-120b`, `qwen-3-235b-a22b-instruct-2507`, `zai-glm-4.7`. |

**Deprecated/outdated:**

- `llama-3.3-70b` and `qwen-3-32b` on Cerebras: Deprecated 2026-02-16. Do not use.
- `@ai-sdk/togetherai` stable (v2.x): Throws errors with AI SDK v6 in some configurations. The v3 beta (`3.0.0-beta.15`) exists but depends on unreleased provider core.
- Groq's `llama-3.3-70b-versatile`: Still works but has lower TPM limits than newer Llama 4 models on Groq.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None -- no test framework is configured in this project |
| Config file | None -- needs creating |
| Quick run command | N/A |
| Full suite command | N/A |

### Requirements to Test Map

| Requirement | Behavior | Test Type | Automated Command | File Exists? |
|------------|----------|-----------|-------------------|-------------|
| New providers return LanguageModelV3 | `MODEL_MAP` factory functions return valid models | unit | N/A (no test framework) | No -- needs creating |
| Fallback chain includes new providers | `getModelWithFallbacks()` returns array with new providers | unit | N/A | No -- needs creating |
| Missing API key skips provider | Provider not registered when env var absent | unit | N/A | No -- needs creating |
| Each provider can stream text | `streamText()` succeeds with each provider | integration (requires API keys) | Manual: `curl -X POST http://localhost:3000/api/chat` | No -- needs creating |
| v2 compat warnings don't break functionality | Cerebras provider works despite compat warnings | integration | Manual test | No |

### Gaps (files to create before implementation)

- [ ] Test framework setup (vitest recommended for this stack)
- [ ] `src/lib/ai/__tests__/model.test.ts` -- unit tests for `MODEL_MAP`, `validateModelProvider`, `getModelWithFallbacks`
- [ ] Integration test script for each provider (requires real API keys, not automatable in CI without secrets)

## Open Questions

1. **Cerebras context window size per model**
   - What we know: Multiple sources cite 8K context for free tier. Official rate limit docs do not specify context window sizes.
   - What's unclear: Whether the 8K limit applies to all models or just some. The `gpt-oss-120b` model may have a larger context window.
   - Recommendation: Test empirically with the actual API. Start with `llama3.1-8b` which is most likely 8K.

2. **@ai-sdk/cerebras v3 stable timeline**
   - What we know: v3 beta (`3.0.0-beta.15`) exists, depends on `@ai-sdk/provider@4.0.0-beta.7`. The v2 stable works in compat mode.
   - What's unclear: When v3 will reach stable. No public timeline found.
   - Recommendation: Use v2 stable now. The compat mode is functional. Upgrade to v3 when it ships.

3. **OpenRouter free account daily limit (50 vs 200 RPD)**
   - What we know: Sources conflict. Some say 50 RPD for free accounts, others say 200 RPD. Purchasing 10+ credits increases limit to 1000 RPD.
   - What's unclear: The exact current limit for a brand-new free account.
   - Recommendation: Assume 50 RPD (conservative). As a last-resort fallback, even 50 RPD is sufficient.

4. **Groq model ID update**
   - What we know: The project uses `llama-3.3-70b-versatile` which has 12K TPM. Groq now offers `meta-llama/llama-4-scout-17b-16e-instruct` with 30K TPM and `moonshotai/kimi-k2-instruct` with 60 RPM.
   - What's unclear: Whether the conveyancing agent use case benefits more from the larger model (70B) or higher throughput (30K TPM).
   - Recommendation: Consider updating the Groq model ID as part of this work, but this is a separate decision from adding new providers.

## Sources

### Primary (HIGH confidence)

- [AI SDK Providers: Cerebras](https://ai-sdk.dev/providers/ai-sdk-providers/cerebras) -- official AI SDK docs, v6 compatible, model list
- [AI SDK Providers: Mistral](https://ai-sdk.dev/providers/ai-sdk-providers/mistral) -- official AI SDK docs, v6 compatible, model list
- [AI SDK Community Providers: OpenRouter](https://ai-sdk.dev/providers/community-providers/openrouter) -- official AI SDK docs, setup instructions
- [AI SDK OpenAI-Compatible Providers](https://ai-sdk.dev/providers/openai-compatible-providers) -- `@ai-sdk/openai-compatible` usage guide
- [npm: @ai-sdk/cerebras](https://www.npmjs.com/package/@ai-sdk/cerebras) -- version 2.0.42, license Apache-2.0
- [npm: @ai-sdk/mistral](https://www.npmjs.com/package/@ai-sdk/mistral) -- version 3.0.28, license Apache-2.0
- [npm: @openrouter/ai-sdk-provider](https://www.npmjs.com/package/@openrouter/ai-sdk-provider) -- version 2.3.3, license Apache-2.0
- [Cerebras Supported Models](https://inference-docs.cerebras.ai/models/overview) -- current production models
- [Cerebras Rate Limits](https://inference-docs.cerebras.ai/support/rate-limits) -- free tier: 30 RPM, 1M TPD

### Secondary (MEDIUM confidence)

- [Cerebras OpenAI Compatibility](https://inference-docs.cerebras.ai/resources/openai) -- base URL `https://api.cerebras.ai/v1`
- [Together AI OpenAI Compatibility](https://docs.together.ai/docs/openai-api-compatibility) -- base URL `https://api.together.xyz/v1`
- [Mistral Rate Limits & Usage Tiers](https://docs.mistral.ai/deployment/ai-studio/tier) -- Experiment tier: 2 RPM, 500K TPM, 1B tokens/month
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits) -- per-model free tier limits -- Accessed: 2026-04-06
- [OpenRouter Free Models (Apr 2026)](https://costgoat.com/pricing/openrouter-free-models) -- 28 free models listed -- Accessed: 2026-04-06
- [GitHub: vercel/ai#11780](https://github.com/vercel/ai/issues/11780) -- `@ai-sdk/togetherai` v3 compatibility issue, open, no resolution -- Accessed: 2026-04-06
- [GitHub: vercel/ai#12615](https://github.com/vercel/ai/issues/12615) -- `@ai-sdk/openai-compatible` v3 upgrade request, open -- Accessed: 2026-04-06
- [Google Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) -- free tier: Flash 10 RPM/250 RPD
- [Cerebras Vercel AI SDK Guide](https://inference-docs.cerebras.ai/integrations/vercel-ai-sdk) -- integration setup

### Tertiary (LOW confidence)

- [10+ Free AI API Platforms (2025) - Medium](https://archive.is/ezYZz) -- original source article. Published: Jul 2025. Accessed: 2026-04-06. Some claims outdated (Together AI described as "unlimited free" is incorrect).
- [Cerebras Free Tier Guide (2026)](https://aicreditmart.com/ai-credits-providers/cerebras-free-tier-1-million-tokens-day-guide-2026/) -- 8K context claim, needs empirical verification -- Accessed: 2026-04-06
- [OpenRouter Free API Explained (2026)](https://www.marketingscoop.com/developer/openrouter-free-api-explained-what-it-is-what-changed-in-2026-and-the-tradeoffs-before-you-build-on-it/) -- reliability concerns documented -- Accessed: 2026-04-06
- [Cerebras Outage History](https://statusgator.com/services/cerebras) -- 53+ outages in 12 months, ~220 min avg resolution -- Accessed: 2026-04-06

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** -- packages verified on npm, versions confirmed, peer deps checked, licenses verified
- Architecture: **HIGH** -- existing `MODEL_MAP` pattern is well-understood, extension is straightforward
- Provider compatibility (v2/v3 spec): **HIGH** -- verified via npm dependency trees (`@ai-sdk/cerebras` -> `@ai-sdk/openai-compatible@2.0.38` -> v2 spec)
- Rate limits: **MEDIUM** -- sourced from official docs but change frequently; Mistral and Cerebras limits verified from provider docs
- Pitfalls: **MEDIUM** -- Cerebras 8K context not verified from primary source; OpenRouter reliability based on community reports
- OpenRouter free model list: **MEDIUM** -- sourced from costgoat.com cross-referenced with OpenRouter's own model page

**Research date:** 2026-04-06
