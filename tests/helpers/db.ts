import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Integration tests run against real Postgres. Each test file gets its own
 * throwaway schema in TEST_DATABASE_URL, so files can run in parallel.
 *
 *   docker run -d -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5433/postgres npm test
 */
export const TEST_DB = process.env.TEST_DATABASE_URL;

export async function createTestDb(): Promise<{ db: PrismaClient; drop: () => Promise<void> }> {
  if (!TEST_DB) throw new Error("TEST_DATABASE_URL is not set");
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const url = `${TEST_DB}${TEST_DB.includes("?") ? "&" : "?"}schema=${schema}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    stdio: "pipe",
  });
  const db = new PrismaClient({ datasources: { db: { url } } });
  return {
    db,
    drop: async () => {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.$disconnect();
    },
  };
}
