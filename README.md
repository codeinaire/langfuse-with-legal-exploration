# Legal Agent Flow Demo

An AI-powered legal matter progression agent that guides lawyers through residential conveyancing workflows. Built with Next.js, Vercel AI SDK, Drizzle ORM, Neon PostgreSQL, Langfuse, and Google Gemini.

## Stack

- **Framework:** Next.js 15 (App Router, TypeScript, Tailwind CSS v4)
- **Database:** Neon PostgreSQL (serverless HTTP driver)
- **ORM:** Drizzle ORM
- **AI:** Vercel AI SDK + Google Gemini (free tier)
- **Observability:** Langfuse (tracing, prompt management, evaluations)
- **Linting:** Biome
- **Deployment:** Vercel

## Getting Started

### Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech/) account (free tier)

### Setup

```bash
# Install dependencies
npm install

# Copy env template and add your Neon connection string
cp .env.local.example .env.local
# Edit .env.local with your DATABASE_URL

# Generate and apply migrations
npm run db:generate
npm run db:migrate

# Seed the database with a sample conveyancing matter
npm run db:seed

# Start the dev server
npm run dev
```

## Database Schema

Four tables model the legal matter lifecycle:

- **matters** -- A legal matter (e.g., residential conveyancing for a specific client)
- **matter_stages** -- The stages a matter progresses through (10 stages for conveyancing)
- **matter_actions** -- Individual tasks within each stage
- **conversations** -- Chat history between the user and the AI agent (JSONB messages)

The seed script creates a sample residential conveyancing matter with all 10 stages and 50 actions based on the Australian buyer-side conveyancing workflow.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | Lint and check formatting (Biome) |
| `npm run lint:fix` | Auto-fix lint and formatting issues |
| `npm run format` | Format all files |
| `npm run db:generate` | Generate migration SQL from schema |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run db:seed` | Seed database with sample data |
| `npm run db:studio` | Open Drizzle Studio |

## Project Structure

```
src/
  app/              # Next.js App Router pages
  db/
    schema.ts       # Drizzle schema (4 tables, 3 enums, relations)
    index.ts        # Database connection (Neon HTTP driver)
    seed.ts         # Seed script with conveyancing workflow data
drizzle/            # Generated migration SQL (version-controlled)
drizzle.config.ts   # Drizzle Kit configuration
```
