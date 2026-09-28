import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import "dotenv/config";
import * as schema from "./schema";
import { resolveDatabaseTarget } from "./assert-db-target";

const target = resolveDatabaseTarget();

const pool = new Pool({
  connectionString: target.connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });
export { pool };
export type DB = typeof db;
