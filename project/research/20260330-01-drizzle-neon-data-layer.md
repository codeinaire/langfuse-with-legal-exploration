# Drizzle + Neon Data Layer -- Research

**Researched:** 2026-03-30
**Domain:** Drizzle ORM schema design, Neon PostgreSQL serverless HTTP driver, Next.js 15 project scaffolding, drizzle-kit migration tooling
**Confidence:** MEDIUM -- core patterns verified via scout report (which checked npm registry, official docs URLs); specific API details from training data flagged for validation

## Summary

This research covers the technical setup for Feature #1 of the LEAP Pathways demo: a Drizzle ORM + Neon PostgreSQL data layer in a greenfield Next.js 15 project. The scope includes Next.js project scaffolding, Drizzle schema design for a legal matter progression app, the Neon serverless HTTP driver connection, drizzle-kit migration configuration, and seed data patterns.

The core finding is that the Drizzle + Neon pairing is well-documented with first-class integration. The correct driver is `drizzle-orm/neon-http` (not `drizzle-orm/neon-serverless`), which uses the `neon` HTTP query function from `@neondatabase/serverless`. The schema design is the most load-bearing decision -- the matter/stage/action hierarchy must support both agent tool calls and UI rendering, so relationships and enums need careful thought upfront. drizzle-kit provides three distinct commands (`generate`, `push`, `migrate`) with different use cases, and the choice between them affects the development workflow.

**Primary recommendation:** Use `drizzle-orm/neon-http` driver with `@neondatabase/serverless`, define schema in a single `src/db/schema.ts` file using `pgTable` + `pgEnum`, use `drizzle-kit generate` + `drizzle-kit migrate` for version-controlled migrations, and write a TypeScript seed script using Drizzle's insert API.

## Standard Stack

### Core

| Library | Version | Purpose | License | Maintained? | Why Standard |
|---------|---------|---------|---------|-------------|--------------|
| `drizzle-orm` | 0.45.2 | TypeScript ORM with SQL-like query builder | Apache-2.0 | Yes (very active) | TypeScript-first, native Neon support, tree-shakeable, matches LEAP's stack |
| `@neondatabase/serverless` | 1.0.2 | Serverless Postgres driver (HTTP + WebSocket) | MIT | Yes | Official Neon driver, optimized for edge/serverless, instant cold starts |
| `next` | 15.x (latest) | React framework with App Router | MIT | Yes (Vercel maintained) | LEAP's stack, industry standard for React apps on Vercel |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-kit` | latest (dev dep) | Schema migrations CLI: generate, push, migrate | Always -- required for schema management |
| `dotenv` | latest (dev dep) | Load `.env` files in non-Next.js scripts | Seed scripts and standalone migration scripts that run outside Next.js |
| `tsx` | latest (dev dep) | Run TypeScript files directly (no compile step) | Seed scripts: `npx tsx src/db/seed.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `drizzle-orm/neon-http` | `drizzle-orm/neon-serverless` (WebSocket) | WebSocket has lower per-query latency but requires persistent connections; HTTP is better for Vercel serverless where functions are ephemeral |
| `drizzle-kit generate` + `migrate` | `drizzle-kit push` | `push` is faster for prototyping (applies schema changes directly, no migration files) but does not produce version-controlled migration SQL; use `push` during rapid iteration, switch to `generate`+`migrate` before committing |
| `@neondatabase/serverless` | `postgres` (pg wire protocol) | Standard Postgres driver works with Neon's connection pooler but doesn't optimize for serverless cold starts; no benefit over the official Neon driver |
| `dotenv` + `tsx` for seed scripts | `drizzle-kit` custom seed integration | drizzle-kit does not have built-in seed support; community convention is standalone TypeScript seed scripts |

**Installation:**
```bash
# Runtime dependencies
npm install drizzle-orm @neondatabase/serverless

# Dev dependencies
npm install -D drizzle-kit dotenv tsx
```

## Architecture Options

These are the fundamental choices that need to be made before writing code.

### Option A: HTTP Driver (`neon-http`) vs WebSocket Driver (`neon-serverless`)

| Option | Description | Pros | Cons | Best When |
|--------|-------------|------|------|-----------|
| `neon-http` | Uses Neon's HTTP query API via `neon()` function | Zero connection overhead, instant cold starts, no connection pooling needed, simpler setup | Higher per-query latency (~10-30ms overhead per query), no `LISTEN/NOTIFY` | Vercel serverless functions with low query volume per invocation (this demo) |
| `neon-serverless` (WebSocket) | Uses WebSocket connection via `Pool` or `Client` | Lower per-query latency after connection established, full Postgres wire protocol (transactions, LISTEN/NOTIFY) | Connection setup overhead on cold start, needs connection pooling for production, more complex setup | High-throughput apps, apps needing persistent connections, long-running processes |

**Recommended:** `neon-http` -- this is a demo on Vercel serverless with low query volume. The HTTP driver's simplicity and zero-connection-overhead model is ideal. The Drizzle official "Get Started with Neon" guide uses the HTTP driver as the default path.

**Important nuance (MEDIUM confidence):** As of Drizzle 0.36+, the `neon-http` driver gained transaction support via Neon's HTTP transaction API. Earlier documentation stated HTTP could not do transactions. This should be verified against the current Drizzle docs before assuming transactions are unavailable.

### Option B: Migration Strategy -- `generate`+`migrate` vs `push`

| Option | Description | Pros | Cons | Best When |
|--------|-------------|------|------|-----------|
| `generate` + `migrate` | Produces SQL migration files, then applies them | Version-controlled migrations, reviewable SQL, reproducible, rollback-friendly, production-grade | Two-step process, slower iteration cycle | Any project that will be deployed or shared; production; when you want migration history |
| `push` | Applies schema changes directly to database | Single command, fastest iteration, no migration files to manage | No migration history, not reproducible, can cause data loss on schema changes, not suitable for production | Rapid prototyping during initial schema design, throwaway databases |

**Recommended:** Use `push` during initial schema iteration (first hour of development), then switch to `generate` + `migrate` once the schema stabilizes. Commit the generated migration files. This gives the best of both worlds: fast iteration early, version-controlled migrations for the committed codebase.

### Option C: Schema File Organization

| Option | Description | Pros | Cons | Best When |
|--------|-------------|------|------|-----------|
| Single file (`schema.ts`) | All tables, enums, relations in one file | Simple, easy to navigate for small schemas (3-5 tables), single import | Gets unwieldy above ~10 tables | Small to medium schemas like this demo |
| Multi-file (`schema/`) | One file per table or domain (`matters.ts`, `conversations.ts`) | Better organization for large schemas, clearer ownership | More imports to manage, drizzle-kit config needs `schema` to point to directory or glob | Large projects with many tables |

**Recommended:** Single file (`src/db/schema.ts`) for this demo. The schema is 4-5 tables. A single file is easier to review in an interview context and simpler to configure in drizzle-kit.

### Counterarguments

Why someone might NOT choose the recommended options:

- **"HTTP driver can't do transactions":** This was true before Drizzle 0.36 but HTTP transactions may now be supported. Even if not, this demo does not require multi-statement transactions -- each agent tool call is a single query. If transactions become needed, the WebSocket driver can be added alongside the HTTP driver. **Response:** Valid concern for production; not relevant for this demo's query patterns.

- **"push is dangerous, always use generate+migrate":** True for shared databases. But during the first hour of solo development on a throwaway Neon branch, `push` saves time. The recommendation already includes switching to `generate`+`migrate` before committing. **Response:** The hybrid approach is standard practice documented in Drizzle's own guides.

- **"Single schema file doesn't scale":** Correct, but this demo has 4-5 tables. The complexity threshold where multi-file becomes beneficial is around 10+ tables. **Response:** Optimize for the actual size of this project, not a hypothetical larger one.

## Architecture Patterns

### Recommended Project Structure

```
leap-legal-prep/
├── src/
│   ├── app/                    # Next.js App Router pages and layouts
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/                # API route handlers
│   ├── db/
│   │   ├── schema.ts           # Drizzle schema: all tables, enums, relations
│   │   ├── index.ts            # DB connection: exports `db` instance
│   │   └── seed.ts             # Seed script (run via `npx tsx src/db/seed.ts`)
│   └── lib/                    # Shared utilities
├── drizzle/                    # Generated migration files (from drizzle-kit generate)
│   └── 0000_initial.sql
├── drizzle.config.ts           # drizzle-kit configuration
├── .env.local                  # DATABASE_URL (gitignored)
├── next.config.ts              # Next.js configuration
├── tsconfig.json
└── package.json
```

### Pattern 1: Neon HTTP Connection Setup

**What:** Initialize the Drizzle ORM instance with the Neon HTTP driver.
**When to use:** Every project using Drizzle + Neon on Vercel serverless.

```typescript
// src/db/index.ts
// Source: Drizzle official "Get Started with Neon" guide
// https://orm.drizzle.team/docs/get-started/neon-new

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);

// Pass schema for relational query support
export const db = drizzle(sql, { schema });
```

**Key detail:** Passing `{ schema }` to `drizzle()` enables the relational query API (`db.query.matters.findMany({ with: { stages: true } })`). Without it, only the SQL-like query builder (`db.select().from(...)`) is available. Both work; the relational API is more ergonomic for nested data.

### Pattern 2: Schema Definition with pgTable and pgEnum

**What:** Define PostgreSQL tables and enums using Drizzle's schema DSL.
**When to use:** Any Drizzle project targeting PostgreSQL.

```typescript
// src/db/schema.ts
// Source: Drizzle schema declaration docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// -- Enums --

export const matterTypeEnum = pgEnum('matter_type', [
  'residential_conveyancing',
  'family_law',
]);

export const stageStatusEnum = pgEnum('stage_status', [
  'not_started',
  'in_progress',
  'completed',
  'skipped',
]);

export const actionStatusEnum = pgEnum('action_status', [
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);

// -- Tables --

export const matters = pgTable('matters', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: matterTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  currentStageOrder: integer('current_stage_order').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const matterStages = pgTable('matter_stages', {
  id: uuid('id').defaultRandom().primaryKey(),
  matterId: uuid('matter_id').notNull().references(() => matters.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  stageOrder: integer('stage_order').notNull(),
  status: stageStatusEnum('status').default('not_started').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const matterActions = pgTable('matter_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  stageId: uuid('stage_id').notNull().references(() => matterStages.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  aiSuggested: boolean('ai_suggested').default(false).notNull(),
  status: actionStatusEnum('status').default('pending').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  notes: text('notes'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  matterId: uuid('matter_id').notNull().references(() => matters.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 255 }),
  messages: jsonb('messages').$type<Message[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// -- Type for JSONB messages column --
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// -- Relations (for relational query API) --

export const mattersRelations = relations(matters, ({ many }) => ({
  stages: many(matterStages),
  conversations: many(conversations),
}));

export const matterStagesRelations = relations(matterStages, ({ one, many }) => ({
  matter: one(matters, {
    fields: [matterStages.matterId],
    references: [matters.id],
  }),
  actions: many(matterActions),
}));

export const matterActionsRelations = relations(matterActions, ({ one }) => ({
  stage: one(matterStages, {
    fields: [matterActions.stageId],
    references: [matterStages.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one }) => ({
  matter: one(matters, {
    fields: [conversations.matterId],
    references: [matters.id],
  }),
}));
```

**Key decisions in this schema:**

1. **UUIDs over serial IDs:** UUIDs are standard for distributed/serverless apps. `defaultRandom()` generates them server-side. No collision risk.
2. **`stageOrder` integer:** Stages have a defined sequence. Using an integer ordering field rather than relying on insert order allows reordering and makes queries like "get next stage" trivial (`WHERE stage_order = current + 1`).
3. **`currentStageOrder` on matters:** Denormalized pointer to the current stage. Avoids a join to determine where the matter is. The agent tool `get_current_stage` can query `matters.currentStageOrder` directly.
4. **JSONB `messages` column:** Stores the full conversation as a JSON array. This avoids a separate `messages` table with one row per message. For a demo with short conversations, this is simpler. For production, individual rows per message would be better for search and pagination.
5. **`aiSuggested` boolean on actions:** Distinguishes between template actions (seeded) and actions the AI suggested during a conversation. Useful for the agent UI and for evaluation.
6. **Cascade deletes:** Deleting a matter cascades to its stages, actions, and conversations. Appropriate for a demo; production might use soft deletes.

### Pattern 3: drizzle-kit Configuration

**What:** Configure drizzle-kit for schema introspection, migration generation, and database push.
**When to use:** Every Drizzle project.

```typescript
// drizzle.config.ts
// Source: Drizzle Kit configuration docs
// https://orm.drizzle.team/docs/drizzle-config-file

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

**IMPORTANT -- `dialect` not `driver`:** Drizzle-kit configuration changed significantly in recent versions. The current pattern uses `dialect: 'postgresql'` (not a `driver` field). The `driver` field was used in older drizzle-kit versions and is now deprecated. Confidence: MEDIUM -- this was a breaking change in drizzle-kit 0.21+; verify against current docs.

**Commands:**
```bash
# Generate migration SQL from schema changes (creates files in ./drizzle/)
npx drizzle-kit generate

# Apply pending migrations to the database
npx drizzle-kit migrate

# Push schema directly (no migration files -- for prototyping)
npx drizzle-kit push

# Open Drizzle Studio (visual DB browser)
npx drizzle-kit studio
```

### Pattern 4: Seed Script

**What:** Programmatically insert initial data using Drizzle's query API.
**When to use:** After migrations are applied, to populate reference/template data.

```typescript
// src/db/seed.ts
// Run with: npx tsx src/db/seed.ts

import 'dotenv/config';  // Load .env.local or .env
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { matters, matterStages, matterActions } from './schema';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

const CONVEYANCING_STAGES = [
  {
    name: 'Engagement & Onboarding',
    description: 'Client identification (KYC), costs disclosure, retainer, conflict check',
    order: 1,
    actions: [
      'Verify client identity (100-point ID check)',
      'Issue costs disclosure and agreement',
      'Send retainer / engagement letter',
      'Run conflict of interest check',
      'Open matter file and assign reference number',
    ],
  },
  {
    name: 'Pre-Contract Review',
    description: 'Receive and review contract from vendor solicitor',
    order: 2,
    actions: [
      'Receive contract from vendor\'s solicitor',
      'Review standard terms and special conditions',
      'Review title search and plan',
      'Check for easements, covenants, and encumbrances',
      'Flag issues for client discussion',
    ],
  },
  // ... (stages 3-10 follow the same pattern from the scout report)
];

async function seed() {
  console.log('Seeding database...');

  // Insert a sample matter
  const [matter] = await db.insert(matters).values({
    type: 'residential_conveyancing',
    title: 'Smith Property Purchase - 42 Harbour St, Sydney',
    description: 'Residential conveyancing for buyer, freehold property',
    currentStageOrder: 1,
  }).returning();

  console.log(`Created matter: ${matter.id}`);

  // Insert stages and their actions
  for (const stageData of CONVEYANCING_STAGES) {
    const [stage] = await db.insert(matterStages).values({
      matterId: matter.id,
      name: stageData.name,
      description: stageData.description,
      stageOrder: stageData.order,
      status: stageData.order === 1 ? 'in_progress' : 'not_started',
    }).returning();

    // Insert actions for this stage
    await db.insert(matterActions).values(
      stageData.actions.map((desc, i) => ({
        stageId: stage.id,
        description: desc,
        sortOrder: i + 1,
        status: 'pending' as const,
      })),
    );

    console.log(`  Stage ${stageData.order}: ${stageData.name} (${stageData.actions.length} actions)`);
  }

  console.log('Seeding complete.');
}

seed().catch(console.error);
```

**Key details:**

1. **`import 'dotenv/config'`:** The seed script runs outside Next.js (via `npx tsx`), so it needs to load environment variables manually. Next.js auto-loads `.env.local` for its own processes but `tsx` does not.
2. **`.returning()`:** Returns the inserted row(s) so you can use the generated `id` for subsequent inserts (stages need `matter.id`, actions need `stage.id`).
3. **Batch insert:** `db.insert(matterActions).values([...array...])` inserts multiple rows in a single query. More efficient than one-at-a-time.
4. **`as const` assertion on enum values:** Ensures TypeScript narrows the string literal to match the pgEnum type. Without it, TypeScript may widen to `string` and fail type-checking.
5. **`dotenv` loads `.env` by default, not `.env.local`:** If the DATABASE_URL is in `.env.local` (Next.js convention), either rename to `.env` for the seed script, or use `dotenv.config({ path: '.env.local' })`.

### Pattern 5: Next.js 15 Scaffolding

**What:** Create a new Next.js 15 project with App Router and TypeScript.
**When to use:** Greenfield project.

```bash
npx create-next-app@latest leap-legal-prep \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --turbopack
```

**Flag explanations:**

| Flag | Effect | Why |
|------|--------|-----|
| `--typescript` | TypeScript configuration | Required for Drizzle type safety |
| `--tailwind` | Tailwind CSS v4 setup | Standard for rapid UI development |
| `--eslint` | ESLint configuration | Code quality |
| `--app` | App Router (not Pages Router) | Current standard; LEAP's stack |
| `--src-dir` | Uses `src/` directory | Keeps root clean; standard for larger projects |
| `--import-alias "@/*"` | Path alias `@/` maps to `src/` | Clean imports: `import { db } from '@/db'` |
| `--turbopack` | Enables Turbopack for dev server | Faster HMR; default in Next.js 15.1+ |

**Confidence on flags:** MEDIUM. The exact flags for `create-next-app` v15 should be verified by running `npx create-next-app@latest --help`. The core flags (`--typescript`, `--tailwind`, `--app`, `--src-dir`) have been stable since Next.js 14. The `--turbopack` flag became default in 15.1+, so it may be redundant. `create-next-app` also runs interactively if flags are omitted -- the implementer can answer prompts instead.

**Note on existing project structure:** Since this repo already has files at the root (README.md, LICENSE.md, .gitignore, project/ directory), the scaffolding command should either:
1. Run `create-next-app` in a temporary directory and move files into the root, OR
2. Run `create-next-app .` in the current directory (this may conflict with existing files), OR
3. Manually initialize: `npm init -y`, install `next react react-dom`, and create the App Router structure by hand

Option 3 is safest given existing files. The implementer should decide based on which files they want to preserve.

### Anti-Patterns to Avoid

- **Importing from `drizzle-orm/neon-serverless` when you mean `drizzle-orm/neon-http`:** These are two different drivers. `neon-http` uses the HTTP query function (`neon()` from `@neondatabase/serverless`). `neon-serverless` uses the WebSocket-based `Pool`/`Client`. Using the wrong import path will produce confusing type errors or runtime failures.

- **Omitting `{ schema }` from `drizzle()` and then using `db.query.*`:** The relational query API only works when the schema is passed to the `drizzle()` constructor. If you only use the SQL-like builder (`db.select().from(...)`) this is fine, but the relational API is significantly more ergonomic for fetching nested data.

- **Using `serial` or `bigserial` for primary keys:** Drizzle supports these but UUIDs (`uuid().defaultRandom()`) are the better choice for serverless apps. Serial IDs require database-level sequence coordination which adds latency in distributed setups. UUIDs are generated independently.

- **Forgetting `withTimezone: true` on timestamps:** PostgreSQL's `timestamp` type stores without timezone by default. For any app that might serve users across timezones (or run on UTC servers hitting a differently-configured DB), always use `timestamp with time zone` (`timestamptz`). In Drizzle: `timestamp('col', { withTimezone: true })`.

- **Hardcoding workflow stages in prompts instead of the database:** The roadmap explicitly warns against this. Stages should be data-driven (read from DB) so the agent's behavior changes with data, not code changes.

- **Running seed scripts without `dotenv` configuration:** The seed script runs via `npx tsx`, not through Next.js. Environment variables from `.env.local` are NOT automatically available. Must import `dotenv/config` or use an explicit path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom UUID function | `uuid().defaultRandom()` in Drizzle schema | Drizzle delegates to PostgreSQL's `gen_random_uuid()`, which is cryptographically random and indexed efficiently |
| Migration diffing | Manual SQL ALTER statements | `drizzle-kit generate` | Drizzle-kit introspects the schema TypeScript and the database state, then generates the minimal diff as SQL. Hand-writing ALTER statements for 4-5 tables with foreign keys is error-prone |
| Connection pooling | Custom pool wrapper | Neon's HTTP driver (connectionless) | The HTTP driver is connectionless by design -- no pooling needed. This is a feature, not a limitation, for serverless |
| Type inference from schema | Manual TypeScript interfaces | `typeof matters.$inferInsert` / `typeof matters.$inferSelect` | Drizzle infers insert and select types directly from the schema definition. Writing separate interfaces is redundant and drifts |
| Enum validation | Manual string checks | `pgEnum` + TypeScript narrowing | Drizzle's `pgEnum` creates both the PostgreSQL ENUM type and a TypeScript type. Database enforces valid values; TypeScript catches invalid values at compile time |

## Common Pitfalls

### Pitfall 1: drizzle-kit `driver` vs `dialect` Configuration Confusion

**What goes wrong:** The `drizzle.config.ts` file uses a `driver` field that drizzle-kit no longer recognizes, causing migration generation to fail with a confusing error.
**Why it happens:** Drizzle-kit underwent a configuration overhaul around version 0.21. Blog posts and tutorials from before this change show `driver: 'pg'` or `driver: 'neon'`. The current API uses `dialect: 'postgresql'` with no `driver` field for the Neon HTTP case. Drizzle-kit auto-detects the appropriate driver from the dialect and connection URL.
**How to avoid:** Use `defineConfig` from `drizzle-kit` and set `dialect: 'postgresql'`. Do not set a `driver` field. Verify against the current drizzle-kit docs if this research is more than a few weeks old -- drizzle-kit's config format has changed multiple times.
**Confidence:** MEDIUM -- this is based on the drizzle-kit 0.21+ migration. Verify.

### Pitfall 2: `.env.local` Not Loaded in Seed Scripts

**What goes wrong:** Seed script runs but fails with `Error: The connection string is missing` because `process.env.DATABASE_URL` is undefined.
**Why it happens:** Next.js loads `.env.local` automatically for its own dev server and build processes. But the seed script runs via `npx tsx src/db/seed.ts`, which is a standalone Node process with no Next.js involvement. `dotenv` loads `.env` by default, not `.env.local`.
**How to avoid:** Either (a) put DATABASE_URL in `.env` (which Next.js also reads, but at lower priority than `.env.local`), or (b) use `dotenv.config({ path: '.env.local' })` in the seed script, or (c) use a package.json script that sets the env inline: `"db:seed": "dotenv -e .env.local -- tsx src/db/seed.ts"`.

### Pitfall 3: Schema Relations Are Not Foreign Keys

**What goes wrong:** Developer defines Drizzle `relations()` but not `.references()` on the column, expecting the database to enforce referential integrity. Data integrity is silently violated.
**Why it happens:** Drizzle has two separate concepts: (1) `.references(() => otherTable.id)` on a column, which creates an actual PostgreSQL FOREIGN KEY constraint, and (2) `relations(table, ...)` which defines relationships for the relational query API (`db.query.*.findMany({ with: ... })`). They are independent. You need BOTH: `.references()` for database-level integrity, `relations()` for query convenience.
**How to avoid:** Always add `.references()` to foreign key columns AND define `relations()` for the query API. The schema example in this document shows both.

### Pitfall 4: JSONB Column Type Safety

**What goes wrong:** The JSONB `messages` column accepts any JSON at the database level, so inserting malformed data does not error. TypeScript types only enforce at compile time, not runtime.
**Why it happens:** PostgreSQL JSONB accepts any valid JSON. Drizzle's `.$type<T>()` annotation provides TypeScript inference but not runtime validation. There is no database-level schema enforcement on JSONB contents.
**How to avoid:** For a demo, the TypeScript type annotation is sufficient. For production, validate JSONB data at the application layer (e.g., with Zod) before inserting. Alternatively, use a normalized `messages` table with typed columns instead of JSONB.

### Pitfall 5: `create-next-app` Conflicts with Existing Files

**What goes wrong:** Running `create-next-app .` in the existing repo directory fails or overwrites existing files (README.md, .gitignore, LICENSE.md).
**Why it happens:** `create-next-app` expects an empty directory or a new directory name. It generates its own README.md, .gitignore, etc.
**How to avoid:** Either (a) scaffold into a temp directory and cherry-pick files, (b) manually initialize the Next.js project by installing dependencies and creating the file structure by hand, or (c) backup existing files, scaffold, then restore them. Option (b) is cleanest for a repo that already has content.

## Security

### Known Vulnerabilities

No known CVEs or advisories found for `drizzle-orm`, `@neondatabase/serverless`, or `drizzle-kit` as of 2026-03-30. The scout report also found no security issues for these packages.

### Architectural Security Risks

| Risk | Affected Architecture Options | How It Manifests | Secure Pattern | Anti-Pattern to Avoid |
|------|-------------------------------|------------------|----------------|----------------------|
| SQL injection via raw queries | Both HTTP and WebSocket drivers | Using `sql.raw()` or template literal interpolation without parameterization | Use Drizzle's query builder exclusively (parameterized by default); use `sql` tagged template for raw SQL (auto-parameterized) | Never concatenate user input into SQL strings; avoid `sql.raw()` with user data |
| DATABASE_URL exposure | All options | Connection string leaked in client-side code, error messages, or logs | Keep DATABASE_URL server-side only (never import db module in client components); use `.env.local` (gitignored by default) | Do not prefix env vars with `NEXT_PUBLIC_` -- this exposes them to the client bundle |
| JSONB content injection | JSONB messages column | Malicious content stored in JSONB could contain script content rendered unsafely in the UI | Sanitize JSONB content at read time; React auto-escapes JSX by default; never use unsafe HTML rendering on JSONB content | Never render JSONB content via unsafe HTML injection methods |
| Neon connection string in migrations | drizzle-kit configuration | `drizzle.config.ts` reads `DATABASE_URL` at runtime; if committed with a hardcoded URL, credentials leak | Always use `process.env.DATABASE_URL` in drizzle.config.ts; never hardcode connection strings | Do not commit `.env` or `.env.local` files |

### Trust Boundaries

- **Seed script / migration scripts:** These run with full database write access. They are developer tools, not user-facing. Ensure they only run in development/CI, never triggered by user input.
- **API route handlers (future):** When Feature #4 (agent) is built, API routes will accept user input that queries the database. All user input must be parameterized through Drizzle's query builder (which it is by default). No raw SQL with user input.
- **Environment variables:** `DATABASE_URL` is the most sensitive value. It grants full read/write access to the database. Must be in `.env.local` (gitignored), set in Vercel project settings for deployment, and never prefixed with `NEXT_PUBLIC_`.

## Performance

| Metric | Value / Range | Source | Notes |
|--------|---------------|--------|-------|
| Neon HTTP query latency overhead | ~10-30ms per query | Scout report (section 5), Neon docs | Compared to persistent connection; acceptable for low-volume demo |
| Neon cold start time | Near-instant (HTTP), 100-300ms (WebSocket) | Neon marketing, community benchmarks | HTTP driver has no connection to establish |
| Drizzle runtime bundle (tree-shaken) | ~30-50KB gzipped | Scout report (section 5) | Only neon-http driver code in production |
| `@neondatabase/serverless` package | ~410KB unpacked | npm registry (verified by scout) | Small dependency footprint |
| Neon free tier compute | 100 CU-hours/month | Neon pricing page (verified by scout) | Demo will use <5 CU-hours |

No formal Drizzle ORM benchmarks found comparing it to Prisma or Knex for Neon specifically. Community consensus (LOW confidence) suggests Drizzle has lower overhead than Prisma due to no query engine binary, but this has not been independently verified for this specific use case.

## Code Examples

### Querying with the Relational API

```typescript
// Source: Drizzle relational queries documentation
// https://orm.drizzle.team/docs/rqb

// Get a matter with all its stages and their actions
const matterWithDetails = await db.query.matters.findFirst({
  where: eq(matters.id, matterId),
  with: {
    stages: {
      orderBy: [asc(matterStages.stageOrder)],
      with: {
        actions: {
          orderBy: [asc(matterActions.sortOrder)],
        },
      },
    },
  },
});
```

### Querying with the SQL-Like Builder

```typescript
// Source: Drizzle select documentation
// https://orm.drizzle.team/docs/select

import { eq, and, asc } from 'drizzle-orm';

// Get pending actions for the current stage
const pendingActions = await db
  .select()
  .from(matterActions)
  .innerJoin(matterStages, eq(matterActions.stageId, matterStages.id))
  .where(
    and(
      eq(matterStages.matterId, matterId),
      eq(matterStages.status, 'in_progress'),
      eq(matterActions.status, 'pending'),
    ),
  )
  .orderBy(asc(matterActions.sortOrder));
```

### Updating a Record

```typescript
// Source: Drizzle update documentation
// https://orm.drizzle.team/docs/update

import { eq } from 'drizzle-orm';

// Mark an action as completed
await db
  .update(matterActions)
  .set({
    status: 'completed',
    completedAt: new Date(),
    updatedAt: new Date(),
  })
  .where(eq(matterActions.id, actionId));
```

### Type Inference from Schema

```typescript
// Source: Drizzle type inference docs
// https://orm.drizzle.team/docs/goodies#type-api

// Infer types directly from schema -- no separate interface files
type Matter = typeof matters.$inferSelect;        // What you get when reading
type NewMatter = typeof matters.$inferInsert;      // What you provide when inserting
type MatterStage = typeof matterStages.$inferSelect;
type NewMatterStage = typeof matterStages.$inferInsert;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `driver: 'pg'` in drizzle.config.ts | `dialect: 'postgresql'` in drizzle.config.ts | drizzle-kit 0.21+ (2024) | Old config format causes errors; use `defineConfig` from drizzle-kit |
| `drizzle-orm/neon-serverless` as default | `drizzle-orm/neon-http` as default for serverless | Drizzle 0.30+ (2024) | HTTP driver became the recommended path for Vercel/serverless; WebSocket reserved for persistent connections |
| `@vercel/postgres` with Drizzle | `@neondatabase/serverless` directly | Ongoing | `@vercel/postgres` is a thin wrapper around Neon; using Neon directly gives more control and is the pattern in official Drizzle docs |
| Prisma as default Next.js ORM | Drizzle gaining significant share | 2024-2025 | Drizzle's lighter runtime, no query engine binary, and better serverless support driving adoption; Prisma still dominant by install count |
| Next.js Pages Router | Next.js App Router | Next.js 13+ (2023), stable in 14+ | App Router is the default for new projects; `create-next-app` defaults to App Router |

**Deprecated/outdated:**

- **`driver` field in drizzle.config.ts:** Replaced by `dialect` in drizzle-kit 0.21+. Old tutorials showing `driver: 'pg'` or `driver: 'neon'` will not work with current drizzle-kit.
- **`@vercel/postgres`:** Not deprecated per se, but Drizzle's official Neon guide uses `@neondatabase/serverless` directly. The Vercel wrapper adds no value when using Drizzle.
- **`drizzle-orm/neon-serverless` for HTTP queries:** This module is for WebSocket connections. Use `drizzle-orm/neon-http` for the HTTP driver. Confusing naming -- the "serverless" in the module name refers to the connection type, not the deployment model.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None -- needs creating (greenfield project) |
| Config file | None -- needs creating |
| Quick run command | TBD after scaffolding |
| Full suite command | TBD after scaffolding |

**Note:** Next.js 15 does not include a test framework by default. The implementer will need to choose and configure one. Vitest is the current community standard for Next.js projects (faster than Jest, native ESM support, compatible with Next.js). However, test framework selection is outside the scope of Feature #1 -- the data layer can be validated by running the seed script and querying the database.

### Requirements to Test Map

| Requirement | Behavior | Test Type | Automated Command | File Exists? |
|-------------|----------|-----------|-------------------|--------------|
| Neon connection works | `db` instance connects and can query | Integration (against real Neon DB) | `npx tsx src/db/seed.ts` (seed inserts data; if it succeeds, connection works) | Needs creating: `src/db/seed.ts` |
| Schema is valid SQL | drizzle-kit can generate migration from schema | CLI validation | `npx drizzle-kit generate` | Needs creating: `src/db/schema.ts`, `drizzle.config.ts` |
| Migrations apply cleanly | Generated SQL applies to Neon without errors | CLI validation | `npx drizzle-kit migrate` | Needs creating: migration files via `generate` |
| Seed data is correct | All 10 conveyancing stages with actions are inserted | Manual verification | `npx drizzle-kit studio` (visual inspection) or a query script | Needs creating: `src/db/seed.ts` |
| Foreign keys enforce integrity | Inserting a stage with a non-existent matter_id fails | Integration | Manual test or test script | Needs creating |
| JSONB messages column accepts valid JSON | Insert and retrieve a conversation with messages | Integration | Test script or seed extension | Needs creating |
| Type inference works | TypeScript compiles without errors on schema imports | Build validation | `npx tsc --noEmit` | Needs creating: schema file |

### Gaps (files to create before implementation)

- [ ] `src/db/schema.ts` -- Drizzle schema with all tables and relations
- [ ] `src/db/index.ts` -- Database connection instance export
- [ ] `src/db/seed.ts` -- Seed script for conveyancing workflow template
- [ ] `drizzle.config.ts` -- drizzle-kit configuration
- [ ] `.env.local` -- DATABASE_URL environment variable
- [ ] `package.json` -- Project dependencies (created by scaffolding or manual init)

## Open Questions

1. **Has drizzle-kit's config format changed again since 0.21?**
   - What we know: The `dialect` field replaced `driver` in 0.21. The `defineConfig` helper was added.
   - What's unclear: Whether drizzle-kit 0.45+ (matching drizzle-orm 0.45.2) has made further config changes.
   - Recommendation: Run `npx drizzle-kit generate --help` after installation to verify current CLI options. Check the drizzle-kit changelog.

2. **Does `drizzle-orm/neon-http` support transactions now?**
   - What we know: Earlier versions required WebSocket for transactions. Neon added HTTP transaction support. Drizzle 0.36+ may have added support for this.
   - What's unclear: Whether `db.transaction()` works with the neon-http driver in the current version.
   - Recommendation: Not needed for this demo (all queries are single-statement), but verify if any future feature requires multi-statement atomicity.

3. **What does `create-next-app` v15 generate with `--turbopack`?**
   - What we know: Turbopack became the default dev bundler in Next.js 15.1+. The `--turbopack` flag may be default or redundant.
   - What's unclear: Whether the flag is still needed or has been removed from the CLI.
   - Recommendation: Run `npx create-next-app@latest --help` to see current flags. If `--turbopack` is not listed, it may be the default.

4. **Exact scaffold approach for a repo with existing files?**
   - What we know: The repo has README.md, LICENSE.md, .gitignore, and a `project/` directory.
   - What's unclear: Whether `create-next-app .` will clobber these files or skip them.
   - Recommendation: The implementer should try `create-next-app .` and see what happens, or manually initialize. This is a one-time decision with low risk.

5. **Should `updatedAt` use a database trigger or application-level updates?**
   - What we know: The schema uses `.defaultNow()` for `updatedAt`, which only sets the value on INSERT. Updates require the application to explicitly set `updatedAt: new Date()`.
   - What's unclear: Whether Drizzle has a built-in `.$onUpdate()` hook or if a PostgreSQL trigger is needed.
   - Recommendation: For the demo, set `updatedAt` explicitly in update queries. For production, add a PostgreSQL trigger via a migration. Drizzle has a `.$onUpdate()` column modifier that may handle this -- verify.

## Sources

### Primary (HIGH confidence)

- [Scout Report: Drizzle ORM + Neon PostgreSQL (section 5)](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/20260330-SCOUT-REPORT.md) -- Version numbers (drizzle-orm 0.45.2, @neondatabase/serverless 1.0.2), package sizes, license verification, Neon free tier limits, connection code pattern
- [Scout Report: Legal Domain (section 6)](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/20260330-SCOUT-REPORT.md) -- Conveyancing workflow stages, domain modeling insight
- [Roadmap: Feature #1 Drizzle + Neon Data Layer](file:///Users/nousunio/Repos/Learnings/claude-code/leap-legal-prep/project/roadmaps/20260330-01-leap-pathways-demo-roadmap.md) -- Schema requirements, todo list, impact analysis
- [Drizzle ORM Official Docs: Get Started with Neon](https://orm.drizzle.team/docs/get-started/neon-new) -- Referenced by scout report for connection setup pattern
- [Drizzle ORM Official Docs: Schema Declaration](https://orm.drizzle.team/docs/sql-schema-declaration) -- pgTable, pgEnum, column types
- [Drizzle ORM Official Docs: Configuration File](https://orm.drizzle.team/docs/drizzle-config-file) -- drizzle.config.ts format
- [npm: drizzle-orm](https://www.npmjs.com/package/drizzle-orm) -- Version 0.45.2 verified by scout
- [npm: @neondatabase/serverless](https://www.npmjs.com/package/@neondatabase/serverless) -- Version 1.0.2 verified by scout

### Secondary (MEDIUM confidence)

- Drizzle-kit `dialect` vs `driver` migration -- based on training data knowledge of drizzle-kit 0.21+ changes; pattern is well-established in community but exact current behavior should be verified
- Next.js `create-next-app` flags -- based on training data; core flags stable since Next.js 14 but exact v15 flags should be verified with `--help`
- Drizzle `.$onUpdate()` column modifier -- exists in training data but exact API and behavior should be verified against current docs
- Drizzle HTTP transaction support (0.36+) -- referenced in community discussions but not verified against official changelog

### Tertiary (LOW confidence)

- Drizzle ORM performance vs Prisma benchmarks -- community consensus only, no rigorous independent benchmarks found for Neon specifically

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- versions and packages verified by scout report against npm registry
- Architecture options (HTTP vs WebSocket): HIGH -- well-documented distinction in official Drizzle + Neon guides
- Architecture options (generate vs push): MEDIUM -- based on Drizzle docs and community patterns; exact CLI behavior should be verified
- Schema design patterns: MEDIUM -- pgTable/pgEnum/relations API based on training data cross-referenced with official docs URLs; exact column modifier APIs (e.g., `.$type<T>()`, `.$onUpdate()`) should be verified
- drizzle-kit configuration: MEDIUM -- `dialect` pattern is post-0.21 standard but has changed before; verify
- Seed script patterns: MEDIUM -- community convention; Drizzle has no official seed guide
- Pitfalls: MEDIUM -- drawn from training data knowledge of common issues; real-world validation recommended
- Next.js scaffolding: MEDIUM -- core flags stable but exact v15.x options should be verified with `--help`
- Security: HIGH -- architectural risks are well-understood patterns; no library-specific CVEs found

**Research date:** 2026-03-30
