# Pipeline State

**Task:** Feature #5: User Feedback Loop — thumbs up/down buttons on agent responses, POST to `/api/feedback`, attach Langfuse scores to traces via SDK `score()` method. Key challenge: plumbing the Langfuse trace ID from the streaming response to the frontend.
**Status:** complete
**Last Completed Step:** 5

## Artifacts

| Step | Description | Artifact |
|------|-------------|----------|
| 1 | Research | project/research/20260407-feature-5-user-feedback-loop.md |
| 2 | Plan | project/plans/20260407-140000-feature-5-user-feedback-loop.md |
| 3 | Implement | project/implemented/20260407-140000-feature-5-user-feedback-loop.md |
| 4 | Ship | PR: https://github.com/codeinaire/langfuse-with-legal-exploration/pull/8, Branch: feature/user-feedback-loop |
| 5 | Code Review | project/reviews/20260407-160000-user-feedback-loop-pr8.md |

## User Decisions

- All six research-flagged open questions resolved by orchestrator per research recommendations: Q1 install+verify with @langfuse/core fallback, Q2 cap comment at 500 chars, Q3 trace-scoped, Q4 after() acceptable, Q5 BOOLEAN dataType, Q6 no pre-verify.
- User approved proceeding with Feature #4 pre-existing uncommitted changes carried along in the ship step.
- Lint fix applied during ship: removed non-null assertion `onFeedback!` in `src/components/chat/message.tsx`, replaced with explicit `&& onFeedback` guard.

## Review Verdict

**WARNING** — 0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW. Both findings are advisory-level and not blockers. Recorded as follow-ups.

- MEDIUM: `@langfuse/core` imported directly but not declared in package.json (only transitive via `@langfuse/otel`/`@langfuse/tracing`). Fix: `npm install @langfuse/core@^5.0.2`.
- LOW: `forceFlush()` unguarded after score try/catch in `src/app/api/feedback/route.ts:42`. Same pattern exists in pre-existing `src/app/api/chat/route.ts:85`.

## Notes

- Review was written to file but not posted to GitHub — review agent had neither GitHub MCP nor Bash. Manual posting command is in the review file.
- Previous Feature #4 pre-existing uncommitted changes (`src/app/api/matters/[id]/route.ts`, `src/instrumentation.ts`) were carried along in this PR per user approval.
