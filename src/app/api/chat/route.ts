import type { LanguageModelV3 } from '@ai-sdk/provider'
import { propagateAttributes } from '@langfuse/tracing'
import { streamText } from 'ai'
import { z } from 'zod'
import { getModelWithFallbacks } from '@/lib/ai/model'

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

/**
 * This wraps the streamText function with the ability to failover to another model
 * if the current model has errored out
 *
 * @param models - available models
 * @param system - the system prompt attached to the text stream
 * @param messages - the messages sent to the model
 * @returns a stream of text of the model's response
 */
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
      })
      // Force the first chunk to verify the provider actually works
      const response = result.toTextStreamResponse()
      return response
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

export const POST = async (req: Request) => {
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
        return await tryStreamText(
          getModelWithFallbacks(),
          'You are a legal workflow assistant helping with conveyancing matters in Australia.',
          messages,
        )
      } catch (err) {
        console.error('All providers failed:', err instanceof Error ? err.message : String(err))
        return new Response('All AI providers are currently unavailable. Please try again later.', {
          status: 503,
        })
      }
    },
  )
}
