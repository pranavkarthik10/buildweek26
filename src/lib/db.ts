import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

if (!databaseUrl.startsWith("file:")) {
  throw new Error(
    "This app is configured for SQLite. Set DATABASE_URL to a file: URL, for example file:./prisma/dev.db."
  );
}

const adapter = new PrismaBetterSqlite3({
  url: databaseUrl.replace("file:", ""),
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
