import { cerebras } from "@ai-sdk/cerebras";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { mistral } from "@ai-sdk/mistral";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY,
});

type AIProvider = "gemini" | "groq" | "mistral" | "cerebras" | "openrouter";

const DEFAULT_PROVIDER: AIProvider = "gemini";

const FALLBACK_ORDER: Record<AIProvider, AIProvider[]> = {
	gemini: ["groq", "mistral", "cerebras", "openrouter"],
	groq: ["gemini", "mistral", "cerebras", "openrouter"],
	mistral: ["gemini", "groq", "cerebras", "openrouter"],
	cerebras: ["gemini", "groq", "mistral", "openrouter"],
	openrouter: ["gemini", "groq", "mistral", "cerebras"],
};

const MODEL_MAP: Record<AIProvider, () => LanguageModelV3> = {
	gemini: () => google("gemini-2.5-flash"),
	groq: () => groq("meta-llama/llama-4-scout-17b-16e-instruct"),
	mistral: () => mistral("mistral-small-latest"),
	cerebras: () => cerebras("llama3.1-8b") as unknown as LanguageModelV3,
	openrouter: () =>
		openrouter.chat(
			"meta-llama/llama-3.3-70b-instruct:free",
		) as unknown as LanguageModelV3,
};

/**
 * A type guard function that checks whether the ai exists in the model map
 *
 * @param aiProvider
 * @returns boolean
 */
function doesAiProviderExist(aiProvider: string): aiProvider is AIProvider {
	return aiProvider in MODEL_MAP;
}

let resolvedProvider: AIProvider = DEFAULT_PROVIDER;

/**
 * Validates the provided given by the env var is valid, if not it fails gracefully by
 * using the application hard coded model provider
 *
 * @returns void
 */
export function validateModelProvider(): void {
	let validated = false;
	if (validated) return;
	validated = true;
	const aiProvider = process.env.AI_PROVIDER ?? DEFAULT_PROVIDER;
	if (!doesAiProviderExist(aiProvider)) {
		console.warn(
			`Unknown AI_PROVIDER: "${aiProvider}". Valid options are: ${Object.keys(MODEL_MAP).join(", ")}. Falling back to "${DEFAULT_PROVIDER}".`,
		);
		resolvedProvider = DEFAULT_PROVIDER;
		return;
	}
	resolvedProvider = aiProvider;
}

/**
 * Validates the current AI provider and returns that in an array
 * as well as fallback providers if the selected model fails
 *
 *
 * @returns LanguageModelV3
 */
export function getModelWithFallbacks(): LanguageModelV3[] {
	validateModelProvider();
	const primary = resolvedProvider;
	const fallbacks = FALLBACK_ORDER[primary];
	return [MODEL_MAP[primary](), ...fallbacks.map((p) => MODEL_MAP[p]())];
}
