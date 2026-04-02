import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { streamText } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/model";

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

export const POST = async (req: Request) => {
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

	return startActiveObservation(
		"test-capture-i-o-explicit-update",
		async (span) => {
			span.update({
				input: { messages },
			});

			return propagateAttributes(
				{
					sessionId: resolvedMatterId,
					userId: "demo-user",
					version: "1.0",
					metadata: { env: "demo" },
					tags: ["conversational"],
				},
				async () => {
					const result = streamText({
						model: getModel(),
						system:
							"You are a legal workflow assistant helping with conveyancing matters in Australia.",
						messages,
						experimental_telemetry: { isEnabled: true },
					});

					const response = result.toTextStreamResponse();

					span.update({
						output: { response: await result.text },
					});

					return response;
				},
			);
		},
	);
};
