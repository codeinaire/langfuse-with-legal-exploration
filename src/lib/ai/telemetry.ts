// Shared telemetry configuration helper for Vercel AI SDK calls.
// Uses the SDK's TelemetrySettings type directly.
//
// Langfuse reads `sessionId` and `userId` from metadata to group traces.
//
// Usage:
//   streamText({
//     ...
//     experimental_telemetry: createTelemetryConfig({ functionId: 'matter-chat', matterId }),
//   })

import type { TelemetrySettings } from "ai";

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
