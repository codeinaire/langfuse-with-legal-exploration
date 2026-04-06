"use client";

import type { UIMessage } from "ai";
import { isTextUIPart, isToolUIPart } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolIndicator } from "./tool-indicator";

interface MessageProps {
  message: UIMessage;
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === "user";

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
              if (isTextUIPart(part)) {
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: message parts are positional and have no stable id
                    key={`text-${partIndex}`}
                    className="markdown-body text-sm text-gray-800"
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {part.text}
                    </ReactMarkdown>
                  </div>
                );
              }

              if (isToolUIPart(part)) {
                // biome-ignore lint/suspicious/noArrayIndexKey: message parts are positional and have no stable id
                return <ToolIndicator key={`tool-${partIndex}`} part={part} />;
              }

              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
