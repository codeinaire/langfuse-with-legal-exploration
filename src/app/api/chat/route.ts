import { google } from '@ai-sdk/google'
import { propagateAttributes } from '@langfuse/tracing'
import { streamText } from 'ai'
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
      const result = streamText({
        model: google('gemini-2.5-flash'),
        system:
          'You are a legal workflow assistant helping with conveyancing matters in Australia.',
        messages,
        experimental_telemetry: { isEnabled: true },
      })

      return result.toTextStreamResponse()
    },
  )
}
