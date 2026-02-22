import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.LIBURL_URL;

const authToken =
  process.env.LIBURL_AUTH_TOKEN;

if (!databaseUrl) {
  throw new Error(
    "Database connection string is missing. Set LIBURL_URL."
  );
}

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
  migrate: {
    adapter: async () => {
      const { PrismaLibSql } = await import("@prisma/adapter-libsql");
      return new PrismaLibSql({
        url: databaseUrl,
        authToken,
      });
    },
  },
});
