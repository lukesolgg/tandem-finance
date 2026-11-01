import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { findTransferPairs } from "../categorisation/transfers";
import { detectRecurring } from "../recurring/detect";

/**
 * Household-wide passes that need data across accounts, run after each commit:
 *  1. pair internal transfers (so they don't count as spend/income)
 *  2. detect recurring payments
 * These only SET FLAGS; they never expose one partner's data to the other —
 * reads still go through the access layer.
 */
export async function postImport(db: PrismaClient, householdId: string, sinceDays = 200): Promise<{ transfers: number; recurring: number }> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const txns = await db.transaction.findMany({
    where: { account: { householdId }, parentId: null, date: { gte: since } },
    select: {
      id: true,
      accountId: true,
      date: true,
      amount: true,
      description: true,
      transferGroupId: true,
      categorySource: true,
      account: { select: { ownerId: true } },
      merchant: { select: { id: true, normalisedKey: true } },
    },
  });
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // 1. Transfers
  const unpaired = txns.filter((t) => !t.transferGroupId);
  const pairs = findTransferPairs(unpaired.map((t) => ({ id: t.id, accountId: t.accountId, date: iso(t.date), amount: t.amount, description: t.description })));
  const cats = new Map(
    (await db.category.findMany({ where: { householdId, key: { in: ["transfer", "partner_transfer"] } }, select: { id: true, key: true } })).map((c) => [c.key!, c.id]),
  );
  const byId = new Map(txns.map((t) => [t.id, t]));
  for (const p of pairs) {
    const a = byId.get(p.outId)!;
    const b = byId.get(p.inId)!;
    const group = randomUUID();
    // Different owners (and neither joint) → money between partners.
    const key = a.account.ownerId && b.account.ownerId && a.account.ownerId !== b.account.ownerId ? "partner_transfer" : "transfer";
    for (const t of [a, b]) {
      await db.transaction.update({
        where: { id: t.id },
        // Never overwrite a category the user chose by hand.
        data: { transferGroupId: group, ...(t.categorySource === "user" ? {} : { categoryId: cats.get(key) ?? null, categorySource: "rule", categoryConfidence: 0.9 }) },
      });
    }
  }

  // 2. Recurring
  const guesses = detectRecurring(
    txns.filter((t) => t.merchant && !t.transferGroupId).map((t) => ({ id: t.id, merchantKey: t.merchant!.normalisedKey, date: iso(t.date), amount: t.amount })),
  );
  const merchantIdByKey = new Map(txns.filter((t) => t.merchant).map((t) => [t.merchant!.normalisedKey, t.merchant!.id]));
  for (const g of guesses) {
    const merchantId = merchantIdByKey.get(g.merchantKey) ?? null;
    const existing = await db.recurringSeries.findFirst({ where: { merchantId, cadence: g.cadence, dismissedAt: null } });
    const data = { typicalAmount: Math.round(g.typicalAmount), amountVariance: g.amountVariance, nextExpected: new Date(`${g.nextExpected}T00:00:00Z`) };
    const series = existing
      ? await db.recurringSeries.update({ where: { id: existing.id }, data })
      : await db.recurringSeries.create({ data: { merchantId, cadence: g.cadence, ...data } });
    await db.transaction.updateMany({ where: { id: { in: g.transactionIds } }, data: { isRecurring: true, recurringSeriesId: series.id } });
  }
  return { transfers: pairs.length, recurring: guesses.length };
}
