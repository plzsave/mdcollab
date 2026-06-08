import { defineConfig } from "drizzle-kit";

// Postgres 一本化（§6.0.1）。個人=Neon / 職場=RDS いずれも同一スキーマ。
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
