import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

declare global {
  var prisma: PrismaClient | undefined;
}

const resolveDatabaseUrl = () => process.env.LIBURL_URL;

const resolveAuthToken = () => process.env.LIBURL_AUTH_TOKEN;

const createPrismaClient = () => {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      'Database connection string is missing. Set LIBURL_URL.'
    );
  }
  const adapter = new PrismaLibSql({
    url: databaseUrl,
    authToken: resolveAuthToken(),
  });
  return new PrismaClient({ adapter });
};

export const prisma = global.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
