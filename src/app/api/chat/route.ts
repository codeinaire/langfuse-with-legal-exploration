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
      z
        .object({
          id: z.string(),
          role: z.enum(["user", "assistant", "system"]),
          parts: z.array(uiMessagePartSchema),
        })
        .passthrough(),
    )
    .min(1, "messages must be a non-empty array"),
  matterId: z.uuid("matterId must be a valid UUID"),
})

/**
 * Streams a UIMessage response using the given model providers in order.
 * If a provider throws synchronously at call time (e.g. bad auth, rate-limit
 * before streaming starts), falls back to the next provider.
 * Streaming errors after the first chunk are surfaced to the client via
 * the UIMessage stream error protocol.
 */
async function tryStreamText(
  modelProviders: LanguageModelV3[],
  system: string,
  uiMessages: ChatMessage[],
  agentContext: { matterId: string; db: typeof db },
) {
  let lastError: unknown

  const traceId = getActiveTraceId()
  if (!traceId) {
    console.warn(
      "No active Langfuse trace ID at stream start -- user feedback will be unavailable for this message",
    )
  }

  const modelMessages = await convertToModelMessages(uiMessages)
  const numberOfProviders = modelProviders.length

  for (let index = 0; index < numberOfProviders; index++) {
    const model = modelProviders[index]
    const modelId = "modelId" in model ? model.modelId : "unknown"
    console.info(`Using model: ${modelId}`)
    try {
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
    } catch (err) {
      lastError = err
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextModel =
        index + 1 < numberOfProviders ? modelProviders[index + 1] : null
      const nextModelId =
        nextModel && "modelId" in nextModel ? nextModel.modelId : null

      if (nextModelId) {
        console.warn(
          `Provider failed, trying ${nextModelId} as fallback: ${errorMessage}`,
        )
      } else {
        console.warn(
          `Provider failed, no more fallbacks available: ${errorMessage}`,
        )
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
    return new Response("Invalid JSON", { status: 400 })
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(parsed.error.issues[0].message, { status: 400 })
  }

  const { messages, matterId } = parsed.data
  const uiMessages = messages as ChatMessage[]

  const agentContext = { matterId, db }

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

  return propagateAttributes(
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

      try {
        return await tryStreamText(
          getModelWithFallbacks(),
          systemPrompt,
          uiMessages,
          agentContext,
        )
      } catch (err) {
        console.error(
          "All providers failed:",
          err instanceof Error ? err.message : String(err),
        )
        return new Response(
          "All AI providers are currently unavailable. Please try again later.",
          { status: 503 },
        )
      }
    },
  )
}

export const POST = observe(handler, {
  name: "chat-handler",
  endOnExit: false,
})
