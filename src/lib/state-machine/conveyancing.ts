import { and, eq } from "drizzle-orm"
import type { db as DbInstance } from "@/db"
import { matterStages, matters } from "@/db/schema"
import { getNextStage } from "@/lib/db/queries/stages"

export type StageTransitionResult = SuccessTransition | FailTransition

interface SuccessTransition {
  success: true
  previousStage: string
  newStage: string
}

interface FailTransition {
  success: false
  reason: string
  incompleteActions?: string[]
}

/**
 * Attempts to advance a matter to the next conveyancing stage.
 *
 * Rules enforced:
 * 1. Matter must exist
 * 2. Matter with current stage must be in MatterStage
 * 2. All actions in the current stage must be completed or skipped.
 * 3. There must be a next stage (not already at post_settlement).
 *
 * If all rules pass, updates:
 * - matters.currentStage
 * - current matterStages row: status = completed, completedAt = now
 * - next matterStages row: status = in_progress, startedAt = now
 */
export async function tryAdvanceStage(
  db: typeof DbInstance,
  matterId: string,
): Promise<StageTransitionResult> {
  // 1. Get matter's current stage
  const matterRow = await db.query.matters.findFirst({
    where: eq(matters.id, matterId),
    columns: { currentStage: true },
  })

  if (!matterRow) {
    return { success: false, reason: "Matter not found" }
  }

  const currentStage = matterRow.currentStage

  // 2. Get the current stage row
  const currentStageRowWithActions = await db.query.matterStages.findFirst({
    where: and(
      eq(matterStages.matterId, matterId),
      eq(matterStages.stage, currentStage),
    ),
    with: { matterActions: true },
  })

  if (!currentStageRowWithActions) {
    return {
      success: false,
      reason: `Stage record not found for ${currentStage}`,
    }
  }

  // 3. Check all actions are completed or skipped
  const incompleteActions = currentStageRowWithActions.matterActions.filter(
    (a) => a.status !== "completed" && a.status !== "skipped",
  )

  if (incompleteActions.length > 0) {
    return {
      success: false,
      reason: `${incompleteActions.length} action(s) in the current stage are not yet complete.`,
      incompleteActions: incompleteActions.map((a) => a.description),
    }
  }

  // 4. Determine next stage
  const nextStage = getNextStage(currentStage)
  if (!nextStage) {
    return {
      success: false,
      reason: "Already at the final stage (post-settlement).",
    }
  }

  // 5. Get the next stage row
  const nextStageRow = await db.query.matterStages.findFirst({
    where: and(
      eq(matterStages.matterId, matterId),
      eq(matterStages.stage, nextStage),
    ),
  })

  if (!nextStageRow) {
    return {
      success: false,
      reason: `Next stage record not found for ${nextStage}`,
    }
  }

  const now = new Date()

  // 6. Perform the transition (three updates)
  await db
    .update(matterStages)
    .set({ status: "completed", completedAt: now })
    .where(eq(matterStages.id, currentStageRowWithActions.id))

  await db
    .update(matterStages)
    .set({ status: "in_progress", startedAt: now })
    .where(eq(matterStages.id, nextStageRow.id))

  await db
    .update(matters)
    .set({ currentStage: nextStage, updatedAt: now })
    .where(eq(matters.id, matterId))

  return {
    success: true,
    previousStage: currentStage,
    newStage: nextStage,
  }
}
