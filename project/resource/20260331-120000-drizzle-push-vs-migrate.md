# Drizzle ORM: `db:push` vs `db:migrate`

Drizzle Kit provides two ways to sync your TypeScript schema to a database. Understanding the difference — and the danger of mixing them — is critical for avoiding broken deployments.

## `db:push` (drizzle-kit push)

- Reads your TypeScript schema definitions directly
- Connects to the live database and diffs the current state against your schema
- Applies changes immediately (CREATE, ALTER, DROP) to make the DB match
- **No migration files are generated or tracked**
- Best for: prototyping, rapid iteration, local development

```bash
npx drizzle-kit push
```

## `db:migrate` (drizzle-kit migrate)

- Runs versioned SQL migration files from the `drizzle/` folder
- Migrations are generated first with `drizzle-kit generate`
- Each migration is tracked in a `__drizzle_migrations` table in the database
- Migrations are sequential, reviewable, and repeatable
- Best for: production, team environments, CI/CD pipelines

```bash
npx drizzle-kit generate   # creates SQL files in drizzle/
npx drizzle-kit migrate     # applies them to the database
```

## The Gotcha: Mixing Push and Migrate

`db:push` does **not** write to the `__drizzle_migrations` tracking table. This means:

1. If you use `push` to create tables during development...
2. Then later generate migrations and run `migrate`...
3. Drizzle has no record that `push` already applied those changes
4. Migrations will fail with errors like `relation "x" already exists`

### How to avoid issues

- **Pick one method and stick with it** for a given environment
- If switching from `push` to `migrate`: drop the database and start fresh with migrations (easiest during early development)
- Alternatively, generate migrations and manually mark them as applied in `__drizzle_migrations`

## Common Error: "relation does not exist"

If you see `relation "table_name" does not exist` when seeding, it means the table hasn't been created yet. Run either `db:push` or `db:migrate` before seeding:

```bash
npm run db:push    # or: npm run db:generate && npm run db:migrate
npm run db:seed
```

## References

- [Drizzle Kit Push docs](https://orm.drizzle.team/docs/drizzle-kit-push)
- [Drizzle Kit Migrate docs](https://orm.drizzle.team/docs/drizzle-kit-migrate)
- [Drizzle Kit Generate docs](https://orm.drizzle.team/docs/drizzle-kit-generate)
