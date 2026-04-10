import { eq } from "drizzle-orm"
import { db } from "@/db"
import { matters } from "@/db/schema"

export default async function Home() {
  // Fetch the first (demo) matter to build the link
  const demoMatter = await db.query.matters.findFirst({
    where: eq(matters.referenceNumber, "CONV-2026-0001"),
    columns: {
      id: true,
      referenceNumber: true,
      title: true,
      currentStage: true,
    },
  })

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold text-gray-900">
        Legal Agent Flow Demo
      </h1>
      <p className="mt-4 text-gray-600">
        AI-driven workflow guidance for legal matter lifecycle management.
      </p>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800">Active Matters</h2>
        <div className="mt-4">
          {demoMatter ? (
            <a
              href={`/matters/${demoMatter.id}`}
              className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {demoMatter.referenceNumber}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {demoMatter.title}
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>
                    Stage:{" "}
                    <span className="capitalize">
                      {demoMatter.currentStage.replace(/_/g, " ")}
                    </span>
                  </p>
                  <p className="mt-1 text-blue-600">Open matter &rarr;</p>
                </div>
              </div>
            </a>
          ) : (
            <p className="text-gray-500">
              No matters found. Run{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-sm">
                npm run db:seed
              </code>{" "}
              to seed the demo data.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
