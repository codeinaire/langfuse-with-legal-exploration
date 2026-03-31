import type { TelemetrySettings } from "ai";

/**
 * Shared telemetry configuration helper for Vercel AI SDK calls.
 * Uses the SDK's TelemetrySettings type directly.
 *
 * Langfuse reads `sessionId` and `userId` from metadata to group traces.
 *
 * @example
 * ```ts
 * streamText({
 *   ...
 *   experimental_telemetry: createTelemetryConfig({ functionId: 'matter-chat', matterId }),
 * })
 * ```
 */
export function createTelemetryConfig(options: {
	functionId: string;
	matterId: string;
	userId?: string;
}): TelemetrySettings {
	return {
		isEnabled: true,
		functionId: options.functionId,
		metadata: {
			sessionId: options.matterId,
			userId: options.userId ?? "demo-user",
		},
	};
}
