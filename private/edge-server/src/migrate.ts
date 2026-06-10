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

export async function migrate(databaseUrl: string): Promise<string[]> {
  const pool = makePool(databaseUrl);
  const applied: string[] = [];
  const client = await pool.connect();
  try {
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
