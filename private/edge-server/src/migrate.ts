/**
 * Migration runner (§12, Runbook B1). Applies migrations/*.sql in name order,
 * once each, tracked in a `_migrations` table. Each file runs in its own
 * transaction so a failure rolls back cleanly.
 *
 *   DATABASE_URL=postgres://… node src/migrate.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makePool } from "./db.ts";
import { loadConfig } from "./config.ts";

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * One lock for the whole migration run, held for the session.
 *
 * `migrate()` is called by every integration test file, and the test runner runs
 * files in PARALLEL. Against an already-migrated database that is harmless —
 * each one reads `_migrations`, skips everything, and exits. Against an EMPTY
 * one they all start applying 000 at once, and two concurrent `CREATE TYPE`
 * statements collide inside Postgres's own catalog:
 *
 *     duplicate key value violates unique constraint "pg_type_typname_nsp_index"
 *
 * That is exactly why this passed on every developer machine and failed in CI:
 * locally the database has been migrated for weeks, so the race never opens;
 * CI hands the suite a database created seconds earlier. `CREATE TABLE IF NOT
 * EXISTS` does not help, because the race is between two statements that are
 * both still in flight.
 *
 * An advisory lock is the right tool: it is held on the session rather than on
 * any row, so it works when there is not yet a single table to lock, and a
 * loser simply waits and then finds the work already done.
 */
const MIGRATION_LOCK = 0x7a757570;   // "zuup"

export async function migrate(databaseUrl: string): Promise<string[]> {
  const pool = makePool(databaseUrl);
  const applied: string[] = [];
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK]);
    locked = true;
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`,
    );
    const files = readdirSync(MIG_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const seen = await client.query(`SELECT 1 FROM _migrations WHERE name = $1`, [file]);
      if (seen.rowCount && seen.rowCount > 0) {
        console.log(`= skip   ${file}`);
        continue;
      }
      const sql = readFileSync(join(MIG_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO _migrations(name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        applied.push(file);
        console.log(`+ apply  ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    // Released explicitly rather than left to session teardown: the pool may
    // hand this connection straight to the next caller, and a lock that outlives
    // its work would deadlock the run it was meant to protect.
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK]).catch(() => {});
    }
    client.release();
    await pool.end();
  }
  return applied;
}

// Run when invoked directly (node src/migrate.ts).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate.ts")) {
  migrate(loadConfig().databaseUrl)
    .then((a) => {
      console.log(a.length ? `migrations done (${a.length} applied)` : "migrations done (up to date)");
      process.exit(0);
    })
    .catch((e) => {
      console.error("migration failed:", e);
      process.exit(1);
    });
}
