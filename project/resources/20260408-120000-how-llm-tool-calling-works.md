# How LLM Tool Calling Works in This Project

## What It Is

Tool calling lets an LLM interact with external systems (databases, APIs, etc.) without ever having direct access to them. The LLM can only request that a tool be called — your server decides whether to run it and returns the result.

This is the same pattern as MCP (Model Context Protocol), just without the standardised protocol. Your server acts as a tool provider for the LLM.

## Why It Matters for This Project

The conveyancing agent has 6 tools that query and mutate the database (get stages, mark tasks complete, advance stages). The LLM needs to use these tools to answer user questions about matter status and progress, but it should never have direct database access.

## How It Works

### The Flow

```
User: "What should I do next?"
        |
        v
1. Your server sends to LLM API:
   - User's message
   - Tool descriptions (name, description, input schema)
   - System prompt
        |
        v
2. LLM responds with a tool call request (just JSON):
   { tool: "suggestNextActions", args: {} }
        |
        v
3. Your server runs the execute() function locally:
   - Queries your database
   - Returns the result
        |
        v
4. Your server sends the tool result back to the LLM
        |
        v
5. LLM reads the result and either:
   a) Generates a text response for the user, OR
   b) Requests another tool call (back to step 2)
        |
        v
6. Final text response streamed to the user
```

`streamText` handles steps 2-5 automatically in a loop. `stopWhen: stepCountIs(5)` limits this to a maximum of 5 rounds.

### What the LLM Sees

The LLM only ever sees:
- **Tool descriptions** — name, description string, and Zod input schema (so it knows what's available and how to call it)
- **Tool results** — the return value from your `execute` function (after your server runs it)

It never sees your database connection, server code, or internal implementation.

### What the LLM Decides

The LLM chooses which tool to call based on:
- The user's message
- The tool `description` strings
- The system prompt (which provides additional guidance on when to use each tool)

### Where Security Lives

There is no authorisation step at the LLM level — every tool passed to `streamText` is callable. The security layers are:

1. **`description`** — soft guidance telling the LLM when to use a tool (e.g., "Only use IDs returned by getPendingTasks")
2. **`inputSchema` (Zod)** — validates the LLM's input at runtime before `execute` runs. Rejects malformed arguments.
3. **`execute` function** — your server-side code that enforces real business rules:
   - `markActionComplete` verifies the action belongs to the matter (cross-matter guard)
   - `tryAdvanceStage` checks all tasks are complete before allowing advancement
   - `getAgentContext(options)` injects `matterId` and `db` server-side so the LLM can't specify a different matter

### Code Example

```typescript
// Tool definition — description and schema sent to LLM
const markTaskComplete = tool({
  description: "Mark a specific task as complete by its action ID.",
  inputSchema: z.object({
    actionId: z.uuid(),  // Zod validates before execute runs
  }),
  execute: async (input, options) => {
    // Server-side only — LLM never sees this code
    const { matterId, db } = getAgentContext(options)
    const updated = await markActionComplete(db, input.actionId, matterId)
    return { success: true, description: updated.description }
  },
})

// Passed to streamText — makes all tools available to the LLM
streamText({
  model,
  messages,
  tools: { markTaskComplete, getCurrentStage, /* ... */ },
  stopWhen: stepCountIs(5),  // Max 5 tool call rounds
})
```

## Comparison with MCP

| Aspect | This Project | MCP |
|--------|-------------|-----|
| Protocol | Proprietary (AI SDK) | Standardised (JSON-RPC) |
| Discovery | Hardcoded at compile time | Dynamic discovery |
| Transport | HTTP to LLM API | stdio, HTTP SSE |
| Trust model | Same — server executes, LLM requests | Same |
| Execution flow | Same — describe → request → execute → return | Same |

## References

- `src/lib/ai/tools.ts` — the 6 tool definitions
- `src/lib/ai/agent-context.ts` — server-side context injection
- `src/app/api/chat/route.ts` — `streamText` with tools
- [AI SDK Tool Calling docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [MCP specification](https://modelcontextprotocol.io/)
