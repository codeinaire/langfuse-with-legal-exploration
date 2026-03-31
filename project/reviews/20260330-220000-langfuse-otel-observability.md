# Code Review: PR #2 — Langfuse Observability Integration

**Date:** 2026-03-30
**Verdict:** WARNING
**Branch:** Feature #2 — Langfuse OTel observability
**Reviewed by:** Code Reviewer (Claude Code)

## Severity Counts

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 2     |
| MEDIUM   | 1     |
| LOW      | 2     |

## Files Reviewed (Full Coverage)

- `src/instrumentation.ts` (new)
- `src/lib/ai/telemetry.ts` (new)
- `src/app/api/chat/route.ts` (new)
- `package.json` (modified)
- `.env.example` (modified)
- `README.md` (modified)
- `project/implemented/20260330-190000-langfuse-otel-observability.md` (committed doc, reviewed for accuracy)

## Key Findings

### HIGH-1: Inaccurate committed implementation doc

`project/implemented/20260330-190000-langfuse-otel-observability.md` contains three factual errors about the actual implementation:

1. Line 27: says "SimpleSpanProcessor(LangfuseExporter)" — the actual code uses `LangfuseSpanProcessor` directly (no wrapper).
2. Line 42: says `toDataStreamResponse()` — the actual code uses `toTextStreamResponse()`.
3. Line 11: lists `ai: ^4.0.0` — the actual `package.json` has `^6.0.141`.

Pattern identical to PR #1. This doc will mislead interviewers and future developers reviewing the implementation history.

### HIGH-2: Missing input validation on `messages` in route.ts

`src/app/api/chat/route.ts:12` — `messages` is destructured from `req.json()` with no validation before being passed to `streamText`. If the client omits `messages`, passes `null`, or passes a non-array, `streamText` receives an invalid value and will throw an unhandled error.

### MEDIUM-1: README setup section not updated for new env vars

`README.md` Setup section still says only "add your Neon connection string." Three new required env vars (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) are not mentioned. A developer following the README will get a silent OTel failure and a broken chat route.

### LOW-1: `req.json()` parse error not handled

`src/app/api/chat/route.ts:12` — Malformed JSON in the request body causes an unhandled thrown error. For a demo this is acceptable but a 400 response would be cleaner.

### LOW-2: README project structure section stale

`README.md` project structure block still shows the old layout without `app/api/` or `lib/ai/` paths introduced by this PR.
