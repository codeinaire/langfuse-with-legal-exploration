# Enforcing State Machine Order in Drizzle + Postgres

## The Problem

The conveyancing matter lifecycle follows a strict linear order (pre_contract → contract_exchange → pre_settlement → settlement → post_settlement). The application enforces this through `tryAdvanceStage()` in `src/lib/state-machine/conveyancing.ts`, but nothing at the database level prevents a direct UPDATE from jumping stages out of order.

## Options for Enforcement

### 1. Application-level only (current approach)

All stage changes go through `tryAdvanceStage()`, which reads the current stage from DB and uses `getNextStage()` to determine the only valid next stage. The caller can't specify a target stage.

- **Pros:** Simple, no DB complexity
- **Cons:** No protection against direct DB access, raw SQL, or a new code path forgetting to use the function

### 2. Postgres CHECK constraint

CHECK constraints can't reference the old row value (`OLD`), so they can't validate transitions. They can only validate the new value in isolation (e.g., "must be one of these values" — which the enum already does).

### 3. Postgres trigger (the DB-level guarantee)

A BEFORE UPDATE trigger that compares old and new stage values and rejects invalid transitions. Fires on every UPDATE regardless of how it's issued.

### 4. Postgres RLS (Row Level Security)

Policy-based enforcement. More complex setup than triggers for this use case and designed more for access control than business rules.

### 5. Derive current stage instead of storing it

Remove `currentStage` from `matters` and derive it from the `matterStages` table (the row with `status = "in_progress"`). Eliminates the redundant column that can get out of sync. Not suitable if you want `currentStage` as a quick-reference field on `matters`.

## Implementing a Postgres Trigger via Drizzle

Drizzle has no trigger API. You write raw SQL in a migration file.

### Step 1: Generate an empty migration

```bash
npm run db:generate
```

### Step 2: Add trigger SQL to the migration file

```sql
-- Map each stage to its ordinal position
CREATE FUNCTION get_stage_position(stage conveyancing_stage) RETURNS int AS $$
  SELECT array_position(
    ARRAY['pre_contract','contract_exchange','pre_settlement',
          'settlement','post_settlement']::conveyancing_stage[],
    stage
  );
$$ LANGUAGE sql IMMUTABLE;

-- Validate that transitions only move forward by exactly one position
CREATE FUNCTION enforce_stage_order() RETURNS trigger AS $$
BEGIN
  IF get_stage_position(NEW.current_stage) != get_stage_position(OLD.current_stage) + 1 THEN
    RAISE EXCEPTION 'Invalid stage transition: % -> %', OLD.current_stage, NEW.current_stage;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to the matters table, only fires on current_stage changes
CREATE TRIGGER check_stage_order
  BEFORE UPDATE OF current_stage ON matters
  FOR EACH ROW
  EXECUTE FUNCTION enforce_stage_order();
```

### Step 3: Apply the migration

```bash
npm run db:migrate
```

## Gotchas

- **Stage array duplication:** The stage order in `get_stage_position()` must match the `conveyancingStageEnum` values in `src/db/schema.ts`. If you add or reorder stages in the enum, you must update the Postgres function too.
- **Neon compatibility:** Postgres triggers work on Neon serverless. No issues there.
- **Rollback:** You'll need a DOWN migration that drops the trigger and both functions.
- **Drizzle push vs migrate:** `db:push` won't apply custom SQL — you must use `db:migrate` for triggers.

## Current Decision

For a demo, application-level enforcement via `tryAdvanceStage()` is sufficient. All stage mutations flow through this single function. A Postgres trigger would be the next step if this moves toward production.

## References

- `src/lib/state-machine/conveyancing.ts` — `tryAdvanceStage()` implementation
- `src/lib/db/queries/stages.ts` — `getNextStage()` uses enum array order
- `src/db/schema.ts` — `conveyancingStageEnum` defines the stage order
- [Postgres CREATE TRIGGER docs](https://www.postgresql.org/docs/current/sql-createtrigger.html)
- [Drizzle custom migrations](https://orm.drizzle.team/docs/migrations)
