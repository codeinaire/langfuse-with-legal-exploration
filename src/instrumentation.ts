/**
 * Next.js instrumentation hook -- runs once when the server starts.
 * Initializes the OpenTelemetry provider with Langfuse so all
 * AI SDK calls are automatically traced and visible in Langfuse.
 */
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { validateModelProvider } from '@/lib/ai/model'

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com',
  environment: 'demo',
})

export async function register() {
  validateModelProvider()

  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [langfuseSpanProcessor],
  })

  tracerProvider.register()

  console.log('Instrumentation: Langfuse OTel provider registered')
}
