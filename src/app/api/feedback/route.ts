import { after } from "next/server"
import { z } from "zod"
import { langfuseSpanProcessor } from "@/instrumentation"
import { langfuseClient } from "@/lib/langfuse/client"

const feedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  score: z.union([z.literal(0), z.literal(1)]),
  comment: z.string().max(500).optional(),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  const parsed = feedbackRequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(parsed.error.issues[0].message, { status: 400 })
  }

  const { traceId, score, comment } = parsed.data

  after(async () => {
    try {
      await langfuseClient.legacy.scoreV1.create({
        traceId,
        name: "user-feedback",
        value: score,
        dataType: "BOOLEAN",
        comment,
      })
    } catch (err) {
      console.error(
        "Failed to submit Langfuse score:",
        err instanceof Error ? err.message : String(err),
      )
    }
    await langfuseSpanProcessor.forceFlush()
  })

  return Response.json({ ok: true })
}
