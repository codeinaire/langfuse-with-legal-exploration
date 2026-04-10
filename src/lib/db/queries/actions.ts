import { and, eq, ne } from "drizzle-orm"
import type { db as DbInstance } from "@/db"
import { matterActions, matterStages, matters } from "@/db/schema"

/**
 * Returns all pending (not completed or skipped) actions for the
 * matter's current stage.
 */
export async function getPendingActionsForCurrentStage(
  db: typeof DbInstance,
  matterId: string,
) {
  // First get the current stage name from the matter
  const matterRow = await db.query.matters.findFirst({
    where: eq(matters.id, matterId),
    columns: { currentStage: true },
  })

  if (!matterRow) return []

  const rows = await db
    .select({
      id: matterActions.id,
      description: matterActions.description,
      status: matterActions.status,
      dueDate: matterActions.dueDate,
    })
    .from(matterActions)
    .innerJoin(matterStages, eq(matterActions.matterStageId, matterStages.id))
    .where(
      and(
        eq(matterStages.matterId, matterId),
        eq(matterStages.stage, matterRow.currentStage),
        ne(matterActions.status, "completed"),
        ne(matterActions.status, "skipped"),
      ),
    )

  return rows
}

/**
 * Marks a specific action as completed, after verifying the action
 * belongs to the given matter (cross-matter mutation guard).
 *
 * Throws if the action does not belong to the matter.
 */
export async function markActionComplete(
  db: typeof DbInstance,
  actionId: string,
  matterId: string,
) {
  // Verify the action belongs to this matter
  const existing = await db
    .select({
      id: matterActions.id,
      description: matterActions.description,
      matterId: matterStages.matterId,
    })
    .from(matterActions)
    .innerJoin(matterStages, eq(matterActions.matterStageId, matterStages.id))
    .where(
      and(eq(matterActions.id, actionId), eq(matterStages.matterId, matterId)),
    )
    .limit(1)

  if (existing.length === 0) {
    throw new Error(
      `Action ${actionId} not found or does not belong to matter ${matterId}`,
    )
  }

  const [updated] = await db
    .update(matterActions)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(matterActions.id, actionId))
    .returning({
      id: matterActions.id,
      description: matterActions.description,
      status: matterActions.status,
      completedAt: matterActions.completedAt,
    })

  return updated
}
