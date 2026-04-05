import type { LanguageModelV3 } from '@ai-sdk/provider'
import { langfuseSpanProcessor } from '@/instrumentation'
import { getModelWithFallbacks } from '@/lib/ai/model'
import { observe, propagateAttributes, updateActiveObservation } from '@langfuse/tracing'
import { trace } from '@opentelemetry/api'
import { streamText } from 'ai'
import { after } from 'next/server'
import { z } from 'zod'

const chatRequestSchema = z.object({
messages: z
.array(
z.object({
role: z.enum(['user', 'assistant', 'system']),
content: z.string(),
}),
)
.min(1, 'messages must be a non-empty array'),
matterId: z.string().optional(),
})

type MessageRole = 'user' | 'assistant' | 'system'

interface Message {
role: MessageRole
content: string
}

async function tryStreamText(models: LanguageModelV3[], system: string, messages: Message[]) {
let lastError: unknown

const numberOfModels = models.length
for (let index = 0; index < numberOfModels; index++) {
const model = models[index]
try {
const result = streamText({
model,
system,
messages,
experimental_telemetry: { isEnabled: true },
onFinish: ({ text }) => {
updateActiveObservation({ output: { response: text } })
trace.getActiveSpan()?.end()
},
onError: (error) => {
updateActiveObservation({ output: { error: String(error) } })
trace.getActiveSpan()?.end()
},
})

      after(async () => await langfuseSpanProcessor.forceFlush())

      return result.toTextStreamResponse()
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel = index + 1 < numberOfModels ? models[index + 1] : null
      const nextModelId = nextModel && 'modelId' in nextModel ? nextModel.modelId : null

      if (nextModelId) {
        console.warn(`Provider failed, trying ${nextModelId} as fallback: ${errorMessage}`)
      } else {
        console.warn(`Provider failed, no more fallbacks available: ${errorMessage}`)
      }
    }

}

throw lastError
}

const handler = async (req: Request) => {
let body: unknown
try {
body = await req.json()
} catch {
return new Response('Invalid JSON', { status: 400 })
}

const parsed = chatRequestSchema.safeParse(body)
if (!parsed.success) {
return new Response(parsed.error.issues[0].message, { status: 400 })
}

const { messages, matterId } = parsed.data
const resolvedMatterId = matterId ?? 'test-matter-001'

const system =
'You are a legal workflow assistant helping with conveyancing matters in Australia.'

updateActiveObservation({ input: { system, messages } })

return propagateAttributes(
{
traceName: 'matter-chat',
sessionId: resolvedMatterId,
userId: 'demo-user',
version: '1.0',
metadata: { env: 'demo' },
tags: ['conversational'],
},
async () => {
try {
return await tryStreamText(getModelWithFallbacks(), system, messages)
} catch (err) {
console.error('All providers failed:', err instanceof Error ? err.message : String(err))
return new Response('All AI providers are currently unavailable. Please try again later.', {
status: 503,
})
}
},
)
}

export const POST = observe(handler, {
name: 'handle-chat-message',
endOnExit: false,
captureInput: true,
captureOutput: true,
})

**User**

how does propagateAttributes work?

---

**AI Assistant**

`propagateAttributes()` automatically applies specific trace attributes (`userId`, `sessionId`, `metadata`, `version`, `tags`, `traceName`) to all observations created within its scope[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)[(2)](https://langfuse.com/docs/observability/sdk/overview). This ensures consistent attribute coverage across your entire trace without manually setting them on each observation[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

## How it works

**Python SDK:**

Use `propagate_attributes()` as a context manager. All observations created inside the `with` block automatically inherit the attributes[(1)](https://langfuse.com/docs/observability/sdk/instrumentation):

```python
from langfuse import get_client, propagate_attributes

langfuse = get_client()

with langfuse.start_as_current_observation(as_type="span", name="user-workflow"):
    with propagate_attributes(
        user_id="user_123",
        session_id="session_abc",
        metadata={"experiment": "variant_a"},
        version="1.0",
        trace_name="user-workflow",
    ):
        with langfuse.start_as_current_observation(as_type="generation", name="llm-call"):
            pass
```

[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)

**JS/TS SDK:**

Use `propagateAttributes()` with a callback. All observations created inside the callback automatically have these attributes[(1)](https://langfuse.com/docs/observability/sdk/instrumentation):

```typescript
import { startActiveObservation, propagateAttributes, startObservation } from '@langfuse/tracing'

await startActiveObservation('user-workflow', async () => {
  await propagateAttributes(
    {
      userId: 'user_123',
      sessionId: 'session_abc',
      metadata: { experiment: 'variant_a', env: 'prod' },
      version: '1.0',
      traceName: 'user-workflow',
    },
    async () => {
      const generation = startObservation('llm-call', { model: 'gpt-4' }, { asType: 'generation' })
      generation.end()
    },
  )
})
```

[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)

## Important notes

- Values must be **strings ≤200 characters**[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)
- Metadata keys: **Alphanumeric characters only** (no whitespace or special characters)[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)
- Call **early in your trace** to ensure all observations are covered for accurate metrics[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)
- Invalid values are dropped with a warning[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)

## Cross-service propagation

For distributed tracing, use the `as_baggage` parameter (Python) or `asBaggage` (JS/TS) to propagate attributes via HTTP headers[(1)](https://langfuse.com/docs/observability/sdk/instrumentation). ⚠️ Only use this for non-sensitive values, as attributes are added to **all** outbound HTTP headers[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

---

**User**

is this assessment of it accurate: The phantom parent is propagateAttributes — it creates an OTel context span for trace metadata (name, session, user) but the processor doesn't always export it as a visible observation.
Child spans still reference it as their parent though, creating the broken link.

---

**AI Assistant**

No, that assessment is **not accurate**. `propagateAttributes()` does **not** create a phantom parent span[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

## How it actually works

`propagateAttributes()` uses **OpenTelemetry's context propagation mechanism** to attach attributes to observations—it doesn't create a new span itself[(1)](https://langfuse.com/docs/observability/sdk/instrumentation). The attributes are propagated to all child observations created within its scope through OTel's baggage or context system[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

From the documentation: "When you create a new observation using `start_as_current_observation()`, it becomes a child of the observation that was active in the context when it was created"[(1)](https://langfuse.com/docs/observability/sdk/instrumentation). The `propagateAttributes()` wrapper simply ensures certain attributes (`userId`, `sessionId`, `metadata`, `tags`, `version`, `traceName`) are automatically added to those observations[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

## What creates parent-child relationships

Parent-child relationships are established by **the observation creation methods** (`start_as_current_observation()`, `startActiveObservation()`, etc.), not by `propagateAttributes()`[(1)](https://langfuse.com/docs/observability/sdk/instrumentation). These methods use OpenTelemetry's context to determine the current active span and make new observations children of it[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)[(2)](https://langfuse.com/docs/observability/sdk/overview).

If you're seeing broken links or missing parent observations, it's more likely due to:

- Filtering rules dropping certain spans while keeping their children[(3)](https://langfuse.com/docs/observability/sdk/upgrade-path/python-v3-to-v4)
- Using manual observation creation (`start_observation()`) which doesn't change the active context[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)
- Issues with how trace attributes are merged server-side[(4)](https://github.com/orgs/langfuse/discussions/11127)[(5)](https://github.com/langfuse/langfuse/issues/10945)

`propagateAttributes()` is purely an **attribute injection mechanism**, not a span creation mechanism[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

---

**User**

what can be used instead of setActiveTraceIO() in this code
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { langfuseSpanProcessor } from '@/instrumentation'
import { getModelWithFallbacks } from '@/lib/ai/model'
import { observe, propagateAttributes, setActiveTraceIO } from '@langfuse/tracing'
import { trace } from '@opentelemetry/api'
import { streamText } from 'ai'
import { after } from 'next/server'
import { z } from 'zod'

const chatRequestSchema = z.object({
messages: z
.array(
z.object({
role: z.enum(['user', 'assistant', 'system']),
content: z.string(),
}),
)
.min(1, 'messages must be a non-empty array'),
matterId: z.string().optional(),
})

type MessageRole = 'user' | 'assistant' | 'system'

interface Message {
role: MessageRole
content: string
}

async function tryStreamText(models: LanguageModelV3[], system: string, messages: Message[]) {
let lastError: unknown

const numberOfModels = models.length
for (let index = 0; index < numberOfModels; index++) {
const model = models[index]
try {
const result = streamText({
model,
system,
messages,
experimental_telemetry: { isEnabled: true },
onFinish: ({ text }) => {
setActiveTraceIO({ output: text })
trace.getActiveSpan()?.end()
},
onError: (error) => {
setActiveTraceIO({ output: String(error) })
trace.getActiveSpan()?.end()
},
})

      after(async () => await langfuseSpanProcessor.forceFlush())

      return result.toTextStreamResponse()
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel = index + 1 < numberOfModels ? models[index + 1] : null
      const nextModelId = nextModel && 'modelId' in nextModel ? nextModel.modelId : null

      if (nextModelId) {
        console.warn(`Provider failed, trying ${nextModelId} as fallback: ${errorMessage}`)
      } else {
        console.warn(`Provider failed, no more fallbacks available: ${errorMessage}`)
      }
    }

}

throw lastError
}

const handler = async (req: Request) => {
let body: unknown
try {
body = await req.json()
} catch {
return new Response('Invalid JSON', { status: 400 })
}

const parsed = chatRequestSchema.safeParse(body)
if (!parsed.success) {
return new Response(parsed.error.issues[0].message, { status: 400 })
}

const { messages, matterId } = parsed.data
const resolvedMatterId = matterId ?? 'test-matter-001'

const system =
'You are a legal workflow assistant helping with conveyancing matters in Australia.'

setActiveTraceIO({ input: { system, messages } })

return propagateAttributes(
{
traceName: 'matter-chat',
sessionId: resolvedMatterId,
userId: 'demo-user',
version: '1.0',
metadata: { env: 'demo' },
tags: ['conversational'],
},
async () => {
try {
return await tryStreamText(getModelWithFallbacks(), system, messages)
} catch (err) {
console.error('All providers failed:', err instanceof Error ? err.message : String(err))
return new Response('All AI providers are currently unavailable. Please try again later.', {
status: 503,
})
}
},
)
}

export const POST = observe(handler, {
name: 'handle-chat-message',
endOnExit: false,
})

---

**AI Assistant**

Based on the upgrade documentation, `setActiveTraceIO()` is **deprecated** and exists only for backward compatibility with trace-level LLM-as-a-judge evaluators[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5). For new code, you should set input/output **directly on the root observation** instead[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5).

## Recommended approach

Set the input/output on your root observation (the one created by `observe()`):

```typescript
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { langfuseSpanProcessor } from '@/instrumentation'
import { getModelWithFallbacks } from '@/lib/ai/model'
import { observe, propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { trace } from '@opentelemetry/api'
import { streamText } from 'ai'
import { after } from 'next/server'
import { z } from 'zod'

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .min(1, 'messages must be a non-empty array'),
  matterId: z.string().optional(),
})

type MessageRole = 'user' | 'assistant' | 'system'

interface Message {
  role: MessageRole
  content: string
}

async function tryStreamText(models: LanguageModelV3[], system: string, messages: Message[]) {
  let lastError: unknown

  const numberOfModels = models.length
  for (let index = 0; index < numberOfModels; index++) {
    const model = models[index]
    try {
      const result = streamText({
        model,
        system,
        messages,
        experimental_telemetry: { isEnabled: true },
        onFinish: ({ text }) => {
          // Set output on the active span instead
          const span = trace.getActiveSpan()
          span?.setAttribute('output', text)
          span?.end()
        },
        onError: (error) => {
          const span = trace.getActiveSpan()
          span?.setAttribute('output', String(error))
          span?.end()
        },
      })

      after(async () => await langfuseSpanProcessor.forceFlush())

      return result.toTextStreamResponse()
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel = index + 1 < numberOfModels ? models[index + 1] : null
      const nextModelId = nextModel && 'modelId' in nextModel ? nextModel.modelId : null

      if (nextModelId) {
        console.warn(`Provider failed, trying ${nextModelId} as fallback: ${errorMessage}`)
      } else {
        console.warn(`Provider failed, no more fallbacks available: ${errorMessage}`)
      }
    }
  }

  throw lastError
}

const handler = async (req: Request) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(parsed.error.issues[0].message, { status: 400 })
  }

  const { messages, matterId } = parsed.data
  const resolvedMatterId = matterId ?? 'test-matter-001'

  const system =
    'You are a legal workflow assistant helping with conveyancing matters in Australia.'

  return propagateAttributes(
    {
      traceName: 'matter-chat',
      sessionId: resolvedMatterId,
      userId: 'demo-user',
      version: '1.0',
      metadata: { env: 'demo' },
      tags: ['conversational'],
    },
    async () => {
      // Wrap in startActiveObservation to set input/output on root span
      return await startActiveObservation('handle-chat-message', async (span) => {
        span.update({ input: { system, messages } })

        try {
          const response = await tryStreamText(getModelWithFallbacks(), system, messages)
          return response
        } catch (err) {
          span.update({ output: String(err) })
          console.error('All providers failed:', err instanceof Error ? err.message : String(err))
          return new Response(
            'All AI providers are currently unavailable. Please try again later.',
            {
              status: 503,
            },
          )
        }
      })
    },
  )
}

export const POST = observe(handler, {
  name: 'handle-chat-message-wrapper',
  endOnExit: false,
})
```

[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)

The key changes:

- Remove all `setActiveTraceIO()` calls
- Use `startActiveObservation()` to get a reference to the root span
- Call `span.update({ input: ... })` and `span.update({ output: ... })` directly on the span object[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)

This approach avoids the deprecated API and sets input/output where they belong—on the actual observation, not the trace[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5).

---

**User**

I tried that method but trace.input and trace.output are both null
{
"trace": {
"id": "6908d6bf52ed4c83132696513c372cfb",
"projectId": "cmne40hg60borad08hh3psijv",
"name": "matter-chat",
"timestamp": "2026-04-04T06:21:09.825Z",
"environment": "demo",
"tags": [
"conversational"
],
"bookmarked": false,
"release": null,
"version": "1.0",
"userId": "demo-user",
"sessionId": "test-matter-001",
"public": false,
"input": null,
"output": null,
"createdAt": "2026-04-04T06:21:17.000Z",
"updatedAt": "2026-04-04T06:21:16.344Z",
"metadata": "{\"env\":\"demo\",\"resourceAttributes\":{\"service.name\":\"unknown_service:/Users/nousunio/.nvm/versions/node/v24.14.0/bin/node\",\"telemetry.sdk.language\":\"nodejs\",\"telemetry.sdk.name\":\"opentelemetry\",\"telemetry.sdk.version\":\"2.6.1\"},\"scope\":{\"name\":\"langfuse-sdk\",\"version\":\"5.0.1\",\"attributes\":{}}}",
"scores": [],
"corrections": [],
"latency": 7.888,
"observations": [
{
"id": "94c48e15915f7ea4",
"traceId": "6908d6bf52ed4c83132696513c372cfb",
"startTime": "2026-04-04T06:21:09.825Z",
"endTime": "2026-04-04T06:21:09.831Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "c9b5ce2757b5286a",
"type": "SPAN",
"environment": "demo",
"name": "handle-chat-message",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:21:16.230Z",
"updatedAt": "2026-04-04T06:21:16.231Z",
"model": null,
"internalModelId": null,
"modelParameters": null,
"completionStartTime": null,
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 0.006,
"timeToFirstToken": null,
"usageDetails": {},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 0,
"outputUsage": 0,
"totalUsage": 0,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
},
{
"id": "d8ab9e3ca45022e6",
"traceId": "6908d6bf52ed4c83132696513c372cfb",
"startTime": "2026-04-04T06:21:09.835Z",
"endTime": "2026-04-04T06:21:17.713Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "c91cd5990ffec8af",
"type": "GENERATION",
"environment": "demo",
"name": "ai.streamText.doStream",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:21:22.941Z",
"updatedAt": "2026-04-04T06:21:22.941Z",
"model": "gemini-2.5-flash",
"internalModelId": "cmcnjkfwn000107l43bf5e8ax",
"modelParameters": {
"maxSteps": null,
"toolChoice": null,
"maxTokens": null,
"finishReason": "stop",
"system": "google.generative-ai",
"maxRetries": "2",
"mode": null,
"temperature": null
},
"completionStartTime": "2026-04-04T06:21:16.157Z",
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 7.878,
"timeToFirstToken": 6.322,
"usageDetails": {
"input": 24,
"output": 378,
"input_cached_tokens": 0,
"output_reasoning_tokens": 1029,
"total": 1431
},
"costDetails": {
"input": 0.0000072,
"output": 0.000945,
"input_cached_tokens": 0,
"total": 0.000952199999
},
"providedCostDetails": {},
"inputCost": 0.0000072,
"outputCost": 0.000945,
"totalCost": 0.000952199999,
"inputUsage": 24,
"outputUsage": 1407,
"totalUsage": 1431,
"usagePricingTierId": "cmcnjkfwn000107l43bf5e8ax_tier_default",
"usagePricingTierName": "Standard",
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
},
{
"id": "c91cd5990ffec8af",
"traceId": "6908d6bf52ed4c83132696513c372cfb",
"startTime": "2026-04-04T06:21:09.831Z",
"endTime": "2026-04-04T06:21:17.713Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "94c48e15915f7ea4",
"type": "SPAN",
"environment": "demo",
"name": "ai.streamText",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:21:22.941Z",
"updatedAt": "2026-04-04T06:21:22.941Z",
"model": null,
"internalModelId": null,
"modelParameters": null,
"completionStartTime": null,
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 7.882,
"timeToFirstToken": null,
"usageDetails": {},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 0,
"outputUsage": 0,
"totalUsage": 0,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
}
]
},
"observations": [
{
"id": "94c48e15915f7ea4",
"traceId": "6908d6bf52ed4c83132696513c372cfb",
"startTime": "2026-04-04T06:21:09.825Z",
"endTime": "2026-04-04T06:21:09.831Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "c9b5ce2757b5286a",
"type": "SPAN",
"environment": "demo",
"name": "handle-chat-message",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:21:16.230Z",
"updatedAt": "2026-04-04T06:21:16.231Z",
"model": null,
"internalModelId": null,
"modelParameters": null,
"completionStartTime": null,
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 0.006,
"timeToFirstToken": null,
"usageDetails": {},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 0,
"outputUsage": 0,
"totalUsage": 0,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
},
{
"id": "d8ab9e3ca45022e6",
"traceId": "6908d6bf52ed4c83132696513c372cfb",
"startTime": "2026-04-04T06:21:09.835Z",
"endTime": "2026-04-04T06:21:17.713Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "c91cd5990ffec8af",
"type": "GENERATION",
"environment": "demo",
"name": "ai.streamText.doStream",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:21:22.941Z",
"updatedAt": "2026-04-04T06:21:22.941Z",
"model": "gemini-2.5-flash",
"internalModelId": "cmcnjkfwn000107l43bf5e8ax",
"modelParameters": {
"maxSteps": null,
"toolChoice": null,
"maxTokens": null,
"finishReason": "stop",
"system": "google.generative-ai",
"maxRetries": "2",
"mode": null,
"temperature": null
},
"completionStartTime": "2026-04-04T06:21:16.157Z",
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 7.878,
"timeToFirstToken": 6.322,
"usageDetails": {
"input": 24,
"output": 378,
"input_cached_tokens": 0,
"output_reasoning_tokens": 1029,
"total": 1431
},
"costDetails": {
"input": 0.0000072,
"output": 0.000945,
"input_cached_tokens": 0,
"total": 0.000952199999
},
"providedCostDetails": {},
"inputCost": 0.0000072,
"outputCost": 0.000945,
"totalCost": 0.000952199999,
"inputUsage": 24,
"outputUsage": 1407,
"totalUsage": 1431,
"usagePricingTierId": "cmcnjkfwn000107l43bf5e8ax_tier_default",
"usagePricingTierName": "Standard",
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
},
{
"id": "c91cd5990ffec8af",
"traceId": "6908d6bf52ed4c83132696513c372cfb",
"startTime": "2026-04-04T06:21:09.831Z",
"endTime": "2026-04-04T06:21:17.713Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "94c48e15915f7ea4",
"type": "SPAN",
"environment": "demo",
"name": "ai.streamText",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:21:22.941Z",
"updatedAt": "2026-04-04T06:21:22.941Z",
"model": null,
"internalModelId": null,
"modelParameters": null,
"completionStartTime": null,
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 7.882,
"timeToFirstToken": null,
"usageDetails": {},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 0,
"outputUsage": 0,
"totalUsage": 0,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
}
]
}

---

**AI Assistant**

The issue is that your trace has a **missing root observation** (the one with `parentObservationId: "c9b5ce2757b5286a"` doesn't exist in the trace). By default, trace input/output mirror the **root observation's** input/output[(1)](https://langfuse.com/docs/observability/sdk/instrumentation). Since your root observation is missing or filtered out, the trace input/output are null.

Looking at your trace structure, `handle-chat-message` (id: `94c48e15915f7ea4`) references a parent (`c9b5ce2757b5286a`) that doesn't appear in your observations list. This is likely the `observe()` wrapper span being filtered by the smart default span filter introduced in v5[(2)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5).

## Solution: Explicitly set input/output on an observation that will be exported

Since the Vercel AI SDK automatically creates generation spans with `experimental_telemetry: { isEnabled: true }`[(1)](https://langfuse.com/docs/observability/sdk/instrumentation), you should set the input/output directly on those spans instead of trying to create another wrapper:

```typescript
async function tryStreamText(models: LanguageModelV3[], system: string, messages: Message[]) {
  let lastError: unknown

  const numberOfModels = models.length
  for (let index = 0; index < numberOfModels; index++) {
    const model = models[index]
    try {
      const result = streamText({
        model,
        system,
        messages,
        experimental_telemetry: {
          isEnabled: true,
          metadata: {
            traceInput: JSON.stringify({ system, messages }), // Store input in metadata
          },
        },
        onFinish: ({ text }) => {
          const span = trace.getActiveSpan()
          // Set on the generation span created by Vercel AI SDK
          span?.setAttribute('langfuse.trace.input', JSON.stringify({ system, messages }))
          span?.setAttribute('langfuse.trace.output', text)
          span?.end()
        },
        onError: (error) => {
          const span = trace.getActiveSpan()
          span?.setAttribute('langfuse.trace.output', String(error))
          span?.end()
        },
      })

      after(async () => await langfuseSpanProcessor.forceFlush())

      return result.toTextStreamResponse()
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel = index + 1 < numberOfModels ? models[index + 1] : null
      const nextModelId = nextModel && 'modelId' in nextModel ? nextModel.modelId : null

      if (nextModelId) {
        console.warn(`Provider failed, trying ${nextModelId} as fallback: ${errorMessage}`)
      } else {
        console.warn(`Provider failed, no more fallbacks available: ${errorMessage}`)
      }
    }
  }

  throw lastError
}

const handler = async (req: Request) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(parsed.error.issues[0].message, { status: 400 })
  }

  const { messages, matterId } = parsed.data
  const resolvedMatterId = matterId ?? 'test-matter-001'

  const system =
    'You are a legal workflow assistant helping with conveyancing matters in Australia.'

  return propagateAttributes(
    {
      traceName: 'matter-chat',
      sessionId: resolvedMatterId,
      userId: 'demo-user',
      version: '1.0',
      metadata: { env: 'demo' },
      tags: ['conversational'],
    },
    async () => {
      try {
        return await tryStreamText(getModelWithFallbacks(), system, messages)
      } catch (err) {
        console.error('All providers failed:', err instanceof Error ? err.message : String(err))
        return new Response('All AI providers are currently unavailable. Please try again later.', {
          status: 503,
        })
      }
    },
  )
}

// Remove the observe wrapper - it's being filtered out
export const POST = handler
```

The key changes:

- Use `langfuse.trace.input` and `langfuse.trace.output` OpenTelemetry attributes[(3)](https://github.com/orgs/langfuse/discussions/9943) to explicitly set trace-level input/output
- Remove the `observe()` wrapper since it's creating a span that gets filtered, breaking the parent chain
- Let the Vercel AI SDK's automatic telemetry create the root observation[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)

This approach ensures the generation span (which won't be filtered) becomes the root observation with proper input/output set at the trace level.

---

**User**

still didn't work this is how I did it
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { langfuseSpanProcessor } from '@/instrumentation'
import { getModelWithFallbacks } from '@/lib/ai/model'
import { observe, propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { trace } from '@opentelemetry/api'
import { streamText } from 'ai'
import { after } from 'next/server'
import { z } from 'zod'

const chatRequestSchema = z.object({
messages: z
.array(
z.object({
role: z.enum(['user', 'assistant', 'system']),
content: z.string(),
}),
)
.min(1, 'messages must be a non-empty array'),
matterId: z.string().optional(),
})

type MessageRole = 'user' | 'assistant' | 'system'

interface Message {
role: MessageRole
content: string
}

async function tryStreamText(models: LanguageModelV3[], system: string, messages: Message[]) {
let lastError: unknown

const numberOfModels = models.length
for (let index = 0; index < numberOfModels; index++) {
const model = models[index]
try {
const result = streamText({
model,
system,
messages,
experimental_telemetry: {
isEnabled: true,
metadata: {
traceInput: JSON.stringify({ system, messages }), // Store input in metadata
},
},
onFinish: ({ text }) => {
const span = trace.getActiveSpan()
// Set on the generation span created by Vercel AI SDK
span?.setAttribute('langfuse.trace.input', JSON.stringify({ system, messages }))
span?.setAttribute('langfuse.trace.output', text)
span?.end()
},
onError: (error) => {
console.log('errrol', error)
const span = trace.getActiveSpan()
span?.setAttribute('langfuse.trace.output', String(error))
span?.end()
},
})

      console.log('second', await result.warnings)
      after(async () => await langfuseSpanProcessor.forceFlush())

      return result.toTextStreamResponse()
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel = index + 1 < numberOfModels ? models[index + 1] : null
      const nextModelId = nextModel && 'modelId' in nextModel ? nextModel.modelId : null

      if (nextModelId) {
        console.warn(`Provider failed, trying ${nextModelId} as fallback: ${errorMessage}`)
      } else {
        console.warn(`Provider failed, no more fallbacks available: ${errorMessage}`)
      }
    }

}

throw lastError
}

const handler = async (req: Request) => {
let body: unknown
try {
body = await req.json()
} catch {
return new Response('Invalid JSON', { status: 400 })
}

const parsed = chatRequestSchema.safeParse(body)
if (!parsed.success) {
return new Response(parsed.error.issues[0].message, { status: 400 })
}

const { messages, matterId } = parsed.data
const resolvedMatterId = matterId ?? 'test-matter-001'

const system =
'You are a legal workflow assistant helping with conveyancing matters in Australia.'

return propagateAttributes(
{
traceName: 'matter-chat',
sessionId: resolvedMatterId,
userId: 'demo-user',
version: '1.0',
metadata: { env: 'demo' },
tags: ['conversational'],
},
async () => {
try {
return await tryStreamText(getModelWithFallbacks(), system, messages)
} catch (err) {
console.error('All providers failed:', err instanceof Error ? err.message : String(err))
return new Response('All AI providers are currently unavailable. Please try again later.', {
status: 503,
})
}
},
)
}

// Remove the observe wrapper - it's being filtered out
export const POST = handler
This is what's received
{
"trace": {
"id": "a29a338d81a36e40fba9bfb17b425c02",
"projectId": "cmne40hg60borad08hh3psijv",
"name": "matter-chat",
"timestamp": "2026-04-04T06:46:02.828Z",
"environment": "demo",
"tags": [
"conversational"
],
"bookmarked": false,
"release": null,
"version": "1.0",
"userId": "demo-user",
"sessionId": "test-matter-001",
"public": false,
"input": null,
"output": null,
"createdAt": "2026-04-04T06:46:11.000Z",
"updatedAt": "2026-04-04T06:46:10.334Z",
"metadata": "{\"traceInput\":{\"system\":\"You are a legal workflow assistant helping with conveyancing matters in Australia.\",\"messages\":[{\"role\":\"user\",\"content\":\"What is the first step in conveyancing?\"}]},\"env\":\"demo\",\"resourceAttributes\":{\"service.name\":\"unknown_service:/Users/nousunio/.nvm/versions/node/v24.14.0/bin/node\",\"telemetry.sdk.language\":\"nodejs\",\"telemetry.sdk.name\":\"opentelemetry\",\"telemetry.sdk.version\":\"2.6.1\"},\"scope\":{\"name\":\"ai\",\"attributes\":{}}}",
"scores": [],
"corrections": [],
"latency": 1.001,
"observations": [
{
"id": "fa4043fd7006773b",
"traceId": "a29a338d81a36e40fba9bfb17b425c02",
"startTime": "2026-04-04T06:46:02.832Z",
"endTime": "2026-04-04T06:46:03.828Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "13144a0e17b558b2",
"type": "GENERATION",
"environment": "demo",
"name": "ai.streamText.doStream",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:46:10.248Z",
"updatedAt": "2026-04-04T06:46:10.248Z",
"model": "llama-3.3-70b-versatile",
"internalModelId": null,
"modelParameters": {
"maxSteps": null,
"toolChoice": null,
"maxTokens": null,
"finishReason": "stop",
"system": "groq.chat",
"maxRetries": "2",
"mode": null,
"temperature": null
},
"completionStartTime": "2026-04-04T06:46:02.924Z",
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 0.996,
"timeToFirstToken": 0.092,
"usageDetails": {
"input": 58,
"output": 282,
"total": 340
},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 58,
"outputUsage": 282,
"totalUsage": 340,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
},
{
"id": "13144a0e17b558b2",
"traceId": "a29a338d81a36e40fba9bfb17b425c02",
"startTime": "2026-04-04T06:46:02.828Z",
"endTime": "2026-04-04T06:46:03.829Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "49f177aa5dbe56c0",
"type": "SPAN",
"environment": "demo",
"name": "ai.streamText",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:46:10.248Z",
"updatedAt": "2026-04-04T06:46:10.249Z",
"model": null,
"internalModelId": null,
"modelParameters": null,
"completionStartTime": null,
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 1.001,
"timeToFirstToken": null,
"usageDetails": {},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 0,
"outputUsage": 0,
"totalUsage": 0,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
}
]
},
"observations": [
{
"id": "fa4043fd7006773b",
"traceId": "a29a338d81a36e40fba9bfb17b425c02",
"startTime": "2026-04-04T06:46:02.832Z",
"endTime": "2026-04-04T06:46:03.828Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "13144a0e17b558b2",
"type": "GENERATION",
"environment": "demo",
"name": "ai.streamText.doStream",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:46:10.248Z",
"updatedAt": "2026-04-04T06:46:10.248Z",
"model": "llama-3.3-70b-versatile",
"internalModelId": null,
"modelParameters": {
"maxSteps": null,
"toolChoice": null,
"maxTokens": null,
"finishReason": "stop",
"system": "groq.chat",
"maxRetries": "2",
"mode": null,
"temperature": null
},
"completionStartTime": "2026-04-04T06:46:02.924Z",
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 0.996,
"timeToFirstToken": 0.092,
"usageDetails": {
"input": 58,
"output": 282,
"total": 340
},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 58,
"outputUsage": 282,
"totalUsage": 340,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
},
{
"id": "13144a0e17b558b2",
"traceId": "a29a338d81a36e40fba9bfb17b425c02",
"startTime": "2026-04-04T06:46:02.828Z",
"endTime": "2026-04-04T06:46:03.829Z",
"projectId": "cmne40hg60borad08hh3psijv",
"parentObservationId": "49f177aa5dbe56c0",
"type": "SPAN",
"environment": "demo",
"name": "ai.streamText",
"level": "DEFAULT",
"statusMessage": null,
"version": "1.0",
"createdAt": "2026-04-04T06:46:10.248Z",
"updatedAt": "2026-04-04T06:46:10.249Z",
"model": null,
"internalModelId": null,
"modelParameters": null,
"completionStartTime": null,
"promptId": null,
"promptName": null,
"promptVersion": null,
"latency": 1.001,
"timeToFirstToken": null,
"usageDetails": {},
"costDetails": {},
"providedCostDetails": {},
"inputCost": null,
"outputCost": null,
"totalCost": 0,
"inputUsage": 0,
"outputUsage": 0,
"totalUsage": 0,
"usagePricingTierId": null,
"usagePricingTierName": null,
"toolDefinitions": {},
"toolCalls": [],
"toolCallNames": [],
"metadata": "{}"
}
]
}

---

**AI Assistant**

The issue is still the **missing root observation**. Your trace shows `ai.streamText` (id: `13144a0e17b558b2`) has `parentObservationId: "49f177aa5dbe56c0"`, which doesn't exist in your observations. This missing parent is preventing trace input/output from being inferred from the root observation[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

Based on the GitHub discussions, this is a known issue when spans reference parents that get filtered out[(2)](https://github.com/orgs/langfuse/discussions/11127)[(3)](https://github.com/langfuse/langfuse/issues/9970)[(4)](https://github.com/langfuse/langfuse/issues/9556). The workaround is to **explicitly update the trace after all spans are created**[(2)](https://github.com/orgs/langfuse/discussions/11127)[(4)](https://github.com/langfuse/langfuse/issues/9556).

Try this approach using `startActiveObservation` to create a proper root span:

```typescript
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { langfuseSpanProcessor } from '@/instrumentation'
import { getModelWithFallbacks } from '@/lib/ai/model'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { streamText } from 'ai'
import { after } from 'next/server'
import { z } from 'zod'

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .min(1, 'messages must be a non-empty array'),
  matterId: z.string().optional(),
})

type MessageRole = 'user' | 'assistant' | 'system'

interface Message {
  role: MessageRole
  content: string
}

async function tryStreamText(
  models: LanguageModelV3[],
  system: string,
  messages: Message[],
  rootSpan: any,
) {
  let lastError: unknown

  const numberOfModels = models.length
  for (let index = 0; index < numberOfModels; index++) {
    const model = models[index]
    try {
      const result = streamText({
        model,
        system,
        messages,
        experimental_telemetry: { isEnabled: true },
        onFinish: ({ text }) => {
          // Update the root span with the output
          rootSpan.update({ output: text })
        },
        onError: (error) => {
          rootSpan.update({ output: String(error) })
        },
      })

      after(async () => await langfuseSpanProcessor.forceFlush())

      return result.toTextStreamResponse()
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel = index + 1 < numberOfModels ? models[index + 1] : null
      const nextModelId = nextModel && 'modelId' in nextModel ? nextModel.modelId : null

      if (nextModelId) {
        console.warn(`Provider failed, trying ${nextModelId} as fallback: ${errorMessage}`)
      } else {
        console.warn(`Provider failed, no more fallbacks available: ${errorMessage}`)
      }
    }
  }

  throw lastError
}

const handler = async (req: Request) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(parsed.error.issues[0].message, { status: 400 })
  }

  const { messages, matterId } = parsed.data
  const resolvedMatterId = matterId ?? 'test-matter-001'

  const system =
    'You are a legal workflow assistant helping with conveyancing matters in Australia.'

  return propagateAttributes(
    {
      traceName: 'matter-chat',
      sessionId: resolvedMatterId,
      userId: 'demo-user',
      version: '1.0',
      metadata: { env: 'demo' },
      tags: ['conversational'],
    },
    async () => {
      return await startActiveObservation('chat-handler', async (rootSpan) => {
        // Set input on the root span
        rootSpan.update({ input: { system, messages } })

        try {
          return await tryStreamText(getModelWithFallbacks(), system, messages, rootSpan)
        } catch (err) {
          rootSpan.update({ output: String(err) })
          console.error('All providers failed:', err instanceof Error ? err.message : String(err))
          return new Response(
            'All AI providers are currently unavailable. Please try again later.',
            {
              status: 503,
            },
          )
        }
      })
    },
  )
}

export const POST = handler
```

[(1)](https://langfuse.com/docs/observability/sdk/instrumentation)

This creates an explicit root span using `startActiveObservation` and updates its input/output directly[(1)](https://langfuse.com/docs/observability/sdk/instrumentation). The key difference is that `startActiveObservation` ensures the span is properly exported and becomes the root observation[(1)](https://langfuse.com/docs/observability/sdk/instrumentation).

If this still doesn't work, you may need to report this as a bug, as the missing parent span issue appears to be related to how the Vercel AI SDK telemetry interacts with Langfuse's span filtering[(2)](https://github.com/orgs/langfuse/discussions/11127)[(3)](https://github.com/langfuse/langfuse/issues/9970).

---

**User**

this is still not working, what is causing the problem?

---

**AI Assistant**

Based on the trace data you're seeing, the root cause is the **smart default span filter introduced in v5**[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5). Your observations keep referencing parent spans (like `49f177aa5dbe56c0`) that don't exist because they're being filtered out[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5).

## The Core Problem

The v5 SDK now filters spans by default. A span is only exported if[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5):

- It was created by Langfuse (`langfuse-sdk`)
- It has `gen_ai.*` attributes
- Its instrumentation scope matches known LLM prefixes (like `openinference`, `langsmith`, `haystack`, `litellm`)

Your `propagateAttributes()` wrapper and `startActiveObservation()` calls are creating spans with scope `langfuse-sdk`, but they may be getting filtered if they don't meet the criteria, while the Vercel AI SDK spans (scope `ai`) are being kept[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5).

## Solution: Disable the smart filter

Configure your `LangfuseSpanProcessor` to export all spans[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5):

```typescript
// In your instrumentation.ts file
import { LangfuseSpanProcessor } from '@langfuse/otel'

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  shouldExportSpan: () => true, // Export everything
})
```

[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)

This will ensure your wrapper spans aren't filtered out, fixing the broken parent-child relationships[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5).

## Alternative: Debug what's being filtered

Enable debug logging to see which spans are being dropped[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5):

```bash
LANGFUSE_DEBUG="true"
# or
LANGFUSE_LOG_LEVEL="DEBUG"
```

[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)

Then check your logs to identify which spans are being filtered and adjust your `shouldExportSpan` function accordingly[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5).

## Why `setActiveTraceIO()` was deprecated

The v5 migration guide explains that `setActiveTraceIO()` exists only for backward compatibility with trace-level LLM-as-a-judge evaluators[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5). For new code, you should set input/output on the root observation directly[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5), but this only works if that root observation actually exists in the trace (not filtered out).

The filtering behavior is the fundamental issue preventing your trace input/output from being populated. Fix the filtering first, then the input/output should flow correctly from your root observation.

---

**User**

but if I were to make a bug report which package would it be on?

---

**AI Assistant**

Based on the issue you're experiencing, you should create a bug report on the **main Langfuse repository**:

- Create a bug report on [GitHub](https://langfuse.com/issues)
- [Ask a question to the maintainers](https://langfuse.com/gh-support)

The issue involves the interaction between:

1. **`@langfuse/otel`** (the `LangfuseSpanProcessor` and span filtering logic)
2. **`@langfuse/tracing`** (the `propagateAttributes()` and `startActiveObservation()` functions)
3. **Vercel AI SDK's telemetry** (creating spans with scope `ai`)

Since this is about how these components work together within the Langfuse ecosystem—specifically around the v5 smart default span filter causing parent spans to be dropped while child spans are retained—the bug report should go to the central **[langfuse/langfuse](https://github.com/langfuse/langfuse/issues)** repository[(1)](https://langfuse.com/docs/observability/sdk/advanced-features).

When filing the bug report, include:

- Your trace JSON showing the missing parent observation (`49f177aa5dbe56c0`)
- Your `instrumentation.ts` configuration
- The fact that trace input/output remain null despite using `propagateAttributes()` and `startActiveObservation()`
- Mention this is related to the v5 span filtering behavior introduced in the JS/TS SDK v5[(1)](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5)
