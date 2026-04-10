import { notFound } from "next/navigation"
import { ChatPanel } from "@/components/chat/chat-panel"
import { StageProgress } from "@/components/matter/stage-progress"
import { db } from "@/db"
import { getMatterWithCurrentStage } from "@/lib/db/queries/matters"
import { getAllStages, getStageWithActions } from "@/lib/db/queries/stages"

interface MatterPageProps {
  params: Promise<{ id: string }>
}

export default async function MatterPage({ params }: MatterPageProps) {
  const { id } = await params

  const [matter, stages] = await Promise.all([
    getMatterWithCurrentStage(db, id),
    getAllStages(db, id),
  ])

  if (!matter) {
    notFound()
  }

  // notFound() throws, so matter is non-null beyond this point.
  // TypeScript doesn't narrow through notFound(), so we use a local variable.
  const resolvedMatter = matter as NonNullable<typeof matter>

  const currentStageDetails = await getStageWithActions(
    db,
    id,
    resolvedMatter.currentStage,
  )

  return (
    <main className="flex min-h-screen flex-col">
      {/* Header */}
      <div className="border-b bg-white px-6 py-4">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {resolvedMatter.referenceNumber}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {resolvedMatter.title}
              </p>
            </div>
            <div className="text-right text-sm text-gray-500">
              <p>
                {resolvedMatter.streetAddress}, {resolvedMatter.suburb}{" "}
                {resolvedMatter.state.toUpperCase()} {resolvedMatter.postcode}
              </p>
              <p className="mt-1">
                Status:{" "}
                <span className="font-medium capitalize">
                  {resolvedMatter.status}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-0">
        {/* Stage progress sidebar */}
        <aside className="w-72 shrink-0 border-r bg-gray-50">
          <StageProgress
            stages={stages}
            currentStage={resolvedMatter.currentStage}
          />
        </aside>

        {/* Chat panel */}
        <div className="flex flex-1 flex-col">
          <ChatPanel
            matterId={id}
            pendingActionsCount={
              currentStageDetails?.actions.filter(
                (a) => a.status !== "completed" && a.status !== "skipped",
              ).length ?? 0
            }
          />
        </div>
      </div>
    </main>
  )
}
