// Next.js instrumentation hook -- runs once when the server starts.
// Initializes the OpenTelemetry provider with Langfuse so all
// Vercel AI SDK calls are automatically traced and visible in Langfuse.
//
// All OTel imports MUST be inside the NEXT_RUNTIME === 'nodejs' guard
// using dynamic await import(). Top-level OTel imports will crash the Edge runtime.

export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { NodeTracerProvider } = await import(
			"@opentelemetry/sdk-trace-node"
		);
		const { LangfuseSpanProcessor } = await import("@langfuse/otel");

		const provider = new NodeTracerProvider({
			spanProcessors: [
				new LangfuseSpanProcessor({
					publicKey: process.env.LANGFUSE_PUBLIC_KEY,
					secretKey: process.env.LANGFUSE_SECRET_KEY,
					baseUrl: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
				}),
			],
		});

		provider.register();

		console.log("Instrumentation: Langfuse OTel provider registered");
	}
}
