/**
 * PostgreSQL access for the Centre Edge. One pool, centre-scoped. The DB lives
 * on the centre LAN with no WAN route (§6); this module never reaches the
 * internet — it only connects to the configured local DSN.
 */
import pg from "pg";

const { Pool } = pg;
export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function makePool(databaseUrl: string, max = 10): pg.Pool {
  return new Pool({ connectionString: databaseUrl, max });
}

/** Run `fn` inside a transaction on a dedicated client; commit or rollback. */
export async function withTx<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}
