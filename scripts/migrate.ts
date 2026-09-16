// Applies db/migrations in filename order and records what it applied, so
// re-running is safe and a half-applied migration is visible.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "db",
  "migrations",
);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Run: DATABASE_URL='postgres://…' npm run db:migrate",
    );
    process.exit(1);
  }

  const sql = neon(url);

  await sql`
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (
      (await sql`select filename from schema_migrations`) as {
        filename: string;
      }[]
    ).map((row) => row.filename),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }

    const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`apply ${file}`);

    // Neon's HTTP driver sends one statement per call, so a migration file is
    // split on semicolons at the start of a line. Statements here are plain
    // DDL with no function bodies, so this split is safe.
    //
    // Each chunk carries the comment block that preceded it, so leading `--`
    // lines are stripped rather than used to reject the chunk — otherwise any
    // statement documented with a comment is silently skipped.
    const statements = text
      .split(/;\s*$/m)
      .map((s) =>
        s
          .split("\n")
          .filter((line) => !/^\s*--/.test(line))
          .join("\n")
          .trim(),
      )
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await sql.query(statement);
    }

    await sql`insert into schema_migrations (filename) values (${file})`;
    count++;
  }

  console.log(
    count === 0 ? "Nothing to apply." : `Applied ${count} migration(s).`,
  );
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
