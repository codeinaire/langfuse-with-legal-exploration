// Test API route for Langfuse OTel observability integration.
// Accepts a chat message and matter ID, calls Gemini via the AI SDK with
// telemetry enabled, and streams the response back.
//
// Uses Node.js runtime (not Edge) because OTel tracing requires Node.js.

import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { z } from "zod";
import { createTelemetryConfig } from "@/lib/ai/telemetry";

const chatRequestSchema = z.object({
	messages: z
		.array(
			z.object({
				role: z.enum(["user", "assistant", "system"]),
				content: z.string(),
			}),
		)
		.min(1, "messages must be a non-empty array"),
	matterId: z.string().optional(),
});

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	const parsed = chatRequestSchema.safeParse(body);
	if (!parsed.success) {
		return new Response(parsed.error.issues[0].message, { status: 400 });
	}

	const { messages, matterId } = parsed.data;
	const resolvedMatterId = matterId ?? "test-matter-001";

	const result = streamText({
		model: google("gemini-2.5-flash"),
		system:
			"You are a legal workflow assistant helping with conveyancing matters in Australia.",
		messages,
		experimental_telemetry: createTelemetryConfig({
			functionId: "matter-chat",
			matterId: resolvedMatterId,
		}),
	});

	return result.toTextStreamResponse();
}
