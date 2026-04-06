import { and, eq } from "drizzle-orm";
import type { db as DbInstance } from "@/db";
import { matterStages, matters, properties } from "@/db/schema";

/**
 * Returns a matter's core details joined with its current stage and property.
 * Returns null if the matter does not exist.
 */
export async function getMatterWithCurrentStage(
  db: typeof DbInstance,
  matterId: string,
) {
  const result = await db
    .select({
      id: matters.id,
      referenceNumber: matters.referenceNumber,
      title: matters.title,
      status: matters.status,
      currentStage: matters.currentStage,
      stageStatus: matterStages.status,
      streetAddress: properties.streetAddress,
      suburb: properties.suburb,
      state: properties.state,
      postcode: properties.postcode,
      stageStartedAt: matterStages.startedAt,
    })
    .from(matters)
    .innerJoin(properties, eq(matters.propertyId, properties.id))
    .innerJoin(
      matterStages,
      and(
        eq(matters.currentStage, matterStages.stage),
        eq(matterStages.matterId, matters.id),
      ),
    )
    .where(eq(matters.id, matterId))
    .limit(1);

  return result[0] ?? null;
}
