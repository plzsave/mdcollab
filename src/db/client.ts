import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres.js + Drizzle。Workers(Hyperdrive 経由の Postgres) / Node / Lambda で同一。
// prepare:false は Hyperdrive / pgbouncer(transaction pooling) との互換のため。
// fetch_types:false / max は Cloudflare Hyperdrive 公式例の推奨（#46）:
//   - fetch_types:false … 既定(true)は初回接続時に型(OID)情報を取りに行く追加往復を1回入れる。
//     adapter はリクエストごとに cold な client を作る（src/adapters/cloudflare.ts）ため、この往復が
//     毎リクエスト Hyperdrive 経由で発生してしまう。標準型(text/int/bool/timestamp)のみ使用で副作用なし。
//   - max:5 … リクエスト単位の同時接続上限（CF 例に倣う）。
export function createDb(connectionString: string) {
  const sql = postgres(connectionString, { prepare: false, fetch_types: false, max: 5 });
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;
