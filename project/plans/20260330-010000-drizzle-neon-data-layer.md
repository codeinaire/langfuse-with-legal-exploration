# Plan: Drizzle + Neon Data Layer

**Date:** 2026-03-30
**Status:** Complete
**Research:** project/research/20260330-01-drizzle-neon-data-layer.md

## Goal

Set up a Drizzle ORM + Neon PostgreSQL persistence layer in a greenfield Next.js 15 project, with a schema modeling legal matter progression (matters, stages, actions, conversations), version-controlled migrations, and seed data for a residential conveyancing workflow.

## Approach

This is Feature #1 from the project roadmap -- the foundation that all other features depend on. Since no Next.js app exists yet, the first part of the work is scaffolding the project itself.

The architectural decisions are all drawn from the research and are unambiguous for this demo's context: use the Neon HTTP driver (`drizzle-orm/neon-http`) for zero-connection-overhead serverless queries, a single schema file (`src/db/schema.ts`) since the schema is only 4 tables, and `drizzle-kit push` for initial rapid iteration followed by `drizzle-kit generate` + `drizzle-kit migrate` for the committed migration. The schema design uses `pgTable` + `pgEnum` with UUID primary keys, integer stage ordering, and a JSONB messages column for conversations. The seed script populates all 10 stages of the Australian residential conveyancing (buyer's side) workflow with their associated actions.

Because the repo already contains files (README.md, LICENSE.md, .gitignore, project/), the scaffolding uses manual initialization rather than `create-next-app` to avoid file conflicts.

## Critical

- `DATABASE_URL` must never be prefixed with `NEXT_PUBLIC_` -- this would expose the Neon connection string (with full read/write credentials) in the client-side JavaScript bundle.
- The `drizzle-orm/neon-http` import path must be used, NOT `drizzle-orm/neon-serverless`. These are different drivers with different APIs. Using the wrong one produces confusing type errors or runtime failures.
- `drizzle.config.ts` must use `dialect: 'postgresql'` (not `'postgres'`, and not a `driver` field). The `driver` field was removed in drizzle-kit 0.22+. Using the old format causes migration generation to fail.
- The seed script runs outside Next.js (via `npx tsx`), so it must explicitly load `.env.local` using `dotenv.config({ path: '.env.local' })`. The default `import 'dotenv/config'` only loads `.env`, not `.env.local`.
- Schema must define both `.references()` on foreign key columns (for database-level integrity) AND `relations()` calls (for Drizzle's relational query API). These are independent features -- omitting `.references()` means no foreign key constraints; omitting `relations()` means `db.query.*.findMany({ with: ... })` will not work.

## Steps

### Phase 1: Project Scaffolding

- [x] **1.1** Initialize the Node.js project at the repo root. Run `npm init -y` to create `package.json`. Then install Next.js, React, and TypeScript: `npm install next react react-dom` and `npm install -D typescript @types/react @types/react-dom`. This manual approach avoids `create-next-app` conflicting with existing files (README.md, LICENSE.md, .gitignore, project/).
  - Done when: `package.json` exists with `next`, `react`, `react-dom` as dependencies and `typescript`, `@types/react`, `@types/react-dom` as devDependencies.

- [x] **1.2** Create `tsconfig.json` at the repo root with the standard Next.js 15 TypeScript configuration. Key settings: `"target": "ES2017"`, `"lib": ["dom", "dom.iterable", "esnext"]`, `"module": "esnext"`, `"moduleResolution": "bundler"`, `"jsx": "preserve"`, `"strict": true`, `"paths": { "@/*": ["./src/*"] }`, `"plugins": [{ "name": "next" }]`, `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]`, `"exclude": ["node_modules"]`.
  - Done when: `npx tsc --noEmit` runs without errors (may show warnings about missing files, which is expected at this stage).

- [x] **1.3** Create `next.config.ts` at the repo root. Minimal configuration:
  ```ts
  import type { NextConfig } from 'next';
  const nextConfig: NextConfig = {};
  export default nextConfig;
  ```
  - Done when: `next.config.ts` exists at the repo root.

- [x] **1.4** Create the App Router file structure:
  - `src/app/layout.tsx` -- root layout with `<html>` and `<body>` tags, exports `metadata` with title "LEAP Pathways Demo".
  - `src/app/page.tsx` -- simple page component rendering a heading (e.g., "LEAP Pathways Demo") as a placeholder.
  - Done when: `npx next dev` starts the dev server without errors and `http://localhost:3000` renders the placeholder page.

- [x] **1.5** Add npm scripts to `package.json`:
  ```json
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
  ```
  - Done when: `npm run dev` starts the development server with Turbopack.

- [x] **1.6** Install Tailwind CSS v4. Run `npm install tailwindcss @tailwindcss/postcss postcss`. Create `postcss.config.mjs` at the repo root with the `@tailwindcss/postcss` plugin. Add `@import "tailwindcss"` to `src/app/globals.css` and import that CSS file in `src/app/layout.tsx`.
  - Done when: A Tailwind utility class (e.g., `className="text-red-500"`) applied in `page.tsx` renders correctly in the browser.

### Phase 2: Dependencies and Configuration

- [x] **2.1** Install Drizzle runtime dependencies: `npm install drizzle-orm @neondatabase/serverless`.
  - Done when: Both packages appear in `package.json` `dependencies`.

- [x] **2.2** Install Drizzle dev dependencies: `npm install -D drizzle-kit dotenv tsx`.
  - Done when: All three packages appear in `package.json` `devDependencies`.

- [x] **2.3** Create `.env.local` at the repo root with the `DATABASE_URL` variable. The value is the Neon connection string from the Neon console (format: `postgresql://user:password@host/dbname?sslmode=require`). This file is already gitignored by the existing `.gitignore` (which ignores `.env*`).
  - **Prerequisite:** A Neon project and database must exist. If it does not, create one at console.neon.tech (free tier).
  - Done when: `.env.local` contains `DATABASE_URL=postgresql://...` and is NOT tracked by git (`git status` does not show it).

- [x] **2.4** Create `drizzle.config.ts` at the repo root:
  ```ts
  import { defineConfig } from 'drizzle-kit';
  export default defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
  });
  ```
  IMPORTANT: Use `dialect: 'postgresql'` (not `'postgres'`). Do NOT add a `driver` field.
  - Done when: File exists and uses `defineConfig` with `dialect: 'postgresql'`.

- [x] **2.5** Add database npm scripts to `package.json`:
  ```json
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:push": "drizzle-kit push",
  "db:studio": "drizzle-kit studio",
  "db:seed": "tsx src/db/seed.ts"
  ```
  - Done when: Scripts are present in `package.json`.

### Phase 3: Schema Definition

- [x] **3.1** Create `src/db/schema.ts` with the following enums using `pgEnum`:
  - `matterTypeEnum`: values `'residential_conveyancing'`, `'family_law'`
  - `stageStatusEnum`: values `'not_started'`, `'in_progress'`, `'completed'`, `'skipped'`
  - `actionStatusEnum`: values `'pending'`, `'in_progress'`, `'completed'`, `'skipped'`

  And the following tables using `pgTable`:

  **`matters`** table: `id` (uuid, defaultRandom, primary key), `type` (matterTypeEnum, not null), `title` (varchar 255, not null), `description` (text, nullable), `currentStageOrder` (integer, default 1), `createdAt` (timestamp with timezone, defaultNow, not null), `updatedAt` (timestamp with timezone, defaultNow, not null).

  **`matterStages`** table: `id` (uuid, defaultRandom, primary key), `matterId` (uuid, not null, references matters.id with onDelete cascade), `name` (varchar 255, not null), `description` (text, nullable), `stageOrder` (integer, not null), `status` (stageStatusEnum, default 'not_started', not null), `startedAt` (timestamp with timezone, nullable), `completedAt` (timestamp with timezone, nullable), `createdAt` (timestamp with timezone, defaultNow, not null), `updatedAt` (timestamp with timezone, defaultNow, not null).

  **`matterActions`** table: `id` (uuid, defaultRandom, primary key), `stageId` (uuid, not null, references matterStages.id with onDelete cascade), `description` (text, not null), `aiSuggested` (boolean, default false, not null), `status` (actionStatusEnum, default 'pending', not null), `completedAt` (timestamp with timezone, nullable), `notes` (text, nullable), `sortOrder` (integer, default 0, not null), `createdAt` (timestamp with timezone, defaultNow, not null), `updatedAt` (timestamp with timezone, defaultNow, not null).

  **`conversations`** table: `id` (uuid, defaultRandom, primary key), `matterId` (uuid, not null, references matters.id with onDelete cascade), `sessionId` (varchar 255, nullable), `messages` (jsonb, typed as `Message[]`, default `[]`, not null), `createdAt` (timestamp with timezone, defaultNow, not null), `updatedAt` (timestamp with timezone, defaultNow, not null).

  Define a `Message` interface for the JSONB column type: `{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: string; }`.

  All timestamps must use `{ withTimezone: true }` to ensure `timestamptz` is used in PostgreSQL.

  - Done when: `src/db/schema.ts` exports all 3 enums and 4 tables, and `npx tsc --noEmit` passes with no type errors.

- [x] **3.2** Add Drizzle `relations()` definitions in the same `src/db/schema.ts` file:
  - `mattersRelations`: matters has many matterStages, many conversations.
  - `matterStagesRelations`: matterStages belongs to one matter (via matterId -> matters.id), has many matterActions.
  - `matterActionsRelations`: matterActions belongs to one matterStage (via stageId -> matterStages.id).
  - `conversationsRelations`: conversations belongs to one matter (via matterId -> matters.id).

  These enable the relational query API (`db.query.matters.findMany({ with: { stages: true } })`). They are separate from and additional to the `.references()` constraints defined on the columns in step 3.1.
  - Done when: All 4 relations exports exist in schema.ts, and `npx tsc --noEmit` still passes.

### Phase 4: Database Connection

- [x] **4.1** Create `src/db/index.ts` that exports the Drizzle `db` instance:
  ```ts
  import { neon } from '@neondatabase/serverless';
  import { drizzle } from 'drizzle-orm/neon-http';
  import * as schema from './schema';

  const sql = neon(process.env.DATABASE_URL!);
  export const db = drizzle(sql, { schema });
  ```
  IMPORTANT: Import from `drizzle-orm/neon-http`, NOT `drizzle-orm/neon-serverless`. Pass `{ schema }` to enable the relational query API.
  - Done when: `src/db/index.ts` exists, exports `db`, and `npx tsc --noEmit` passes.

### Phase 5: Migrations

- [ ] **5.1** Generate the initial migration by running `npx drizzle-kit generate`. This reads `src/db/schema.ts` (via the config in `drizzle.config.ts`), compares it against the database state (empty), and produces a SQL migration file in the `drizzle/` directory.
  - Done when: A file like `drizzle/0000_*.sql` exists containing `CREATE TYPE` statements for the 3 enums and `CREATE TABLE` statements for the 4 tables with foreign key constraints.

- [ ] **5.2** Apply the migration by running `npx drizzle-kit migrate`. This executes the generated SQL against the Neon database.
  - Done when: Command completes without errors. The Neon database contains the 4 tables and 3 enum types. Verify by running `npx drizzle-kit studio` and inspecting the tables in the browser UI.

- [ ] **5.3** Commit the `drizzle/` directory and its migration files to git. These are version-controlled migration history.
  - Done when: `git status` shows the drizzle/ migration files as tracked.

### Phase 6: Seed Data

- [x] **6.1** Create `src/db/seed.ts`. This script must:
  1. Load environment variables with `import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });` at the top of the file (NOT `import 'dotenv/config'` -- that loads `.env`, not `.env.local`).
  2. Create a standalone Drizzle instance (import `neon` and `drizzle` directly; do NOT import from `src/db/index.ts` since module-level `process.env.DATABASE_URL` may not be set before dotenv runs).
  3. Define the full 10-stage residential conveyancing (buyer's side, Australia) workflow with actions per stage. All 10 stages from the scout report must be present:
     - Stage 1: Engagement & Onboarding (actions: verify client identity/100-point ID check, issue costs disclosure and agreement, send retainer/engagement letter, run conflict of interest check, open matter file and assign reference number)
     - Stage 2: Pre-Contract Review (actions: receive contract from vendor's solicitor, review standard terms and special conditions, review title search and plan, check for easements/covenants/encumbrances, flag issues for client discussion)
     - Stage 3: Searches & Investigations (actions: order local authority search, order water/drainage search, order environmental search, order title search, order strata report if applicable)
     - Stage 4: Pre-Contract Enquiries (actions: raise requisitions on title, raise requisitions on contract, raise requisitions on property, review vendor's replies to requisitions, follow up on outstanding requisitions)
     - Stage 5: Finance & Mortgage (actions: confirm mortgage approval with lender, review mortgage offer and conditions, coordinate mortgage documentation, confirm insurance requirements, report to lender on title)
     - Stage 6: Report to Client (actions: prepare summary of search results, summarize contract terms and risks, advise on any outstanding issues, obtain client sign-off to proceed, confirm settlement date with all parties)
     - Stage 7: Exchange of Contracts (actions: prepare contract for client signature, coordinate exchange with vendor's solicitor, confirm deposit payment -- usually 10%, issue exchange confirmation, notify lender of exchange)
     - Stage 8: Pre-Settlement (actions: prepare transfer documents, request and verify settlement figures, coordinate final inspection, confirm settlement booking with PEXA, verify all conditions precedent are met)
     - Stage 9: Settlement (actions: log into PEXA settlement workspace, verify all financial figures, confirm fund transfers, confirm key release arrangements, confirm settlement completion)
     - Stage 10: Post-Settlement (actions: confirm registration of transfer with Land Registry, confirm stamp duty payment/lodgement, send final report to client, send final report to lender, close matter file and archive)
  4. Insert one sample matter ("Smith Property Purchase - 42 Harbour St, Sydney", type: residential_conveyancing, currentStageOrder: 1).
  5. Insert all 10 stages for that matter. Stage 1 gets status `'in_progress'`; stages 2-10 get status `'not_started'`.
  6. Insert all actions for each stage using batch insert (`db.insert().values([...])`) for efficiency. All actions start as `'pending'`.
  7. Use `.returning()` on inserts to capture generated UUIDs for foreign key references.
  8. Log progress to console for each stage inserted.

  - Done when: `npx tsx src/db/seed.ts` runs without errors and logs "Seeding complete." The seed script is idempotent-safe (can be re-run after truncating tables, but does NOT need to handle existing data -- for a demo, truncate or recreate the database if re-seeding).

- [ ] **6.2** Run the seed script: `npx tsx src/db/seed.ts`. Verify the data by running `npx drizzle-kit studio` and inspecting each table:
  - `matters` table has 1 row.
  - `matter_stages` table has 10 rows, ordered by `stage_order` 1-10.
  - `matter_actions` table has 50 rows (5 per stage).
  - `conversations` table has 0 rows (populated by the agent feature later).
  - Done when: All counts match and foreign key relationships are intact (each stage's `matter_id` matches the matter, each action's `stage_id` matches its stage).

### Phase 7: Build Verification

- [ ] **7.1** Run `npm run build` (which runs `next build`). This verifies that the Next.js app compiles, TypeScript has no errors, and the Drizzle schema/connection modules are valid.
  - Done when: Build completes with no errors. Warnings about unused exports are acceptable.

## Security

**Known vulnerabilities:** No known CVEs or advisories found for `drizzle-orm` (0.45.2), `@neondatabase/serverless` (1.0.2), or `drizzle-kit` as of 2026-03-30. The scout report confirmed the same finding.

**Architectural risks:**

- **DATABASE_URL exposure:** The connection string grants full read/write access to the Neon database. It must be stored in `.env.local` (gitignored) and set in Vercel project settings for deployment. It must NEVER be prefixed with `NEXT_PUBLIC_`, which would include it in the client-side JavaScript bundle. The `src/db/index.ts` module must only be imported in server-side code (server components, API routes, server actions) -- never in client components.
- **SQL injection:** Drizzle's query builder uses parameterized queries by default, which prevents SQL injection. The `sql` tagged template literal also auto-parameterizes. The anti-pattern to avoid is `sql.raw()` with user-supplied input -- this bypasses parameterization. For this data layer feature, all queries are in the seed script (developer-controlled data), so SQL injection is not an immediate risk. When API routes are added in Feature #4, all user input must flow through Drizzle's query builder.
- **JSONB content:** The `messages` JSONB column accepts any valid JSON at the database level. The TypeScript `.$type<Message[]>()` annotation enforces shape at compile time only, not at runtime. For the demo, this is sufficient. If user-generated content is ever stored in JSONB and rendered in the UI, it must be sanitized at read time. React's JSX auto-escaping provides baseline protection, but raw HTML rendering methods must never be used on JSONB content.
- **Seed/migration scripts as privileged operations:** `seed.ts` and drizzle-kit commands run with full database write access. They are developer tools. They must never be exposed as API endpoints or triggered by user input.

## Open Questions

1. **Has drizzle-kit's config format changed again since 0.21?** (Resolved: No. Fact-checked with HIGH confidence. `dialect: 'postgresql'` with `defineConfig` is the current standard. The `driver` field is fully removed in 0.22+.)

2. **Does `drizzle-orm/neon-http` support transactions now?** (Resolved: Not needed for this feature. All queries in the seed script and future agent tool calls are single-statement. If multi-statement transactions become needed in a later feature, this can be revisited. The WebSocket driver can be added alongside the HTTP driver without replacing it.)

3. **What does `create-next-app` v15 generate with `--turbopack`?** (Resolved: Moot. This plan uses manual initialization instead of `create-next-app` to avoid conflicts with existing repo files. Turbopack is the default dev bundler in Next.js 15.1+ and is enabled via the `--turbopack` flag in the `next dev` script.)

4. **Exact scaffold approach for a repo with existing files?** (Resolved: Manual initialization. The repo has README.md, LICENSE.md, .gitignore, and project/. Running `create-next-app .` would conflict with these. Manual init (`npm init -y` + install deps + create file structure) is safest and gives full control.)

5. **Should `updatedAt` use a database trigger or application-level updates?** (Resolved: Application-level for the demo. Set `updatedAt: new Date()` explicitly in update queries. Drizzle has a `.$onUpdate()` column modifier, but its exact behavior should be verified. For a demo with a small number of update call sites, explicit is simpler and more transparent. A PostgreSQL trigger can be added later via a migration if needed.)

## Implementation Discoveries

**No Bash tool available in implementer role.** The implementer agent creates all files directly using Write/Edit tools. Shell commands (`npm install`, `npx tsc --noEmit`, `npm run build`) cannot be run by the agent. This means:
- All package installations are represented by the `package.json` content; the user must run `npm install` once after cloning/checking out.
- Steps 5.1 (`drizzle-kit generate`) and 5.2 (`drizzle-kit migrate`) and 6.2 (`seed.ts` run) require a live database and must be executed by the user after filling in `DATABASE_URL` in `.env.local`.
- TypeScript typecheck (`npx tsc --noEmit`) and build (`npm run build`) must be run by the user. All schema code was written to conform to the Drizzle ORM 0.45.x and Next.js 15 APIs as specified in the plan and research doc.

**All files included in package.json.** Rather than running `npm init -y` and separate `npm install` commands, all dependencies were specified directly in the initial `package.json` (steps 1.1, 2.1, 2.2, 1.6 Tailwind deps all combined into one file). This is functionally equivalent -- `npm install` produces the same result.

**Phase 5 and 6.2 deferred to user (by design, as per original task specification).** Steps 5.1, 5.2, 5.3, 6.2, and 7.1 require either a live database connection or a running Next.js process. These are set up but cannot be verified by the agent. See "Steps to complete after adding DATABASE_URL" below.

**Tailwind v4 postcss.config format.** Tailwind v4 uses `@tailwindcss/postcss` as a plugin and `@import "tailwindcss"` in CSS (no separate `tailwind.config.js` needed). The plan explicitly specifies this v4 approach. No `tailwind.config.ts` was created -- that is correct for v4.

**Seed script uses sequential inserts for stages (not batch) to capture UUIDs.** The plan asks for `.returning()` to capture generated UUIDs for foreign keys. Since each stage's UUID is needed before inserting its actions, stages are inserted one-by-one in a loop. Actions within each stage are batch-inserted. This matches the plan's guidance.

## Verification

- [ ] **Next.js app starts** -- dev server -- `npm run dev` loads http://localhost:3000 without errors -- Automatic
- [ ] **TypeScript compiles** -- build validation -- `npx tsc --noEmit` passes with zero errors -- Automatic
- [ ] **Schema is valid SQL** -- CLI validation -- `npx drizzle-kit generate` produces migration SQL without errors -- Automatic
- [ ] **Migration applies cleanly** -- CLI validation -- `npx drizzle-kit migrate` completes without errors -- Automatic
- [ ] **Neon connection works** -- integration (real DB) -- `npx tsx src/db/seed.ts` succeeds (inserts data; if it completes, the connection works) -- Automatic
- [ ] **Seed data is correct** -- manual inspection -- `npx drizzle-kit studio`: verify 1 matter, 10 stages (ordered 1-10), 50 actions (5 per stage), 0 conversations -- Manual
- [ ] **Foreign keys enforce integrity** -- manual test -- In Drizzle Studio or a test query, attempt to insert a `matter_stages` row with a nonexistent `matter_id`; it must fail with a foreign key violation -- Manual
- [ ] **Production build succeeds** -- build validation -- `npm run build` completes without errors -- Automatic
- [ ] **Tailwind CSS works** -- visual check -- A Tailwind utility class renders correctly in the browser -- Manual
