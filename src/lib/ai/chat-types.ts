import type { UIMessage } from "ai"

export type ChatMessageMetadata = { langfuseTraceId?: string }

export type ChatMessage = UIMessage<ChatMessageMetadata>

export type FeedbackScore = "thumbs-up" | "thumbs-down" | "comment"
