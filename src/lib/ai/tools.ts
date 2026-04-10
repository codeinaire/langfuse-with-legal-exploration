import { tool } from "ai"
import { z } from "zod"
import {
  getPendingActionsForCurrentStage,
  markActionComplete,
} from "@/lib/db/queries/actions"
import { getMatterWithCurrentStage } from "@/lib/db/queries/matters"
import { getAllStages, getStageWithActions } from "@/lib/db/queries/stages"
import { tryAdvanceStage } from "@/lib/state-machine/conveyancing"
import { getAgentContext } from "./agent-context"

/**
 * 1. Get the matter's current stage and summary info.
 */
const getCurrentStage = tool({
  description:
    "Get the current stage of the conveyancing matter, including property address, matter reference, and stage status. Always call this before answering questions about the matter's status.",
  inputSchema: z.object({}),
  execute: async (_input, options) => {
    const { matterId, db } = getAgentContext(options)
    const matter = await getMatterWithCurrentStage(db, matterId)
    if (!matter) {
      return "Matter not found."
    }
    return {
      referenceNumber: matter.referenceNumber,
      currentStage: matter.currentStage,
      stageStatus: matter.stageStatus,
      propertyAddress: `${matter.streetAddress}, ${matter.suburb} ${matter.state.toUpperCase()} ${matter.postcode}`,
      matterStatus: matter.status,
      stageStartedAt: matter.stageStartedAt?.toISOString() ?? null,
    }
  },
})

/**
 * 2. Get pending (incomplete) tasks for the current stage.
 */
const getPendingTasks = tool({
  description:
    "Get all pending (not completed or skipped) tasks for the matter's current stage. Always call this before advising on next steps or completing tasks.",
  inputSchema: z.object({}),
  execute: async (_input, options) => {
    const { matterId, db } = getAgentContext(options)
    const pendingActions = await getPendingActionsForCurrentStage(db, matterId)
    if (pendingActions.length === 0) {
      return "No pending tasks for the current stage. All tasks are completed or skipped."
    }
    return pendingActions.map((a) => ({
      id: a.id,
      description: a.description,
      status: a.status,
      dueDate: a.dueDate?.toISOString() ?? null,
    }))
  },
})

/**
 * 3. Mark a specific task as complete.
 */
const markTaskComplete = tool({
  description:
    "Mark a specific task as complete by its action ID. Only use IDs returned by getPendingTasks. Returns confirmation or an error message if the task is not found.",
  inputSchema: z.object({
    actionId: z.uuid().describe("The UUID of the action to mark as complete"),
  }),
  execute: async (input, options) => {
    const { matterId, db } = getAgentContext(options)
    try {
      const updated = await markActionComplete(db, input.actionId, matterId)
      return {
        success: true,
        actionId: updated.id,
        description: updated.description,
        status: updated.status,
        completedAt: updated.completedAt?.toISOString() ?? null,
      }
    } catch (err) {
      // Return error as a string so the LLM sees it, not an uncaught exception
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
})

/**
 * 4. Get a full matter summary with all 10 stages.
 */
const getMatterSummary = tool({
  description:
    "Get a full summary of the matter including all 10 conveyancing stages with their statuses and task completion counts. Use this to give the user an overview of progress.",
  inputSchema: z.object({}),
  execute: async (_input, options) => {
    const { matterId, db } = getAgentContext(options)
    const matter = await getMatterWithCurrentStage(db, matterId)
    if (!matter) {
      return "Matter not found."
    }
    const stages = await getAllStages(db, matterId)
    return {
      referenceNumber: matter.referenceNumber,
      title: matter.title,
      matterStatus: matter.status,
      currentStage: matter.currentStage,
      stages: stages.map((s) => ({
        stage: s.stage,
        status: s.status,
        completedActions: s.completedActions,
        totalActions: s.totalActions,
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
    }
  },
})

/**
 * 5. Suggest prioritised next actions with contextual guidance.
 */
const suggestNextActions = tool({
  description:
    "Get prioritised suggestions for next actions in the current stage, including guidance on timing and risks. Use this to proactively guide the user.",
  inputSchema: z.object({}),
  execute: async (_input, options) => {
    const { matterId, db } = getAgentContext(options)
    const matter = await getMatterWithCurrentStage(db, matterId)
    if (!matter) {
      return "Matter not found."
    }

    const pending = await getPendingActionsForCurrentStage(db, matterId)
    const stageDetails = await getStageWithActions(
      db,
      matterId,
      matter.currentStage,
    )

    if (!stageDetails) {
      return "Stage details not found."
    }

    if (pending.length === 0) {
      return {
        message:
          "All tasks in the current stage are complete. Consider advancing to the next stage.",
        pendingActions: [],
      }
    }

    // Attach context-aware guidance per action
    const contextualGuidance: Record<string, string> = {
      "Verify client identity / 100-point ID check":
        "Priority: Complete immediately. Required before any other work can proceed. Obtain at least 100 points of identification per AML/CTF Act.",
      "Issue costs disclosure and agreement":
        "Priority: Complete before incurring any costs. Mandatory under NSW law.",
      "Send retainer / engagement letter":
        "Priority: Formalise the client relationship and scope of work.",
      "Run conflict of interest check":
        "Priority: Must be done before any work begins. Check against existing clients and matters.",
      "Open matter file and assign reference number":
        "Administrative: Set up the matter file and reference number.",
      "Order local authority search":
        "Priority: Order immediately — this typically takes 2-4 weeks and is on the critical path.",
      "Order water / drainage search":
        "Standard turnaround: 5-10 business days. Order alongside local authority search.",
      "Order environmental search":
        "Standard turnaround: 3-5 business days. Particularly important for industrial sites.",
      "Order title search":
        "Quick turnaround: 1-2 business days. Order immediately.",
      "Order strata report if applicable":
        "If strata property: order immediately — reports take 5-7 business days and are critical for disclosure.",
      "Confirm mortgage approval with lender":
        "Priority: Confirm unconditional approval before exchange of contracts.",
      "Confirm settlement booking with PEXA":
        "Priority: Book PEXA workspace as early as possible — other parties need to accept.",
      "Log into PEXA settlement workspace":
        "Critical: Verify all figures in PEXA at least 24 hours before settlement.",
    }

    return {
      currentStage: matter.currentStage,
      completedCount: stageDetails.completedActions,
      totalCount: stageDetails.totalActions,
      pendingActions: pending.map((a) => ({
        id: a.id,
        description: a.description,
        status: a.status,
        guidance:
          contextualGuidance[a.description] ??
          "Complete this task to progress the stage.",
      })),
    }
  },
})

/**
 * 6. Advance the matter to the next conveyancing stage (state machine enforced).
 */
const advanceStage = tool({
  description:
    "Advance the matter to the next conveyancing stage. The state machine will verify all tasks in the current stage are complete before allowing advancement. Use this when the user wants to progress to the next stage.",
  inputSchema: z.object({}),
  execute: async (_input, options) => {
    const { matterId, db } = getAgentContext(options)
    const result = await tryAdvanceStage(db, matterId)
    return result
  },
})

/**
 * All 6 conveyancing agent tools, keyed for use in streamText.
 */
export const conveyancingTools = {
  getCurrentStage,
  getPendingTasks,
  markTaskComplete,
  getMatterSummary,
  suggestNextActions,
  advanceStage,
}
