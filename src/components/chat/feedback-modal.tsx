"use client"

import { useEffect, useRef, useState } from "react"

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (comment: string) => void
  submitting: boolean
  error?: boolean
}

export function FeedbackModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
}: FeedbackModalProps) {
  const [comment, setComment] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setComment("")
      textareaRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = comment.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h3 className="text-sm font-semibold text-gray-800">Leave feedback</h3>
        <form onSubmit={handleSubmit} className="mt-3">
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 500))}
            placeholder="What could be improved?"
            rows={4}
            className="w-full resize-none rounded border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <p className="mt-1 text-right text-xs text-gray-400">
            {comment.length}/500
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-500">
              Failed to send. Please try again.
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !comment.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
