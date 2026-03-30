import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// ─── Standalone DB instance ───────────────────────────────────────────────────
// DO NOT import from src/db/index.ts -- module-level process.env.DATABASE_URL
// may not be set before dotenv.config() runs when using tsx directly.

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// ─── Conveyancing Workflow Data ───────────────────────────────────────────────

const stages = [
  {
    name: 'Engagement & Onboarding',
    description: 'Initial client intake, identity verification, and matter setup.',
    stageOrder: 1,
    actions: [
      'Verify client identity / 100-point ID check',
      'Issue costs disclosure and agreement',
      'Send retainer / engagement letter',
      'Run conflict of interest check',
      'Open matter file and assign reference number',
    ],
  },
  {
    name: 'Pre-Contract Review',
    description: 'Review vendor-supplied contract and title documents.',
    stageOrder: 2,
    actions: [
      'Receive contract from vendor\'s solicitor',
      'Review standard terms and special conditions',
      'Review title search and plan',
      'Check for easements, covenants, and encumbrances',
      'Flag issues for client discussion',
    ],
  },
  {
    name: 'Searches & Investigations',
    description: 'Order and review statutory and council searches.',
    stageOrder: 3,
    actions: [
      'Order local authority search',
      'Order water / drainage search',
      'Order environmental search',
      'Order title search',
      'Order strata report if applicable',
    ],
  },
  {
    name: 'Pre-Contract Enquiries',
    description: 'Raise and review requisitions on title, contract, and property.',
    stageOrder: 4,
    actions: [
      'Raise requisitions on title',
      'Raise requisitions on contract',
      'Raise requisitions on property',
      'Review vendor\'s replies to requisitions',
      'Follow up on outstanding requisitions',
    ],
  },
  {
    name: 'Finance & Mortgage',
    description: 'Coordinate mortgage approval, documentation, and lender requirements.',
    stageOrder: 5,
    actions: [
      'Confirm mortgage approval with lender',
      'Review mortgage offer and conditions',
      'Coordinate mortgage documentation',
      'Confirm insurance requirements',
      'Report to lender on title',
    ],
  },
  {
    name: 'Report to Client',
    description: 'Present findings and obtain client sign-off to proceed.',
    stageOrder: 6,
    actions: [
      'Prepare summary of search results',
      'Summarize contract terms and risks',
      'Advise on any outstanding issues',
      'Obtain client sign-off to proceed',
      'Confirm settlement date with all parties',
    ],
  },
  {
    name: 'Exchange of Contracts',
    description: 'Coordinate exchange, deposit payment, and lender notification.',
    stageOrder: 7,
    actions: [
      'Prepare contract for client signature',
      'Coordinate exchange with vendor\'s solicitor',
      'Confirm deposit payment -- usually 10%',
      'Issue exchange confirmation',
      'Notify lender of exchange',
    ],
  },
  {
    name: 'Pre-Settlement',
    description: 'Prepare transfer documents and coordinate settlement logistics.',
    stageOrder: 8,
    actions: [
      'Prepare transfer documents',
      'Request and verify settlement figures',
      'Coordinate final inspection',
      'Confirm settlement booking with PEXA',
      'Verify all conditions precedent are met',
    ],
  },
  {
    name: 'Settlement',
    description: 'Execute settlement via PEXA and confirm fund transfers.',
    stageOrder: 9,
    actions: [
      'Log into PEXA settlement workspace',
      'Verify all financial figures',
      'Confirm fund transfers',
      'Confirm key release arrangements',
      'Confirm settlement completion',
    ],
  },
  {
    name: 'Post-Settlement',
    description: 'Finalise registration, stamp duty, reporting, and file closure.',
    stageOrder: 10,
    actions: [
      'Confirm registration of transfer with Land Registry',
      'Confirm stamp duty payment / lodgement',
      'Send final report to client',
      'Send final report to lender',
      'Close matter file and archive',
    ],
  },
];

// ─── Main seed function ───────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database...');

  // Insert sample matter
  const [matter] = await db
    .insert(schema.matters)
    .values({
      type: 'residential_conveyancing',
      title: 'Smith Property Purchase - 42 Harbour St, Sydney',
      description: 'Residential conveyancing matter for the purchase of 42 Harbour St, Sydney on behalf of the Smith family.',
      currentStageOrder: 1,
    })
    .returning();

  console.log(`Inserted matter: ${matter.id} -- ${matter.title}`);

  // Insert all 10 stages
  for (const stageData of stages) {
    const isFirstStage = stageData.stageOrder === 1;

    const [stage] = await db
      .insert(schema.matterStages)
      .values({
        matterId: matter.id,
        name: stageData.name,
        description: stageData.description,
        stageOrder: stageData.stageOrder,
        status: isFirstStage ? 'in_progress' : 'not_started',
        startedAt: isFirstStage ? new Date() : null,
      })
      .returning();

    console.log(`  Inserted stage ${stageData.stageOrder}: ${stage.name}`);

    // Insert all actions for this stage in a single batch
    const actionValues = stageData.actions.map((description, index) => ({
      stageId: stage.id,
      description,
      sortOrder: index,
      status: 'pending' as const,
      aiSuggested: false,
    }));

    await db.insert(schema.matterActions).values(actionValues);

    console.log(`    Inserted ${actionValues.length} actions for stage ${stageData.stageOrder}`);
  }

  console.log('Seeding complete.');
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
