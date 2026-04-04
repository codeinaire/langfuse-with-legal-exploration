import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import type { LanguageModelV3 } from "@ai-sdk/provider";

type AIProvider = "gemini" | "groq";

const DEFAULT_PROVIDER: AIProvider = "gemini";

const FALLBACK_ORDER: Record<AIProvider, AIProvider[]> = {
	gemini: ["groq"],
	groq: ["gemini"],
};

const MODEL_MAP: Record<AIProvider, () => LanguageModelV3> = {
	gemini: () => google("gemini-2.5-flash"),
	groq: () => groq("llama-3.3-70b-versatile"),
};

function isAIProvider(value: string): value is AIProvider {
	return value in MODEL_MAP;
}

let resolvedProvider: AIProvider = DEFAULT_PROVIDER;

export function validateModelProvider(): void {
	const raw = process.env.AI_PROVIDER ?? DEFAULT_PROVIDER;
	if (!isAIProvider(raw)) {
		console.warn(
			`Unknown AI_PROVIDER: "${raw}". Valid options are: ${Object.keys(MODEL_MAP).join(", ")}. Falling back to "${DEFAULT_PROVIDER}".`,
		);
		resolvedProvider = DEFAULT_PROVIDER;
		return;
	}
	resolvedProvider = raw;
}

export function getModel(): LanguageModelV3 {
	return MODEL_MAP[resolvedProvider]();
}

export function getModelWithFallbacks(): LanguageModelV3[] {
	const primary = resolvedProvider;
	const fallbacks = FALLBACK_ORDER[primary];
	return [MODEL_MAP[primary](), ...fallbacks.map((p) => MODEL_MAP[p]())];
}
