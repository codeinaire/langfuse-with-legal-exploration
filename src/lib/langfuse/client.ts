// Fallback path: @langfuse/client was not installed (not present in node_modules).
// Using LangfuseAPIClient from @langfuse/core (already a transitive dependency).
// Scores via: langfuseClient.legacy.scoreV1.create({ traceId, name, value, dataType, comment })
// Verified against node_modules/@langfuse/core/dist/index.d.ts:
//   - LangfuseAPIClient constructor: { environment, username, password } (line 8068)
//   - LangfuseAPIClient.legacy.scoreV1.create(CreateScoreRequest) (line 6188)
//   - CreateScoreRequest: { traceId, name, value, dataType, comment } (line 2895)

import { LangfuseAPIClient } from "@langfuse/core"

export const langfuseClient = new LangfuseAPIClient({
  environment: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
  username: process.env.LANGFUSE_PUBLIC_KEY,
  password: process.env.LANGFUSE_SECRET_KEY,
})
