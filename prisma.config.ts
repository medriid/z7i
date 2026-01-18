import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  migrate: {
    adapter: async () => {
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { Pool } = await import("pg");
      const databaseUrl =
        process.env.DATABASE_URL ??
        process.env.POSTGRES_URL ??
        process.env.POSTGRES_PRISMA_URL ??
        process.env.POSTGRES_URL_NON_POOLING ??
        process.env.NEON_DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "Database connection string is missing. Set DATABASE_URL or a Postgres/Neon URL env var."
        );
      }
      const pool = new Pool({
        connectionString: databaseUrl,
        max: Number(process.env.PG_POOL_MAX ?? 3),
        idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS ?? 10000),
        connectionTimeoutMillis: Number(process.env.PG_POOL_CONN_MS ?? 10000),
      });
      return new PrismaPg(pool);
    },
  },
});
