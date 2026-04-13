import type { LanguageModelV3 } from "@ai-sdk/provider"
import {
  getActiveTraceId,
  observe,
  propagateAttributes,
  setActiveTraceIO,
  updateActiveObservation,
} from "@langfuse/tracing"
import { trace } from "@opentelemetry/api"
import { convertToModelMessages, stepCountIs, streamText } from "ai"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/db"
import { langfuseSpanProcessor } from "@/instrumentation"
import type { ChatMessage } from "@/lib/ai/chat-types"
import { getModelWithFallbacks } from "@/lib/ai/model"
import { getSystemPrompt } from "@/lib/ai/prompts"
import { conveyancingTools } from "@/lib/ai/tools"

// Next.js route segment config -- multi-step agent can take >15 seconds
export const maxDuration = 60

const uiMessagePartSchema = z.looseObject({ type: z.string() })

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.looseObject({
        id: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        parts: z.array(uiMessagePartSchema),
      }),
    )
    .min(1, "messages must be a non-empty array"),
  matterId: z.uuid("matterId must be a valid UUID"),
  modelIndex: z.number().int().min(0).default(0),
})

function streamWithModel(
  model: LanguageModelV3,
  system: string,
  modelMessages: Exclude<
    Parameters<typeof streamText>[0]["messages"],
    undefined
  >,
  agentContext: { matterId: string; db: typeof db },
  traceId: string | undefined,
) {
  const result = streamText({
    model,
    system,
    messages: modelMessages,
    tools: conveyancingTools,
    stopWhen: stepCountIs(5),
    experimental_context: agentContext,
    experimental_telemetry: { isEnabled: true },
    onFinish: ({ text }) => {
      updateActiveObservation({ output: text })
      setActiveTraceIO({ output: text })
      trace.getActiveSpan()?.end()
    },
  })

  after(async () => await langfuseSpanProcessor.forceFlush())

  return result.toUIMessageStreamResponse<ChatMessage>({
    messageMetadata: ({ part }) => {
      if (part.type === "start" && traceId) {
        return { langfuseTraceId: traceId }
      }
      return undefined
    },
  })
}

const handler = async (req: Request) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(parsed.error.issues[0].message, { status: 400 })
  }

  const { messages, matterId, modelIndex } = parsed.data
  const uiMessages = messages as ChatMessage[]
  const agentContext = { matterId, db }

  try {
    const {
      text: systemPrompt,
      promptName,
      promptVersion,
      isFallback,
    } = await getSystemPrompt()

    updateActiveObservation({
      input: { system: systemPrompt, messages },
    })
    setActiveTraceIO({ input: { system: systemPrompt, messages } })

    return await propagateAttributes(
      {
        traceName: "conveyancing-legal-matter-chat",
        sessionId: matterId,
        userId: "no-user",
        version: "1.0",
        metadata: { env: "demo" },
        tags: ["conversational"],
      },
      async () => {
        if (!isFallback) {
          updateActiveObservation(
            {
              prompt: {
                name: promptName,
                version: promptVersion,
                isFallback: false,
              },
            },
            { asType: "generation" },
          )
        }

        const traceId = getActiveTraceId()
        if (!traceId) {
          console.warn(
            "No active Langfuse trace ID -- user feedback will be unavailable for this message",
          )
        }

        const modelMessages = await convertToModelMessages(uiMessages)
        const models = getModelWithFallbacks()
        const model = models[modelIndex % models.length]
        const modelId = "modelId" in model ? model.modelId : "unknown"
        console.info(`Using model: ${modelId} (index ${modelIndex})`)

        return streamWithModel(
          model,
          systemPrompt,
          modelMessages,
          agentContext,
          traceId,
        )
      },
    )
  } catch (err) {
    console.error(
      "Unhandled error in chat handler:",
      err instanceof Error ? err.message : String(err),
    )
    return new Response("Internal server error", { status: 500 })
  }
}

export const POST = observe(handler, {
  name: "chat-handler",
  endOnExit: false,
})
