import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres.js + Drizzle。Workers(Hyperdrive 経由 Neon) / Node / Lambda で同一。
// prepare:false は Hyperdrive / pgbouncer(transaction pooling) との互換のため。
export function createDb(connectionString: string) {
  const sql = postgres(connectionString, { prepare: false });
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;
