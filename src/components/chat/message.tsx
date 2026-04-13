"use client"

import { isTextUIPart, isToolUIPart } from "ai"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ChatMessage, FeedbackStatus } from "@/lib/ai/chat-types"
import { FeedbackButtons } from "./FeedbackButtons"
import { ToolIndicator } from "./ToolIndicator"

interface MessageProps {
  message: ChatMessage
  feedbackStatus?: FeedbackStatus
  onFeedback?: (score: "thumbs-up" | "thumbs-down") => void
  onCommentSubmitted?: () => void
}

function hasSubstantiveText(message: ChatMessage): boolean {
  return message.parts
    .filter(isTextUIPart)
    .some((p) => p.text.trim().length > 0)
}

export function Message({
  message,
  feedbackStatus,
  onFeedback,
  onCommentSubmitted,
}: MessageProps) {
  const isUser = message.role === "user"

  const showFeedback =
    !isUser &&
    hasSubstantiveText(message) &&
    message.metadata?.langfuseTraceId != null &&
    onFeedback != null

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] ${
          isUser
            ? "rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2 text-sm text-white"
            : "w-full"
        }`}
      >
        {isUser ? (
          // User messages: plain text from all text parts
          <span>
            {message.parts
              .filter(isTextUIPart)
              .map((p) => p.text)
              .join(" ")}
          </span>
        ) : (
          // Assistant messages: render each part
          <div className="space-y-2">
            {message.parts.map((part, partIndex) => {
              const key = `text-${part.type}-${partIndex}`
              if (isTextUIPart(part)) {
                return (
                  <div
                    key={key}
                    className="markdown-body text-sm text-gray-800"
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {part.text}
                    </ReactMarkdown>
                  </div>
                )
              }

              if (isToolUIPart(part)) {
                return <ToolIndicator key={key} part={part} />
              }

              return null
            })}
            {showFeedback && onFeedback && (
              <FeedbackButtons
                traceId={message.metadata?.langfuseTraceId ?? ""}
                status={feedbackStatus ?? "idle"}
                onSubmit={onFeedback}
                onCommentSubmitted={onCommentSubmitted ?? (() => {})}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
