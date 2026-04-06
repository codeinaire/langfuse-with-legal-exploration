import type { ToolExecutionOptions } from "ai";
import type { db as DbInstance } from "@/db";

/**
 * Context injected server-side via experimental_context into every tool
 * execute function. The LLM never sees or generates these values.
 */
export interface AgentContext {
  matterId: string;
  db: typeof DbInstance;
}

/**
 * Casts options.experimental_context to AgentContext.
 * Single cast point so individual tools never need unsafe casts.
 */
export function getAgentContext(options: ToolExecutionOptions): AgentContext {
  return options.experimental_context as AgentContext;
}
