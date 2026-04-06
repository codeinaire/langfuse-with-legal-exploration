import { db } from "@/db";
import { getPendingActionsForCurrentStage } from "@/lib/db/queries/actions";
import { getMatterWithCurrentStage } from "@/lib/db/queries/matters";
import { getAllStages } from "@/lib/db/queries/stages";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Basic UUID validation
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return new Response("Invalid matter ID", { status: 400 });
  }

  const [matter, stages, pendingActions] = await Promise.all([
    getMatterWithCurrentStage(db, id),
    getAllStages(db, id),
    getPendingActionsForCurrentStage(db, id),
  ]);

  if (!matter) {
    return new Response("Matter not found", { status: 404 });
  }

  return Response.json({
    matter: {
      id: matter.id,
      referenceNumber: matter.referenceNumber,
      title: matter.title,
      status: matter.status,
      currentStage: matter.currentStage,
      stageStatus: matter.stageStatus,
      propertyAddress: `${matter.streetAddress}, ${matter.suburb} ${matter.state.toUpperCase()} ${matter.postcode}`,
    },
    stages,
    pendingActions,
  });
}
