import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// ─── Standalone DB instance ───────────────────────────────────────────────────
// DO NOT import from src/db/index.ts -- module-level process.env.DATABASE_URL
// may not be set before dotenv.config() runs when using tsx directly.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = neon(databaseUrl);
const db = drizzle(sql, { schema });

// ─── Conveyancing Workflow Data ───────────────────────────────────────────────

type ConveyancingStage =
	(typeof schema.conveyancingStageEnum.enumValues)[number];

const stageActions: Record<ConveyancingStage, string[]> = {
	engagement_and_onboarding: [
		"Verify client identity / 100-point ID check",
		"Issue costs disclosure and agreement",
		"Send retainer / engagement letter",
		"Run conflict of interest check",
		"Open matter file and assign reference number",
	],
	pre_contract_review: [
		"Receive contract from vendor's solicitor",
		"Review standard terms and special conditions",
		"Review title search and plan",
		"Check for easements, covenants, and encumbrances",
		"Flag issues for client discussion",
	],
	searches_and_investigations: [
		"Order local authority search",
		"Order water / drainage search",
		"Order environmental search",
		"Order title search",
		"Order strata report if applicable",
	],
	pre_contract_enquiries: [
		"Raise requisitions on title",
		"Raise requisitions on contract",
		"Raise requisitions on property",
		"Review vendor's replies to requisitions",
		"Follow up on outstanding requisitions",
	],
	finance_and_mortgage: [
		"Confirm mortgage approval with lender",
		"Review mortgage offer and conditions",
		"Coordinate mortgage documentation",
		"Confirm insurance requirements",
		"Report to lender on title",
	],
	report_to_client: [
		"Prepare summary of search results",
		"Summarize contract terms and risks",
		"Advise on any outstanding issues",
		"Obtain client sign-off to proceed",
		"Confirm settlement date with all parties",
	],
	exchange_of_contracts: [
		"Prepare contract for client signature",
		"Coordinate exchange with vendor's solicitor",
		"Confirm deposit payment -- usually 10%",
		"Issue exchange confirmation",
		"Notify lender of exchange",
	],
	pre_settlement: [
		"Prepare transfer documents",
		"Request and verify settlement figures",
		"Coordinate final inspection",
		"Confirm settlement booking with PEXA",
		"Verify all conditions precedent are met",
	],
	settlement: [
		"Log into PEXA settlement workspace",
		"Verify all financial figures",
		"Confirm fund transfers",
		"Confirm key release arrangements",
		"Confirm settlement completion",
	],
	post_settlement: [
		"Confirm registration of transfer with Land Registry",
		"Confirm stamp duty payment / lodgement",
		"Send final report to client",
		"Send final report to lender",
		"Close matter file and archive",
	],
};

// ─── Main seed function ───────────────────────────────────────────────────────

async function main() {
	console.log("Seeding database...");

	// Insert sample property
	const [property] = await db
		.insert(schema.properties)
		.values({
			streetAddress: "42 Harbour Street",
			suburb: "Sydney",
			state: "nsw",
			postcode: "2000",
			titleReference: "1/SP12345",
		})
		.returning();

	console.log(`Inserted property: ${property.id} -- ${property.streetAddress}`);

	// Insert sample matter
	const [matter] = await db
		.insert(schema.matters)
		.values({
			referenceNumber: "CONV-2026-0001",
			type: "residential_conveyancing",
			propertyId: property.id,
			title: "Smith Property Purchase - 42 Harbour St, Sydney",
			description:
				"Residential conveyancing matter for the purchase of 42 Harbour St, Sydney on behalf of the Smith family.",
			currentStage: schema.conveyancingStageEnum.enumValues[0], // engagement_and_onboarding
		})
		.returning();

	console.log(`Inserted matter: ${matter.referenceNumber} -- ${matter.title}`);

	// Insert all stages
	for (const [index, stageName] of schema.conveyancingStageEnum.enumValues.entries()) {
		const isFirstStage = index === 0;

		const [stage] = await db
			.insert(schema.matterStages)
			.values({
				matterId: matter.id,
				stage: stageName,
				status: isFirstStage ? "in_progress" : "not_started",
				startedAt: isFirstStage ? new Date() : null,
			})
			.returning();

		console.log(`  Inserted stage: ${stage.stage}`);

		// Insert all actions for this stage in a single batch
		const actions = stageActions[stageName];
		const actionValues = actions.map((description: string) => ({
			matterStageId: stage.id,
			description,

			status: "not_started" as const,
			aiSuggested: false,
		}));

		await db.insert(schema.matterActions).values(actionValues);

		console.log(`    Inserted ${actionValues.length} actions for ${stageName}`);
	}

	console.log("Seeding complete.");
}

main().catch((err) => {
	console.error("Seed script failed:", err);
	process.exit(1);
});
