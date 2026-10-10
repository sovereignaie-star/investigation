import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// P0-014 (D-038): connect lazily so that importing this package never throws when DATABASE_URL is unset.
// Postgres is only needed for team deployments (ADR-04); local single-user mode will use per-case SQLite.
let pool: pg.Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL must be set to use @workspace/db (see ADR-04).");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  db ??= drizzle(getPool(), { schema });
  return db;
}

export * from "./schema";
