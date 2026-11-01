import { PrismaClient } from "@prisma/client";

// One client per process; survive Next.js dev hot-reloads.
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient({ log: ["warn", "error"] }); // never "query": params contain financial data
if (process.env.NODE_ENV !== "production") g.prisma = db;
