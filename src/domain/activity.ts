import type { Prisma, PrismaClient } from "@prisma/client";
import type { Viewer } from "./access/visibility";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Append to the household activity log.
 * `summary` is shown to the partner when `visibleToPartner` — NEVER put amounts,
 * descriptions of private items, or account names of private accounts in it.
 */
export async function logActivity(
  db: Db,
  viewer: Viewer,
  entry: { action: string; entityType: string; entityId: string; summary: string; visibleToPartner?: boolean },
) {
  await db.activityLog.create({
    data: { householdId: viewer.householdId, actorId: viewer.userId, visibleToPartner: entry.visibleToPartner ?? true, ...entry },
  });
}

export function activityWhere(viewer: Viewer): Prisma.ActivityLogWhereInput {
  return { householdId: viewer.householdId, OR: [{ visibleToPartner: true }, { actorId: viewer.userId }] };
}
