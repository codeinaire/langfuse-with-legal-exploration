import { LangfuseClient } from "@langfuse/client"

export const langfuseClient = new LangfuseClient({
  baseUrl: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
})
