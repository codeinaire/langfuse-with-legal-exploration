"use client"

import { useState } from "react"
import { ChatBubbleIcon } from "@/components/icons/ChatBubble"
import { ThumbsDownIcon } from "@/components/icons/ThumbsDown"
import { ThumbsUpIcon } from "@/components/icons/ThumbsUp"
import type { FeedbackScore } from "@/lib/ai/chat-types"
import { FeedbackModal } from "./FeedbackModal"
import type { FeedbackStatus } from "./Message"

interface FeedbackButtonsProps {
  traceId: string
  status: FeedbackStatus
  onSubmit: (score: FeedbackScore) => void
  onCommentSubmitted: () => void
}

async function submitComment(
  traceId: string,
  comment: string,
): Promise<boolean> {
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traceId, comment }),
    })
    return res.ok
  } catch {
    return false
  }
}

export function FeedbackButtons({
  traceId,
  status,
  onSubmit,
  onCommentSubmitted,
}: FeedbackButtonsProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [commentError, setCommentError] = useState(false)
  const [commentSubmitted, setCommentSubmitted] = useState(false)

  const isDisabled =
    status === "submitting" ||
    status === "submitted-up" ||
    status === "submitted-down"

  return (
    <>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => onSubmit("thumbs-up")}
          className={`rounded p-1 transition disabled:opacity-50 ${
            status === "submitted-up"
              ? "text-green-600"
              : "text-gray-400 hover:text-gray-700"
          }`}
          aria-label="Helpful"
        >
          <ThumbsUpIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => onSubmit("thumbs-down")}
          className={`rounded p-1 transition disabled:opacity-50 ${
            status === "submitted-down"
              ? "text-red-600"
              : "text-gray-400 hover:text-gray-700"
          }`}
          aria-label="Not helpful"
        >
          <ThumbsDownIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={commentSubmitted}
          onClick={() => setModalOpen(true)}
          className={`rounded p-1 transition disabled:opacity-50 ${
            commentSubmitted
              ? "text-blue-600"
              : "text-gray-400 hover:text-gray-700"
          }`}
          aria-label="Leave feedback"
        >
          <ChatBubbleIcon className="h-4 w-4" />
        </button>
        {status === "error" && (
          <span className="text-xs text-red-500">Failed, try again</span>
        )}
      </div>
      <FeedbackModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setCommentError(false)
        }}
        onSubmit={async (comment) => {
          setCommentSubmitting(true)
          setCommentError(false)
          const success = await submitComment(traceId, comment)
          setCommentSubmitting(false)
          if (success) {
            setCommentSubmitted(true)
            setModalOpen(false)
            onCommentSubmitted()
          } else {
            setCommentError(true)
          }
        }}
        submitting={commentSubmitting}
        error={commentError}
      />
    </>
  )
}
