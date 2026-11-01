import type { Prisma, PrismaClient } from "@prisma/client";
import { SEED_GROUPS } from "../categorisation/seed";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Give a new household its default category tree. Seed MERCHANT knowledge is
 * not copied — it lives in code (SEED_MERCHANTS) so improvements ship to every
 * household automatically; the household's own corrections live in Merchant.
 */
export async function seedHouseholdCategories(db: Db, householdId: string): Promise<void> {
  for (const [gi, g] of SEED_GROUPS.entries()) {
    const group = await db.categoryGroup.create({
      data: { householdId, name: g.name, kind: g.kind, sortOrder: gi },
    });
    await db.category.createMany({
      data: g.categories.map((c, ci) => ({
        householdId,
        groupId: group.id,
        key: c.key,
        name: c.name,
        emoji: c.emoji,
        sortOrder: ci,
      })),
    });
  }
}

/** Create a household with its first member (the owner). */
export async function createHousehold(db: PrismaClient, ownerUserId: string, name: string) {
  return db.$transaction(async (tx) => {
    const household = await tx.household.create({ data: { name } });
    await tx.householdMember.create({ data: { householdId: household.id, userId: ownerUserId, role: "owner" } });
    await seedHouseholdCategories(tx, household.id);
    return household;
  });
}
