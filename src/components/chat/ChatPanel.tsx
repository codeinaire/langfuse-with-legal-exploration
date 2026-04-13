"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChatMessage, FeedbackStatus } from "@/lib/ai/chat-types"
import { Message } from "./Message"

interface ChatPanelProps {
  matterId: string
  pendingActionsCount: number
}

export function ChatPanel({ matterId, pendingActionsCount }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("")
  const [feedbackState, setFeedbackState] = useState<
    Map<string, FeedbackStatus>
  >(() => new Map())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { matterId },
      }),
    [matterId],
  )

  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport,
  })

  // Auto-scroll to bottom when new messages arrive
  const prevMessageCount = useRef(0)
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
    prevMessageCount.current = messages.length
  }, [messages.length])

  // Re-render server components when agent finishes responding
  // so StageProgress gets fresh data from the server.
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      router.refresh()
    }
  }, [status, messages.length, router])

  const handleFeedback = useCallback(
    async (
      messageId: string,
      traceId: string,
      score: "thumbs-up" | "thumbs-down",
    ) => {
      setFeedbackState((prev) => new Map(prev).set(messageId, "submitting"))
      try {
        const numericScore = score === "thumbs-up" ? 1 : 0
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traceId, score: numericScore }),
        })
        if (!res.ok) throw new Error("Request failed")
        setFeedbackState((prev) =>
          new Map(prev).set(
            messageId,
            score === "thumbs-up" ? "submitted-up" : "submitted-down",
          ),
        )
      } catch {
        setFeedbackState((prev) => new Map(prev).set(messageId, "error"))
      }
    },
    [],
  )

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed || status === "streaming") return

    sendMessage({ role: "user", parts: [{ type: "text", text: trimmed }] })
    setInputValue("")
  }

  const isStreaming = status === "streaming"

  return (
    <div className="flex h-full flex-col">
      {/* Welcome message */}
      {messages.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="max-w-md">
            <h2 className="text-lg font-semibold text-gray-800">
              Conveyancing Workflow Assistant
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Ask about the matter status, pending tasks, risks, or request to
              advance to the next stage.
            </p>
            {pendingActionsCount > 0 && (
              <p className="mt-3 text-sm font-medium text-amber-600">
                {pendingActionsCount} pending task
                {pendingActionsCount !== 1 ? "s" : ""} in current stage
              </p>
            )}
            <div className="mt-4 space-y-2">
              <p className="text-xs text-gray-400">Try asking:</p>
              <button
                type="button"
                className="block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 hover:bg-gray-100"
                onClick={() => {
                  sendMessage({
                    role: "user",
                    parts: [
                      {
                        type: "text",
                        text: "What is the current status of this matter?",
                      },
                    ],
                  })
                }}
              >
                &ldquo;What is the current status of this matter?&rdquo;
              </button>
              <button
                type="button"
                className="block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 hover:bg-gray-100"
                onClick={() => {
                  sendMessage({
                    role: "user",
                    parts: [{ type: "text", text: "What should I do next?" }],
                  })
                }}
              >
                &ldquo;What should I do next?&rdquo;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message list */}
      {messages.length > 0 && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => {
            const traceId = message.metadata?.langfuseTraceId
            const canGiveFeedback = status === "ready" && traceId != null
            return (
              <Message
                key={message.id}
                message={message}
                feedbackStatus={feedbackState.get(message.id) ?? "idle"}
                onFeedback={
                  canGiveFeedback
                    ? (score) => handleFeedback(message.id, traceId, score)
                    : undefined
                }
                onCommentSubmitted={
                  canGiveFeedback
                    ? () =>
                        setFeedbackState((prev) =>
                          new Map(prev).set(message.id, "submitted-comment"),
                        )
                    : undefined
                }
              />
            )
          })}
          {isStreaming && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
              Agent is thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mx-4 mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Error: {error.message}
        </div>
      )}

      {/* Input form */}
      <div className="border-t bg-white p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask about this matter..."
            disabled={isStreaming}
            className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={isStreaming || !inputValue.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming ? "..." : "Send"}
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-gray-400">
          Workflow guidance only — not legal advice
        </p>
      </div>
    </div>
  )
}
