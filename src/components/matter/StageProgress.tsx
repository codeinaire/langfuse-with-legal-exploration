interface Stage {
  id: string
  stage: string
  status: string
  startedAt: Date | string | null
  completedAt: Date | string | null
  totalActions: number
  completedActions: number
}

interface StageProgressProps {
  stages: Stage[]
  currentStage: string
}

const LOWERCASE_WORDS = new Set(["and", "of", "the", "in", "for", "to", "on"])

/**
 * Converts a snake_case enum value to Title Case display name.
 * e.g. "engagement_and_onboarding" -> "Engagement and Onboarding"
 */
function toDisplayName(enumValue: string): string {
  return enumValue
    .split("_")
    .map((word, index) => {
      if (index > 0 && LOWERCASE_WORDS.has(word)) return word
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`
    })
    .join(" ")
}

/**
 * Formats a Date or ISO string to a short date display.
 *
 * @example new Date("2026-04-08T10:30:00Z") -> "8 Apr 2026"
 */
function formatDate(date: Date | string | null | undefined): string {
  if (!date) return ""
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function StageProgress({ stages, currentStage }: StageProgressProps) {
  return (
    <div className="p-4">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">
        Stage Progress
      </h2>
      <ol className="space-y-1">
        {stages.map((stage, index) => {
          const isCompleted = stage.status === "completed"
          const isCurrent = stage.stage === currentStage

          return (
            <li key={stage.id} className="flex gap-3">
              {/* Step indicator */}
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    isCompleted
                      ? "bg-green-500 text-white"
                      : isCurrent
                        ? "bg-blue-600 text-white ring-2 ring-blue-200"
                        : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {isCompleted ? (
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <title>Completed</title>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                {/* Connector line */}
                {index < stages.length - 1 && (
                  <div
                    className={`mt-0.5 h-4 w-0.5 ${
                      isCompleted ? "bg-green-300" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>

              {/* Stage info */}
              <div className="pb-2">
                <p
                  className={`text-xs font-medium leading-6 ${
                    isCompleted
                      ? "text-green-700"
                      : isCurrent
                        ? "text-blue-700"
                        : "text-gray-400"
                  }`}
                >
                  {toDisplayName(stage.stage)}
                </p>

                {/* Current stage: show task count */}
                {isCurrent && (
                  <p className="text-xs text-gray-500">
                    {stage.completedActions} / {stage.totalActions} tasks
                  </p>
                )}

                {/* Completed stage: show completion date */}
                {isCompleted && stage.completedAt && (
                  <p className="text-xs text-gray-400">
                    {formatDate(stage.completedAt)}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
