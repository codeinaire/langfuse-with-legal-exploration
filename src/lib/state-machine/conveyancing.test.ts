import { describe, expect, it, vi } from "vitest"
import { getNextStage } from "@/lib/db/queries/stages"
import { tryAdvanceStage } from "./conveyancing"

// ─── getNextStage (pure function) ────────────────────────────────────────────

describe("getNextStage", () => {
  it("returns the next stage in sequence", () => {
    expect(getNextStage("engagement_and_onboarding")).toBe(
      "pre_contract_review",
    )
    expect(getNextStage("pre_contract_review")).toBe(
      "searches_and_investigations",
    )
    expect(getNextStage("settlement")).toBe("post_settlement")
  })

  it("returns null for the final stage", () => {
    expect(getNextStage("post_settlement")).toBeNull()
  })
})

// ─── tryAdvanceStage ─────────────────────────────────────────────────────────

function createMockDb({
  matter,
  currentStageRow,
  nextStageRow,
}: {
  matter?: { currentStage: string } | undefined
  currentStageRow?:
    | { id: string; matterActions: { status: string; description: string }[] }
    | undefined
  nextStageRow?: { id: string } | undefined
}) {
  let findFirstCallCount = 0

  return {
    query: {
      matters: {
        findFirst: vi.fn().mockResolvedValue(matter),
      },
      matterStages: {
        findFirst: vi.fn().mockImplementation(() => {
          findFirstCallCount++
          // First call returns current stage row, second returns next stage row
          if (findFirstCallCount === 1) return Promise.resolve(currentStageRow)
          return Promise.resolve(nextStageRow)
        }),
      },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }
}

describe("tryAdvanceStage", () => {
  const matterId = "test-matter-id"

  it("fails when matter is not found", async () => {
    const db = createMockDb({ matter: undefined })

    const result = await tryAdvanceStage(db as any, matterId)

    expect(result).toEqual({ success: false, reason: "Matter not found" })
  })

  it("fails when current stage record is not found", async () => {
    const db = createMockDb({
      matter: { currentStage: "engagement_and_onboarding" },
      currentStageRow: undefined,
    })

    const result = await tryAdvanceStage(db as any, matterId)

    expect(result).toEqual({
      success: false,
      reason: "Stage record not found for engagement_and_onboarding",
    })
  })

  it("fails when there are incomplete actions", async () => {
    const db = createMockDb({
      matter: { currentStage: "engagement_and_onboarding" },
      currentStageRow: {
        id: "stage-1",
        matterActions: [
          { status: "completed", description: "Done task" },
          { status: "not_started", description: "Verify client identity" },
          { status: "in_progress", description: "Prepare engagement letter" },
        ],
      },
    })

    const result = await tryAdvanceStage(db as any, matterId)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toContain("2 action(s)")
      expect(result.incompleteActions).toEqual([
        "Verify client identity",
        "Prepare engagement letter",
      ])
    }
  })

  it("treats skipped actions as complete", async () => {
    const db = createMockDb({
      matter: { currentStage: "engagement_and_onboarding" },
      currentStageRow: {
        id: "stage-1",
        matterActions: [
          { status: "completed", description: "Task A" },
          { status: "skipped", description: "Task B" },
        ],
      },
      nextStageRow: { id: "stage-2" },
    })

    const result = await tryAdvanceStage(db as any, matterId)

    expect(result.success).toBe(true)
  })

  it("fails when already at the final stage", async () => {
    const db = createMockDb({
      matter: { currentStage: "post_settlement" },
      currentStageRow: {
        id: "stage-10",
        matterActions: [{ status: "completed", description: "Final task" }],
      },
    })

    const result = await tryAdvanceStage(db as any, matterId)

    expect(result).toEqual({
      success: false,
      reason: "Already at the final stage (post-settlement).",
    })
  })

  it("fails when next stage record is missing", async () => {
    const db = createMockDb({
      matter: { currentStage: "engagement_and_onboarding" },
      currentStageRow: {
        id: "stage-1",
        matterActions: [{ status: "completed", description: "Task A" }],
      },
      nextStageRow: undefined,
    })

    const result = await tryAdvanceStage(db as any, matterId)

    expect(result).toEqual({
      success: false,
      reason: "Next stage record not found for pre_contract_review",
    })
  })

  it("advances successfully and performs three db updates", async () => {
    const db = createMockDb({
      matter: { currentStage: "engagement_and_onboarding" },
      currentStageRow: {
        id: "stage-1",
        matterActions: [{ status: "completed", description: "Task A" }],
      },
      nextStageRow: { id: "stage-2" },
    })

    const result = await tryAdvanceStage(db as any, matterId)

    expect(result).toEqual({
      success: true,
      previousStage: "engagement_and_onboarding",
      newStage: "pre_contract_review",
    })

    // Three updates: current stage completed, next stage in_progress, matter currentStage
    expect(db.update).toHaveBeenCalledTimes(3)
  })
})
