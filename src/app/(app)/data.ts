import "server-only";
import { db } from "@/lib/db";
import { accountWhere, type Viewer } from "@/domain/access/visibility";
import { periodContaining, todayIso } from "@/domain/periods";

/** Shared loaders for pages. All scoped by the access layer. */

export async function loadCategories(householdId: string) {
  const groups = await db.categoryGroup.findMany({
    where: { householdId },
    orderBy: { sortOrder: "asc" },
    include: { categories: { where: { archivedAt: null }, orderBy: { sortOrder: "asc" } } },
  });
  return groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, categories: g.categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, key: c.key })) }));
}
export type CategoryGroups = Awaited<ReturnType<typeof loadCategories>>;

export async function loadAccounts(viewer: Viewer) {
  return db.account.findMany({ where: { ...accountWhere(viewer), archivedAt: null }, orderBy: [{ ownerId: "asc" }, { name: "asc" }] });
}

export function currentPeriodKey(monthStartDay: number) {
  return periodContaining(todayIso(), monthStartDay).key;
}

export function validPeriodKey(k: string | undefined, monthStartDay: number) {
  return k && /^\d{4}-(0[1-9]|1[0-2])$/.test(k) ? k : currentPeriodKey(monthStartDay);
}
