"use client";

import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import { getToolName, isToolUIPart } from "ai";

interface ToolIndicatorProps {
  part: UIMessagePart<UIDataTypes, UITools>;
}

/**
 * Converts camelCase to Title Case.
 * e.g. "getCurrentStage" -> "Get Current Stage"
 */
function toTitleCase(camelCase: string): string {
  return camelCase
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * Returns the state from a tool part.
 */
function getPartState(
  part: UIMessagePart<UIDataTypes, UITools>,
): string | undefined {
  if (
    typeof part === "object" &&
    part !== null &&
    "state" in part &&
    typeof (part as { state?: unknown }).state === "string"
  ) {
    return (part as { state: string }).state;
  }
  return undefined;
}

export function ToolIndicator({ part }: ToolIndicatorProps) {
  if (!isToolUIPart(part)) return null;

  const rawName = getToolName(part);
  const displayName = toTitleCase(rawName);
  const state = getPartState(part);

  if (state === "input-streaming" || state === "input-available") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
        <span>Calling {displayName}...</span>
      </div>
    );
  }

  if (state === "output-available") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-100 bg-green-50 px-3 py-1.5 text-xs text-green-700">
        <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
        <span>Called {displayName}</span>
      </div>
    );
  }

  if (state === "output-error") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-700">
        <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
        <span>Error in {displayName}</span>
      </div>
    );
  }

  // Fallback for other states
  return (
    <div className="flex items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
      <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
      <span>{displayName}</span>
    </div>
  );
}
