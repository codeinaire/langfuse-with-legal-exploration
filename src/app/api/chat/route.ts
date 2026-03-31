// Test API route for Langfuse OTel observability integration.
// Accepts a chat message and matter ID, calls Gemini via the AI SDK with
// telemetry enabled, and streams the response back.
//
// Uses Node.js runtime (not Edge) because OTel tracing requires Node.js.

import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { createTelemetryConfig } from "@/lib/ai/telemetry";

export async function POST(req: Request) {
	const { messages, matterId } = await req.json();

	const resolvedMatterId: string =
		typeof matterId === "string" && matterId.length > 0
			? matterId
			: "test-matter-001";

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
