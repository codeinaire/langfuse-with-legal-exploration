import type { LanguageModelV3 } from '@ai-sdk/provider'
import {
  observe,
  propagateAttributes,
  setActiveTraceIO,
  updateActiveObservation,
} from '@langfuse/tracing'
import { trace } from '@opentelemetry/api'
import { streamText } from 'ai'
import { after } from 'next/server'
import { z } from 'zod'
import { langfuseSpanProcessor } from '@/instrumentation'
import { getModelWithFallbacks } from '@/lib/ai/model'

type MessageRole = 'user' | 'assistant' | 'system'

interface Message {
  role: MessageRole
  content: string
}

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

/**
 * Does a streamText call to the selected model provider but if that fails a fallback
 * model provider is utilised and the text response is streamed back
 */
async function tryStreamText(
  modelProviders: LanguageModelV3[],
  system: string,
  messages: Message[],
) {
  let lastError: unknown

  const numberOfProviders = modelProviders.length
  for (let index = 0; index < numberOfProviders; index++) {
    const model = modelProviders[index]
    const modelId = 'modelId' in model ? model.modelId : 'unknown'
    console.info(`Using model: ${modelId}`)
    try {
      const result = streamText({
        model,
        system,
        messages,
        experimental_telemetry: { isEnabled: true },
        onFinish: ({ text }) => {
          updateActiveObservation({ output: text })
          setActiveTraceIO({ output: text })
          trace.getActiveSpan()?.end()
        },
      })

      // Force the provider connection by reading the first chunk.
      // If the provider is down, rate-limited, or has bad auth,
      // this is where it fails — allowing the for loop to catch it
      // and try the next provider.
      const reader = result.textStream[Symbol.asyncIterator]()
      const firstChunk = await reader.next()

      if (firstChunk.done) {
        throw new Error(`${modelId} returned an empty stream`)
      }

      // Provider works — build a response from the verified first chunk
      // plus the remaining stream
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode(firstChunk.value))
          try {
            let next = await reader.next()
            while (!next.done) {
              controller.enqueue(encoder.encode(next.value))
              next = await reader.next()
            }
          } catch (err) {
            console.error(`Stream error mid-response from ${modelId}:`, err)
          } finally {
            controller.close()
          }
        },
      })

      after(async () => await langfuseSpanProcessor.forceFlush())

      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel = index + 1 < numberOfProviders ? modelProviders[index + 1] : null
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
  const resolvedMatterId = matterId ?? `matter-${Date.now()}`

  const system =
    'You are a legal workflow assistant helping with conveyancing matters in Australia.'

  updateActiveObservation({ input: { system, messages } })
  setActiveTraceIO({ input: { system, messages } })

  return propagateAttributes(
    {
      traceName: 'conveyancing-legal-matter-chat',
      sessionId: resolvedMatterId,
      userId: 'no-user',
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
  name: 'chat-handler',
  endOnExit: false,
})
