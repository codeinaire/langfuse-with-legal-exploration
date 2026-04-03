import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import type { LanguageModelV3 } from "@ai-sdk/provider";

type AIProvider = "gemini" | "groq";

const DEFAULT_PROVIDER: AIProvider = "gemini";

const MODEL_MAP: Record<AIProvider, () => LanguageModelV3> = {
	gemini: () => google("gemini-2.5-flash"),
	groq: () => groq("llama-3.3-70b-versatile"),
};

export function getModel(): LanguageModelV3 {
	const provider = process.env.AI_PROVIDER ?? DEFAULT_PROVIDER;

	if (!isAIProvider(provider)) {
		throw new Error(
			`Unknown AI_PROVIDER: "${provider}". Valid options are: ${Object.keys(MODEL_MAP).join(", ")}`,
		);
	}

	return MODEL_MAP[provider]();
}

function isAIProvider(value: string): value is AIProvider {
	return value in MODEL_MAP;
}
