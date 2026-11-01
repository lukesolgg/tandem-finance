import type { Prisma, PrismaClient } from "@prisma/client";
import { accountWhere, aggregateTransactionWhere, type Viewer } from "../access/visibility";
import { periodForKey, shiftPeriod, type Period } from "../periods";
import { totals, type AggTxn } from "./aggregate";

/**
 * Read models for dashboard / budgets / monthly review. All built on
 * `aggregateTransactionWhere` — what the viewer is allowed to have counted.
 */
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export interface Scope {
  /** "household" = everything the viewer may count; "personal" = their own accounts only. */
  kind: "household" | "personal";
}

export function scopeWhere(viewer: Viewer, scope: Scope): Prisma.TransactionWhereInput {
  const base = aggregateTransactionWhere(viewer);
  return scope.kind === "personal" ? { AND: [base, { account: { ownerId: viewer.userId } }] } : base;
}

/** Transactions counted in totals: splits replace their parent. */
const countable: Prisma.TransactionWhereInput = { OR: [{ parentId: { not: null } }, { splits: { none: {} } }] };

export async function loadAggTxns(db: PrismaClient, viewer: Viewer, from: string, to: string, scope: Scope = { kind: "household" }): Promise<AggTxn[]> {
  const rows = await db.transaction.findMany({
    where: { AND: [scopeWhere(viewer, scope), countable, { date: { gte: toDate(from), lte: toDate(to) } }] },
    select: {
      date: true,
      amount: true,
      categoryId: true,
      transferGroupId: true,
      category: { select: { group: { select: { kind: true } } } },
      merchant: { select: { normalisedKey: true, name: true } },
      account: { select: { ownerId: true } },
    },
  });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    amount: r.amount,
    categoryId: r.categoryId,
    groupKind: (r.category?.group.kind as AggTxn["groupKind"]) ?? null,
    merchantKey: r.merchant?.normalisedKey ?? null,
    merchantName: r.merchant?.name ?? null,
    isTransfer: Boolean(r.transferGroupId),
    ownerId: r.account.ownerId,
  }));
}

export async function periodTotals(db: PrismaClient, viewer: Viewer, p: Period, scope?: Scope) {
  return totals(await loadAggTxns(db, viewer, p.start, p.end, scope));
}

/** Last `n` periods of income / spend for the cash-flow chart. */
export async function cashFlowSeries(db: PrismaClient, viewer: Viewer, currentKey: string, startDay: number, n = 6) {
  const periods = Array.from({ length: n }, (_, i) => periodForKey(shiftPeriod(currentKey, i - n + 1), startDay));
  const all = await loadAggTxns(db, viewer, periods[0]!.start, periods[n - 1]!.end);
  return periods.map((p) => {
    const t = totals(all.filter((x) => x.date >= p.start && x.date <= p.end));
    return { key: p.key, label: p.label.split(" ")[0]!.slice(0, 3), income: t.income, spend: t.spend };
  });
}

/**
 * Simple net worth: latest statement balance per visible account, rolled
 * forward by any transactions after it. Accounts with no balance info are
 * listed as unknown rather than guessed. Credit cards & loans are naturally
 * negative.
 */
export async function netWorth(db: PrismaClient, viewer: Viewer) {
  const accounts = await db.account.findMany({
    where: { ...accountWhere(viewer), archivedAt: null },
    include: { balances: { orderBy: { date: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });
  const out = [];
  for (const a of accounts) {
    const snap = a.balances[0];
    if (!snap) {
      out.push({ id: a.id, name: a.name, type: a.type, ownerId: a.ownerId, balance: null as number | null, asOf: null as string | null });
      continue;
    }
    // Roll forward with all txns after the snapshot that the viewer may count.
    const after = await db.transaction.aggregate({
      where: { AND: [aggregateTransactionWhere(viewer), countable, { accountId: a.id, date: { gt: snap.date } }] },
      _sum: { amount: true },
      _max: { date: true },
    });
    out.push({
      id: a.id,
      name: a.name,
      type: a.type,
      ownerId: a.ownerId,
      balance: snap.balance + (after._sum.amount ?? 0),
      asOf: (after._max.date ?? snap.date).toISOString().slice(0, 10),
    });
  }
  const known = out.filter((x) => x.balance !== null);
  return { accounts: out, total: known.reduce((s, x) => s + x.balance!, 0), unknownCount: out.length - known.length };
}
