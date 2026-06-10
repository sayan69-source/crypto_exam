/**
 * Centre Edge Server entrypoint. Loads config, opens the centre-scoped DB pool,
 * builds the §13 API, and listens on the centre VLAN address. LAN-only — there
 * is no outbound client here (§6).
 *
 *   DATABASE_URL=… EDGE_HOST=… EDGE_PORT=… node src/index.ts
 */
import { loadConfig } from "./config.ts";
import { makePool } from "./db.ts";
import { buildApp } from "./http.ts";

async function main() {
  const config = loadConfig();
  const pool = makePool(config.databaseUrl);
  const app = buildApp({ pool, config });

  await app.listen({ host: config.host, port: config.port });
  console.log(`ZUUP Edge listening on http://${config.host}:${config.port} (centre ${config.centreId})`);

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      await app.close();
      await pool.end();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("Edge failed to start:", err);
  process.exit(1);
});
