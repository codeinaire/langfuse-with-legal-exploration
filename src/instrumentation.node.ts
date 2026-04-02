/**
 * Next.js instrumentation hook (Node.js only) -- runs once when the server starts.
 * Initializes the OpenTelemetry provider with Langfuse so all
 * Vercel AI SDK calls are automatically traced and visible in Langfuse.
 *
 * The `.node.ts` suffix ensures Next.js only loads this file in the Node.js runtime.
 */
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export function register() {
	const provider = new NodeTracerProvider({
		spanProcessors: [
			new LangfuseSpanProcessor({
				publicKey: process.env.LANGFUSE_PUBLIC_KEY,
				secretKey: process.env.LANGFUSE_SECRET_KEY,
				baseUrl: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
				environment: "demo",
				// mask: () => {
				// TODO This is used to redact sensitive information or remove data that's not required
				// I might need this in the future when I add users.

				// }
			}),
		],
	});

	provider.register();

	console.log("Instrumentation: Langfuse OTel provider registered");
}
