# Frontend Review Fixes — 2026-04-13

## HIGH

- [x] **Fix message.tsx casing conflict** — Git tracked `message.tsx` (lowercase) but disk had `Message.tsx`. Fixed via `git rm --cached` + `git add` with correct casing. Prevents Linux/Vercel build failures.

- [x] **Add accessibility semantics to FeedbackModal** — Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to the modal container. Added Escape key listener via `useEffect`. Backdrop is now a `<button>` for proper interactive semantics.

- [x] **Guard suggestion buttons during streaming** — Added `disabled={isStreaming}` and disabled styling to both "Try asking" suggestion buttons in ChatPanel.

## MEDIUM

- [x] **Fix auto-scroll during streaming** — Moved `isStreaming` declaration above the scroll effect so it can be used as a dependency. Scroll now triggers during streaming, not just on new message count.

- [x] **Move MAX_CLIENT_RETRIES to module scope** — Moved from inside the component body to module-level constant above the component.

- [x] **Add UUID validation to MatterPage** — Added `z.uuid()` validation on the `id` param before any DB queries. Returns `notFound()` for invalid UUIDs instead of a raw Postgres 500.

- [x] **Add error boundaries** — Created `src/app/error.tsx` and `src/app/matters/[id]/error.tsx` with user-friendly messages and retry buttons.

- [x] **Replace raw error.message with user-friendly text** — Error display in ChatPanel now shows a static message instead of leaking provider internals.

## LOW

- [x] **Fix telemetry calls outside propagateAttributes** — Removed dead `updateActiveObservation` and `setActiveTraceIO` calls from outside the `propagateAttributes` callback. Moved them inside where the span context exists.

- [x] **Add click-outside-to-dismiss on FeedbackModal** — Backdrop click now calls `onClose()`. Inner modal content stops propagation to prevent accidental close.

- [x] **Guard formatDate against invalid input** — Added `Number.isNaN(d.getTime())` check to return empty string instead of "Invalid Date".

- [x] **Fix toTitleCase capitalizing prepositions** — Added lowercase word set ("and", "of", "the", etc.) that stay lowercase except when first word.

## Verification

- Biome lint: 0 errors across all 7 modified files
- Vitest: 9/9 tests passing
- React.SubmitEvent replaced with React.FormEvent<HTMLFormElement> in both ChatPanel and FeedbackModal
