import { and, count, eq, sql } from "drizzle-orm"
import type { db as DbInstance } from "@/db"
import { conveyancingStageEnum, matterActions, matterStages } from "@/db/schema"

type ConveyancingStage = (typeof conveyancingStageEnum.enumValues)[number]

/**
 * Returns a specific stage and all its actions for a matter.
 */
export async function getStageWithActions(
  db: typeof DbInstance,
  matterId: string,
  stageName: ConveyancingStage,
) {
  const stage = await db.query.matterStages.findFirst({
    where: and(
      eq(matterStages.matterId, matterId),
      eq(matterStages.stage, stageName),
    ),
    with: {
      matterActions: true,
    },
  })

  if (!stage) return null

  const totalActions = stage.matterActions.length
  const completedActions = stage.matterActions.filter(
    (a) => a.status === "completed" || a.status === "skipped",
  ).length

  return {
    stageStatus: stage.status,
    startedAt: stage.startedAt,
    completedAt: stage.completedAt,
    actions: stage.matterActions.map((a) => ({
      id: a.id,
      description: a.description,
      status: a.status,
      dueDate: a.dueDate,
      completedAt: a.completedAt,
    })),
    totalActions,
    completedActions,
  }
}

/**
 * Returns all stages for a matter with their completion counts,
 * ordered by the conveyancingStageEnum enum order.
 */
export async function getAllStages(db: typeof DbInstance, matterId: string) {
  // Query all stages with action completion counts
  const stageRows = await db
    .select({
      id: matterStages.id,
      stage: matterStages.stage,
      status: matterStages.status,
      startedAt: matterStages.startedAt,
      completedAt: matterStages.completedAt,
    })
    .from(matterStages)
    .where(eq(matterStages.matterId, matterId))

  // Get action counts per stage
  const actionCounts = await db
    .select({
      matterStageId: matterActions.matterStageId,
      total: count(matterActions.id),
      completed: sql<number>`count(case when ${matterActions.status} in ('completed', 'skipped') then 1 end)`,
    })
    .from(matterActions)
    .innerJoin(matterStages, eq(matterActions.matterStageId, matterStages.id))
    .where(eq(matterStages.matterId, matterId))
    .groupBy(matterActions.matterStageId)

  const countsByStageId = new Map(
    actionCounts.map((r) => [
      r.matterStageId,
      { total: Number(r.total), completed: Number(r.completed) },
    ]),
  )

  // Sort by enum order
  const enumOrder = conveyancingStageEnum.enumValues
  const sorted = [...stageRows].sort(
    (a, b) => enumOrder.indexOf(a.stage) - enumOrder.indexOf(b.stage),
  )

  return sorted.map((s) => {
    const counts = countsByStageId.get(s.id) ?? { total: 0, completed: 0 }
    return {
      id: s.id,
      stage: s.stage,
      status: s.status,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      totalActions: counts.total,
      completedActions: counts.completed,
    }
  })
}

/**
 * Pure function: returns the next stage after the given one,
 * or null if already at the final stage.
 */
export function getNextStage(
  currentStage: ConveyancingStage,
): ConveyancingStage | null {
  const enumValues = conveyancingStageEnum.enumValues
  const currentIndex = enumValues.indexOf(currentStage)
  if (currentIndex === -1 || currentIndex === enumValues.length - 1) {
    return null
  }
  const nextStageIndex = currentIndex + 1
  return enumValues[nextStageIndex]
}
