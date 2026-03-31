# Langfuse Observability via OpenTelemetry in Next.js 16 - Research

**Researched:** 2026-03-30
**Domain:** LLM observability / OpenTelemetry / Next.js instrumentation
**Confidence:** MEDIUM (external verification tools unavailable -- findings rely on project scout report, roadmap, and training data; key claims flagged for validation)

## Summary

Integrating Langfuse tracing into a Next.js 16 app using Vercel AI SDK requires three layers: (1) an OpenTelemetry provider initialized via Next.js's instrumentation hook, (2) the Langfuse OTel exporter bridging spans to the Langfuse cloud, and (3) per-call telemetry enablement in AI SDK's `streamText`/`generateText`. The critical constraint is that `@vercel/otel` is incompatible with the OTel JS SDK v2 that `@langfuse/otel` requires -- a manual `NodeTracerProvider` setup is mandatory.

The integration is server-side only. All tracing runs in the Node.js runtime, not Edge. The main risk is silent failure: a misconfigured OTel setup produces no errors and no traces, making debugging frustrating. The official Langfuse example repo (`langfuse/langfuse-vercel-ai-nextjs-example`) is the authoritative reference and should be consulted during implementation. This research identifies the packages, configuration patterns, and pitfalls, but several version-specific details require validation against the example repo at implementation time.

**Primary recommendation:** Follow the manual `NodeTracerProvider` pattern from the official Langfuse example repo, using `@langfuse/tracing` + `@langfuse/otel` + `@opentelemetry/sdk-node`. Validate exact versions and import paths against the example repo before coding -- the OTel ecosystem has frequent breaking changes between minor versions.

## Standard Stack

### Core

| Library | Version | Purpose | License | Maintained? | Why Standard |
|---------|---------|---------|---------|-------------|--------------|
| `@langfuse/tracing` | ^5.0.1 | Core Langfuse tracing SDK | MIT | Yes (active) | Required for Langfuse OTel bridge; provides trace/span primitives |
| `@langfuse/otel` | ^5.0.1 | OTel exporter for Langfuse | MIT | Yes (active) | Bridges OTel spans to Langfuse cloud; this is the glue package |
| `@opentelemetry/sdk-node` | ^0.200.x | OTel Node.js SDK | Apache-2.0 | Yes (CNCF) | Provides `NodeTracerProvider`; the OTel JS SDK v2 line |
| `ai` | ^6.0.x | Vercel AI SDK | Apache-2.0 | Yes (very active) | Core AI functions with built-in OTel span emission |
| `@ai-sdk/google` | ^3.0.x | Gemini provider for AI SDK | Apache-2.0 | Yes | Google Gemini integration for Vercel AI SDK |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@opentelemetry/api` | ^1.9.x | OTel API (peer dep) | Pulled in transitively; may need explicit install if peer dep warnings appear |
| `@opentelemetry/sdk-trace-node` | ^2.0.x | Node-specific tracer provider | May be needed separately depending on `@opentelemetry/sdk-node` version |
| `@opentelemetry/exporter-trace-otlp-http` | ^0.200.x | OTLP HTTP exporter | Only if using generic OTLP export instead of the Langfuse-specific exporter |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@langfuse/otel` (OTel bridge) | `langfuse` (direct SDK) | Direct SDK requires manual instrumentation of every call; OTel bridge is automatic with AI SDK |
| Manual `NodeTracerProvider` | `@vercel/otel` | `@vercel/otel` is simpler but incompatible with OTel JS SDK v2 that Langfuse v5 requires |
| Langfuse Cloud | Self-hosted Langfuse | Self-hosted avoids cloud dependency but is overkill for a demo; free tier is sufficient |
| Langfuse | LangSmith | LangSmith is LangChain-coupled; Langfuse is provider-agnostic and open-source |

**Installation:**
```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node ai @ai-sdk/google
```

**IMPORTANT VERSION NOTE (LOW confidence):** The OTel JS SDK ecosystem underwent a major versioning restructure in 2024-2025, moving from SDK v1 (API 1.x, SDK 0.5x.x) to SDK v2 (API 1.9.x, SDK 0.200.x). The Langfuse v5 packages (`@langfuse/tracing` v5, `@langfuse/otel` v5) require the v2 line. The exact compatible version ranges should be validated against the example repo's `package.json` and any `peerDependencies` in the Langfuse packages. Getting version mismatches between OTel packages is a common source of silent failures.

## Architecture Options

There are two fundamentally different approaches to integrating Langfuse with the Vercel AI SDK:

| Option | Description | Pros | Cons | Best When |
|--------|-------------|------|------|-----------|
| **A. OTel Bridge (automatic)** | Use `@langfuse/otel` as an OTel span exporter; AI SDK emits spans automatically when `experimental_telemetry` is enabled | Zero per-call instrumentation; all `streamText`/`generateText` calls traced automatically; captures tool calls, token counts, latency | Requires OTel provider setup (fiddly); silent failures on misconfiguration; adds OTel SDK dependency weight | You want comprehensive tracing with minimal per-call code; standard approach |
| **B. Direct SDK (manual)** | Use `langfuse` package directly; wrap each AI SDK call with Langfuse trace/span creation | No OTel dependency; simpler dependency tree; explicit control over what is traced | Manual instrumentation of every call; easy to miss calls; no automatic tool call tracing; more boilerplate | You only need to trace specific calls; dependency minimization is critical |

**Recommended:** Option A (OTel Bridge) -- The automatic tracing via OTel is the officially recommended approach by both Langfuse and Vercel. It captures all AI SDK calls including tool invocations without per-call code. The setup cost is paid once in the instrumentation file.

### Counterarguments

Why someone might NOT choose the recommended option:

- **OTel dependency weight is too high:** The `@opentelemetry/sdk-node` package pulls in a significant transitive dependency tree (~60-100KB gzipped server-side). **Response:** This is server-side only, does not affect client bundle, and is acceptable for a demo. In production, the observability value far outweighs the dependency cost.
- **Silent failure risk:** If OTel is misconfigured, you get no errors and no traces -- hard to debug. **Response:** This is mitigated by following the example repo exactly and verifying with a single test call immediately after setup. The failure mode is "no traces" not "broken app."
- **OTel ecosystem versioning is fragile:** Getting the right combination of `@opentelemetry/*` package versions is error-prone. **Response:** Pin to the exact versions in the example repo rather than using `^` ranges for OTel packages. This is a one-time setup cost.

## Architecture Patterns

### Recommended Project Structure

```
src/
  instrumentation.ts          # OTel provider init with Langfuse exporter (or instrumentation.node.ts)
  app/
    api/
      chat/
        route.ts              # AI SDK route with experimental_telemetry enabled
    (pages)/
      ...
  lib/
    ai/
      telemetry.ts            # Shared telemetry config helper (optional)
next.config.ts                # Must enable instrumentation hook (if needed for Next.js 16)
.env.local                    # LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASEURL
```

### Pattern 1: Instrumentation File (Next.js Instrumentation Hook)

**What:** Next.js provides an instrumentation hook that runs code once when the server starts, before any requests are handled. This is where the OTel provider is initialized.

**When to use:** Always -- this is the required entry point for server-side OTel initialization in Next.js.

**Next.js 15 approach (HIGH confidence from training data):**
```typescript
// src/instrumentation.ts (or instrumentation.node.ts for Node-only code)
export async function register() {
  // This function is called once when the Next.js server starts
  // OTel provider initialization goes here
}
```

**Next.js 16 consideration (LOW confidence -- requires validation):**
Next.js 16 (v16.2.1 per the project's package.json) may have changed the instrumentation API. In Next.js 15, the instrumentation hook was stabilized (moved from `experimental.instrumentationHook` to a stable config). In Next.js 16, the behavior may have further evolved. Key questions to validate:

1. Does `src/instrumentation.ts` still work, or has the file location changed?
2. Is any `next.config.ts` flag still required, or is the hook auto-detected?
3. Does `instrumentation.node.ts` (the Node-specific variant) still work?

**How to validate:** Check the Next.js 16 release notes and the example repo. If the example repo targets Next.js 15, the instrumentation API should still work in 16 (Next.js maintains backward compatibility for stable APIs), but confirm this.

### Pattern 2: NodeTracerProvider with LangfuseExporter

**What:** Initialize the OpenTelemetry `NodeTracerProvider` with the Langfuse span exporter so all OTel spans are forwarded to Langfuse.

**When to use:** Inside the `register()` function in `instrumentation.ts`.

**Example (MEDIUM confidence -- based on training data and scout report, validate against example repo):**
```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-node');
    // OR: const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const { SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const { LangfuseExporter } = await import('@langfuse/otel');

    const exporter = new LangfuseExporter({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASEURL,
    });

    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    provider.register();
  }
}
```

**Critical details:**
- The `process.env.NEXT_RUNTIME === 'nodejs'` guard is essential. The instrumentation file runs in both Node.js and Edge runtimes. OTel SDK is Node.js only -- importing it in Edge will crash.
- Dynamic `await import()` is used instead of top-level imports to prevent the Edge runtime from attempting to load Node.js-only modules.
- `SimpleSpanProcessor` sends spans immediately (good for development). For production, `BatchSpanProcessor` is preferred (batches spans for efficiency). For a demo, `SimpleSpanProcessor` is fine.
- The `NodeTracerProvider` import path may vary. It could be from `@opentelemetry/sdk-node` or `@opentelemetry/sdk-trace-node` depending on the SDK version. The example repo is authoritative here.

### Pattern 3: AI SDK Telemetry Enablement

**What:** Vercel AI SDK emits OTel spans when `experimental_telemetry` is enabled on individual calls.

**When to use:** On every `streamText`, `generateText`, `generateObject`, and agent call.

**Example (MEDIUM confidence):**
```typescript
import { streamText } from 'ai';
import { google } from '@ai-sdk/google';

const result = streamText({
  model: google('gemini-2.5-flash'),
  prompt: 'Suggest next steps for this conveyancing matter.',
  experimental_telemetry: {
    isEnabled: true,
    metadata: {
      sessionId: matterId,        // Groups traces by matter
      userId: 'demo-user',        // Optional: identifies the user
      // Custom metadata appears in Langfuse trace
    },
  },
});
```

**What gets traced automatically (when OTel + AI SDK telemetry are both configured):**
- Model name and provider
- Input prompt / messages
- Output completion / streamed text
- Token counts (input, output, total)
- Latency (start to finish)
- Tool calls (name, arguments, results)
- Errors

### Pattern 4: Session Grouping via Metadata

**What:** Langfuse groups traces into sessions using a `sessionId`. For this demo, each legal matter gets its own session, so all AI interactions for a matter appear together in the Langfuse dashboard.

**When to use:** On every AI SDK call, pass the matter ID as the session identifier.

**Example (LOW confidence -- the exact metadata key mapping from AI SDK `experimental_telemetry.metadata` to Langfuse session ID needs validation):**
```typescript
experimental_telemetry: {
  isEnabled: true,
  metadata: {
    // One of these patterns should work -- validate which key Langfuse
    // picks up as the session ID:
    sessionId: matterId,
    // OR it may need to be passed via a different mechanism
  },
}
```

**Open question:** The AI SDK's `experimental_telemetry.metadata` is converted into OTel span attributes. Langfuse reads specific OTel attributes to populate its session, user, and trace fields. The exact attribute name mapping (e.g., does `metadata.sessionId` become `langfuse.session.id` or `session.id` in the OTel span?) must be verified against Langfuse's OTel integration docs.

### Anti-Patterns to Avoid

- **Using `@vercel/otel` with Langfuse v5:** This will fail silently. `@vercel/otel` pins to OTel JS SDK v1 APIs; `@langfuse/otel` v5 requires v2. They cannot coexist.
- **Top-level OTel imports in instrumentation.ts:** Edge runtime will crash. Always use dynamic `await import()` guarded by `process.env.NEXT_RUNTIME === 'nodejs'`.
- **Using Edge runtime for AI routes:** OTel SDK is Node.js only. API routes that use AI SDK with telemetry must specify `export const runtime = 'nodejs'` (or omit the runtime export, since Node.js is the default in Next.js).
- **Mixing OTel package versions:** All `@opentelemetry/*` packages should be from the same major line (all v1 or all v2). Mixing produces type errors or silent failures.
- **Forgetting `experimental_telemetry` on individual calls:** The OTel provider being initialized is necessary but not sufficient. Each AI SDK call must also opt in via `experimental_telemetry: { isEnabled: true }`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM call tracing | Custom logging middleware around AI SDK calls | `@langfuse/otel` + OTel bridge | Automatic tracing captures tool calls, token counts, streaming, retries -- edge cases you'd miss in a manual wrapper |
| Session grouping | Custom trace correlation logic | Langfuse's built-in session grouping via `sessionId` | Langfuse handles the correlation, timeline visualization, and cost aggregation per session |
| Cost tracking | Manual token counting and price calculation | Langfuse's automatic cost tracking | Langfuse has a model pricing database and computes cost from token counts automatically |
| OTel provider setup | Custom tracer provider from individual OTel packages | `@opentelemetry/sdk-node` (the all-in-one) | The SDK package bundles the provider, processors, and resource detection; assembling from individual packages is error-prone |

## Common Pitfalls

### Pitfall 1: Silent Failure on Misconfigured OTel

**What goes wrong:** The app works perfectly but no traces appear in Langfuse. No errors are thrown.
**Why it happens:** OTel is designed to be non-intrusive. If the provider is not registered, or the exporter fails to connect, spans are silently dropped. The AI SDK still functions -- it just doesn't emit spans.
**How to avoid:** After setting up the instrumentation file, make a single AI SDK call and check the Langfuse dashboard within 30 seconds. If no trace appears: (1) check that `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASEURL` are set, (2) check that the instrumentation file is being loaded (add a `console.log` at the top of `register()`), (3) check that `experimental_telemetry: { isEnabled: true }` is on the call.

### Pitfall 2: Edge Runtime Crashes

**What goes wrong:** `Error: Cannot find module 'perf_hooks'` or similar Node.js-specific module not found errors.
**Why it happens:** The instrumentation file runs in both Node.js and Edge runtimes. OTel SDK uses Node.js APIs (`perf_hooks`, `async_hooks`, etc.) that don't exist in Edge.
**How to avoid:** Always guard OTel imports with `if (process.env.NEXT_RUNTIME === 'nodejs')` and use dynamic imports. Alternatively, use `instrumentation.node.ts` (the Node-specific variant) if supported in your Next.js version.

### Pitfall 3: OTel Package Version Mismatch

**What goes wrong:** TypeScript type errors, runtime `TypeError`s, or silent span drops.
**Why it happens:** The OTel JS ecosystem has many packages (`@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-node`, etc.) that must be version-compatible. The v1-to-v2 migration changed API surfaces.
**How to avoid:** Pin to the exact versions used in the Langfuse example repo. Do not use `^` ranges for `@opentelemetry/*` packages. Run `npm ls @opentelemetry/api` to verify all OTel packages resolve to the same API version.

### Pitfall 4: `experimental_telemetry` Name Change

**What goes wrong:** Telemetry config is passed but ignored.
**Why it happens:** The `experimental_telemetry` property name may be renamed or restructured in AI SDK v6 (it was `experimental_telemetry` in v4/v5). If it becomes `telemetry` or moves to a different config shape, old code silently does nothing.
**How to avoid:** Check the AI SDK v6 documentation for the current telemetry configuration property name. The example repo should reflect the current API.

### Pitfall 5: `BatchSpanProcessor` Drops Spans on Short-Lived Functions

**What goes wrong:** Traces are intermittently missing from Langfuse.
**Why it happens:** `BatchSpanProcessor` buffers spans and flushes periodically. In serverless environments, the function may terminate before the buffer flushes. Spans in the buffer are lost.
**How to avoid:** Use `SimpleSpanProcessor` for a demo (sends each span immediately, slightly higher latency). For production, use `BatchSpanProcessor` with explicit `forceFlush()` before the response ends, or configure a short flush interval.

### Pitfall 6: Missing `functionId` in Telemetry Metadata

**What goes wrong:** Traces in Langfuse are hard to distinguish -- all have the same generic name.
**Why it happens:** Without a `functionId` in the telemetry metadata, all traces appear as unnamed or generically named spans.
**How to avoid:** Pass a descriptive `functionId` in the telemetry metadata:
```typescript
experimental_telemetry: {
  isEnabled: true,
  functionId: 'matter-progression-suggest',
  metadata: { sessionId: matterId },
}
```

## Security

### Known Vulnerabilities

No known CVEs or advisories found for `@langfuse/tracing`, `@langfuse/otel`, or `@opentelemetry/sdk-node` as of 2026-03-30. **LOW confidence -- unable to query CVE databases or GitHub security advisories in this session. Must be validated at implementation time.**

Recommended validation steps:
- Run `npm audit` after installing the packages
- Check https://www.npmjs.com/advisories for each package
- Search GitHub security advisories for the langfuse and open-telemetry organizations

### Architectural Security Risks

| Risk | Affected Architecture Options | How It Manifests | Secure Pattern | Anti-Pattern to Avoid |
|------|-------------------------------|------------------|----------------|----------------------|
| API key exposure | Both A and B | `LANGFUSE_SECRET_KEY` committed to repo or exposed in client bundle | Store in `.env.local` (gitignored) and Vercel environment variables; never import in client components | Hardcoding keys in source; importing env vars in `'use client'` files |
| Prompt/completion logging | Both A and B | Full prompts and completions are sent to Langfuse cloud, potentially including PII or sensitive legal content | For a demo this is acceptable; in production, configure Langfuse's data masking or use self-hosted Langfuse | Sending production client data to a third-party cloud without data processing agreement |
| OTel exporter as network dependency | Option A (OTel Bridge) | If Langfuse cloud is unreachable, the exporter may buffer spans in memory or silently drop them; not a direct security risk but worth noting | Ensure tracing is non-blocking (OTel defaults are non-blocking); set appropriate timeouts on the exporter | Making request handling wait for trace export to complete |

### Trust Boundaries

- **Environment variables (.env.local):** `LANGFUSE_SECRET_KEY` is the most sensitive credential. It allows writing traces to the Langfuse project. Must be gitignored and set via Vercel's environment variable UI for deployment.
- **Langfuse cloud (outbound):** Trace data (including full prompts, completions, and metadata) is sent to Langfuse's servers (`cloud.langfuse.com` or custom base URL). For a demo with synthetic legal data, this is acceptable. For production with real client data, a data processing agreement or self-hosting would be needed.
- **AI SDK telemetry metadata:** Any data placed in `experimental_telemetry.metadata` is sent as OTel span attributes to Langfuse. Do not include secrets, tokens, or sensitive PII in metadata.

## Performance

| Metric | Value / Range | Source | Notes |
|--------|---------------|--------|-------|
| Server-side bundle impact | ~60-100KB gzipped | Scout report (project) | OTel SDK is the bulk; server-side only, does not affect client bundle |
| Trace export latency (SimpleSpanProcessor) | ~5-20ms per span | Training data estimate | Each span triggers an HTTP POST to Langfuse; non-blocking |
| Trace export latency (BatchSpanProcessor) | Near-zero per span; ~50-200ms per batch flush | Training data estimate | Batches reduce per-span overhead; flush interval configurable |
| Memory overhead | Minimal (~5-15MB) | Training data estimate | OTel provider and span buffer; negligible for a demo |
| npm install time increase | +10-30s | Roadmap (project) | OTel SDK has deep transitive dependency tree |

_(LOW confidence on all numeric values -- these are estimates from training data. No benchmarks were available for verification. Flag for validation during implementation.)_

## Code Examples

Verified patterns assembled from project context and training data. **All examples should be validated against the official example repo before use.**

### Complete Instrumentation File

```typescript
// Source: Pattern derived from Langfuse docs and OTel SDK docs
// VALIDATE against: https://github.com/langfuse/langfuse-vercel-ai-nextjs-example/blob/main/instrumentation.ts

// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic imports to avoid Edge runtime crashes
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const { SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const { LangfuseExporter } = await import('@langfuse/otel');

    const langfuseExporter = new LangfuseExporter({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com',
    });

    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(langfuseExporter)],
    });

    provider.register();
  }
}
```

### AI SDK Route with Telemetry

```typescript
// Source: AI SDK docs + Langfuse integration docs (training data)
// VALIDATE against: https://github.com/langfuse/langfuse-vercel-ai-nextjs-example

// src/app/api/chat/route.ts
import { streamText } from 'ai';
import { google } from '@ai-sdk/google';

export async function POST(req: Request) {
  const { messages, matterId } = await req.json();

  const result = streamText({
    model: google('gemini-2.5-flash'),
    system: 'You are a legal workflow assistant...',
    messages,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'matter-chat',
      metadata: {
        sessionId: matterId,
        userId: 'demo-user',
      },
    },
  });

  return result.toDataStreamResponse();
}
```

### Shared Telemetry Config Helper (Optional)

```typescript
// src/lib/ai/telemetry.ts
// Avoids repeating telemetry config on every AI SDK call

export function createTelemetryConfig(options: {
  functionId: string;
  matterId: string;
  userId?: string;
}) {
  return {
    isEnabled: true,
    functionId: options.functionId,
    metadata: {
      sessionId: options.matterId,
      userId: options.userId ?? 'demo-user',
    },
  };
}

// Usage:
// streamText({
//   ...
//   experimental_telemetry: createTelemetryConfig({
//     functionId: 'matter-suggest',
//     matterId: matter.id,
//   }),
// });
```

### Environment Variables

```bash
# .env.local
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASEURL=https://cloud.langfuse.com
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|-------------|-----------------|--------------|--------|
| `@vercel/otel` for all OTel in Next.js | Manual `NodeTracerProvider` (when using Langfuse) | 2024-2025 (OTel JS SDK v2 migration) | `@vercel/otel` pins to SDK v1; Langfuse v5 requires SDK v2; they cannot coexist |
| `experimental.instrumentationHook: true` in next.config | Instrumentation hook is stable (auto-detected) | Next.js 15 | No config flag needed in Next.js 15+; `instrumentation.ts` is auto-detected |
| `langfuse` direct SDK for tracing | `@langfuse/otel` OTel bridge | Langfuse v5 (2025) | OTel bridge enables automatic tracing without per-call instrumentation |
| `experimental_telemetry` property name | May have changed in AI SDK v6 | Possibly AI SDK v6 (early 2026) | Validate current property name -- may now be `telemetry` without `experimental_` prefix |

**Deprecated/outdated:**
- **`@vercel/otel`:** Not deprecated globally, but incompatible with Langfuse v5's OTel requirements. Do not use for this integration.
- **`experimental.instrumentationHook` config flag:** Deprecated since Next.js 15. The instrumentation hook is now stable and auto-detected.
- **`langfuse` direct SDK for automatic tracing:** Superseded by the OTel bridge approach for AI SDK integrations. The direct SDK is still valid for manual trace creation but is not recommended as the primary tracing mechanism.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None configured yet (greenfield) |
| Config file | None -- needs creating |
| Quick run command | N/A |
| Full suite command | N/A |

### Requirements to Test Map

| Requirement | Behavior | Test Type | Automated Command | File Exists? |
|-------------|----------|-----------|-------------------|--------------|
| OTel provider initializes | `register()` creates and registers a `NodeTracerProvider` | Integration | Manual: start dev server, check console.log in `register()` | No -- needs creating |
| Langfuse exporter connects | Spans are exported to Langfuse cloud | Integration (manual) | Manual: make an AI SDK call, check Langfuse dashboard | No -- needs creating |
| AI SDK emits spans | `streamText` with `experimental_telemetry` produces OTel spans | Integration (manual) | Manual: call API route, verify trace in Langfuse | No -- needs creating |
| Session grouping works | Multiple calls with same `matterId` appear under one session | Integration (manual) | Manual: make 2+ calls with same matter ID, check Langfuse sessions view | No -- needs creating |
| Edge runtime guard | `register()` does not crash in Edge runtime | Unit | `node -e "process.env.NEXT_RUNTIME='edge'; require('./src/instrumentation')"` (approximate) | No -- needs creating |
| Env vars missing | App starts without crashing when Langfuse env vars are unset | Integration | Start dev server without `.env.local`, verify no crash | No -- needs creating |

### Gaps (files to create before implementation)

- [ ] `src/instrumentation.ts` -- OTel provider initialization with Langfuse exporter
- [ ] `.env.local` -- Langfuse API keys (after creating Langfuse cloud project)
- [ ] `src/app/api/chat/route.ts` (or equivalent) -- AI SDK route with telemetry enabled

**Testing note:** The primary validation for this integration is manual: make an AI call, check the Langfuse dashboard. Automated testing of OTel integration is possible but complex (requires mocking the exporter) and is not worth the effort for a demo. The recommended verification is:
1. Add `console.log('Instrumentation registered')` in `register()` -- confirm it fires on server start
2. Make one `streamText` call with telemetry enabled
3. Check Langfuse dashboard for the trace within 30 seconds
4. Verify trace contains: model name, prompt, completion, token counts, latency

## Open Questions

1. **Next.js 16 Instrumentation API**
   - What we know: Next.js 15 stabilized the instrumentation hook (`instrumentation.ts` auto-detected, no config flag needed). The project uses Next.js 16.2.1.
   - What's unclear: Whether Next.js 16 changed the instrumentation file API, location, or behavior. The `instrumentation.node.ts` variant (Node-specific instrumentation) may also have changed.
   - Recommendation: Check the Next.js 16 release notes and/or the Next.js docs at https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation. If the example repo targets Next.js 15, test the pattern on 16 -- it should work (stable APIs have backward compatibility) but verify.

2. **`experimental_telemetry` Property Name in AI SDK v6**
   - What we know: In AI SDK v4/v5, the property was `experimental_telemetry`. AI SDK v6 was a major release in early 2026.
   - What's unclear: Whether the property was renamed to `telemetry` (dropping the `experimental_` prefix) in v6, or if the config shape changed.
   - Recommendation: Check the AI SDK v6 docs at https://ai-sdk.dev or the example repo. Search for `telemetry` in the AI SDK changelog.

3. **Session ID Metadata Mapping**
   - What we know: AI SDK's `experimental_telemetry.metadata` values become OTel span attributes. Langfuse reads specific attributes to populate its session and user fields.
   - What's unclear: The exact attribute key that Langfuse reads for session ID. Is it `metadata.sessionId`, `langfuse.session.id`, or something else? Does the Langfuse OTel exporter handle the mapping automatically?
   - Recommendation: Check Langfuse's OTel integration docs for the expected attribute names. The example repo should demonstrate session grouping.

4. **`NodeTracerProvider` Import Path**
   - What we know: The class is available from either `@opentelemetry/sdk-node` or `@opentelemetry/sdk-trace-node`. Different versions and different import paths.
   - What's unclear: Which package and import path the Langfuse example uses. In OTel SDK v2, the package structure may have changed.
   - Recommendation: Check the example repo's `instrumentation.ts` for the exact import. Also check if `@opentelemetry/sdk-node` is the right package or if `@opentelemetry/sdk-trace-node` is needed separately.

5. **Langfuse `@langfuse/tracing` vs `@langfuse/otel` Role Split**
   - What we know: Scout report lists both `@langfuse/tracing` v5.0.1 and `@langfuse/otel` v5.0.1 as required.
   - What's unclear: Whether `@langfuse/tracing` is a peer dependency of `@langfuse/otel` (pulled in automatically) or must be installed explicitly. What exactly `@langfuse/tracing` provides that `@langfuse/otel` does not.
   - Recommendation: Check the `peerDependencies` of `@langfuse/otel` in the npm registry. The example repo's `package.json` will clarify which packages are explicitly listed as dependencies.

## Sources

### Primary (HIGH confidence)

- [Project Scout Report](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/20260330-SCOUT-REPORT.md) -- Section 4 (lines 163-215): Langfuse package versions, integration approach, `@vercel/otel` incompatibility, free tier details
- [Project Roadmap](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/roadmaps/20260330-01-legal-agent-flow-demo-roadmap.md) -- Section 2 (lines 125-197): Langfuse integration plan, broad todo list, impact analysis, risk notes
- [Project package.json](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/package.json) -- Existing dependencies: Next.js ^16.2.1, no AI SDK or Langfuse packages yet

### Secondary (MEDIUM confidence)

- Training data: Langfuse OTel integration patterns, `NodeTracerProvider` configuration, AI SDK `experimental_telemetry` API shape -- based on pre-May-2025 knowledge, partially corroborated by scout report findings
- Training data: Next.js instrumentation hook API (stabilized in Next.js 15) -- may not reflect Next.js 16 changes

### Tertiary (LOW confidence)

- Training data: OTel JS SDK v2 package versioning (`0.200.x` line), exact import paths for `NodeTracerProvider` -- the OTel ecosystem versioning is complex and changes frequently; validate against example repo
- Training data: Performance estimates for OTel overhead -- no benchmarks available for verification
- [Official example repo](https://github.com/langfuse/langfuse-vercel-ai-nextjs-example) -- Referenced but not accessed in this session (no web access tools available). **Must be consulted at implementation time.** This is the single most important source for this integration.

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM -- Package names confirmed by scout report; exact versions and peer dependencies need validation against npm registry and example repo
- Architecture: MEDIUM -- OTel bridge approach is well-established; specific configuration patterns need validation against current package versions
- Instrumentation file: LOW-MEDIUM -- Next.js 15 pattern is well-known; Next.js 16 may have changes
- AI SDK telemetry: LOW-MEDIUM -- `experimental_telemetry` API may have been renamed in v6; property shape needs validation
- Session grouping: LOW -- Exact metadata key mapping to Langfuse session ID is uncertain
- Security: LOW -- No CVE databases queried; rely on `npm audit` at implementation time
- Pitfalls: MEDIUM -- Common OTel pitfalls are well-documented; Next.js-specific pitfalls confirmed by roadmap

**Tool limitations:** This research was conducted without access to Context7, GitHub MCP, mdrip, WebFetch, or WebSearch. All findings are derived from project-internal documents (scout report, roadmap, package.json) and training data (cutoff: May 2025). The training data pre-dates Next.js 16, AI SDK v6, and Langfuse v5 -- all three are critical to this integration. **The planner should treat the example repo as the primary source of truth and validate all code patterns against it before implementation begins.**

**Research date:** 2026-03-30
