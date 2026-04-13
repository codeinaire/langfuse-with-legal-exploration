"use client"

import { useState } from "react"
import { ChatBubbleIcon } from "@/components/icons/chat-bubble"
import { ThumbsDownIcon } from "@/components/icons/thumbs-down"
import { ThumbsUpIcon } from "@/components/icons/thumbs-up"
import type { FeedbackScore } from "@/lib/ai/chat-types"
import { FeedbackModal } from "./feedback-modal"
import type { FeedbackStatus } from "./message"

interface FeedbackButtonsProps {
  status: FeedbackStatus
  onSubmit: (score: FeedbackScore, comment?: string) => Promise<boolean>
}

export function FeedbackButtons({ status, onSubmit }: FeedbackButtonsProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [commentError, setCommentError] = useState(false)

  const isDisabled =
    status === "submitting" ||
    status === "submitted-up" ||
    status === "submitted-down" ||
    status === "submitted-comment"

  const handleCommentSubmit = async (comment: string) => {
    setCommentSubmitting(true)
    setCommentError(false)
    const success = await onSubmit("comment", comment)
    setCommentSubmitting(false)
    if (success) {
      setModalOpen(false)
    } else {
      setCommentError(true)
    }
  }

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
          disabled={isDisabled}
          onClick={() => setModalOpen(true)}
          className={`rounded p-1 transition disabled:opacity-50 ${
            status === "submitted-comment"
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
        onSubmit={handleCommentSubmit}
        submitting={commentSubmitting}
        error={commentError}
      />
    </>
  )
}
