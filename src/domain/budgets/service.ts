import type { PrismaClient } from "@prisma/client";
import { NotFoundError, type Viewer } from "../access/visibility";
import { elapsedFraction, periodForKey, shiftPeriod } from "../periods";
import { periodTotals } from "../insights/service";
import { carryForward, lineStatus, summarise, type Rollover } from "./compute";
import { logActivity } from "../activity";

/**
 * Budgets: one per (household | personal owner) per period.
 *
 * Household budgets are shared — both partners see and edit them. Their
 * "spent" uses what the viewer may count, so a partner's private transaction
 * never leaks through a budget total. Personal budgets belong to one person
 * and count only their own accounts.
 */
export type BudgetScope = "household" | "personal";
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function findBudget(db: PrismaClient, viewer: Viewer, scope: BudgetScope, start: string) {
  return db.budget.findFirst({
    where: { householdId: viewer.householdId, scope, ownerId: scope === "personal" ? viewer.userId : null, month: toDate(start) },
    include: { lines: true },
  });
}

/**
 * Get (or lazily open) a period's budget. Opening copies last period's lines
 * and snapshots carry-over — so budgets "just continue" month to month.
 */
export async function getOrOpenBudget(db: PrismaClient, viewer: Viewer, scope: BudgetScope, key: string, startDay: number) {
  const p = periodForKey(key, startDay);
  let budget = await findBudget(db, viewer, scope, p.start);
  if (!budget) {
    const prevP = periodForKey(shiftPeriod(key, -1), startDay);
    const prev = await findBudget(db, viewer, scope, prevP.start);
    if (!prev || prev.lines.length === 0) return { period: p, budget: null };
    const prevSpent = (await periodTotals(db, viewer, prevP, { kind: scope })).byCategory;
    budget = await db.budget.create({
      data: {
        householdId: viewer.householdId,
        scope,
        ownerId: scope === "personal" ? viewer.userId : null,
        month: toDate(p.start),
        style: prev.style,
        plannedIncome: prev.plannedIncome,
        lines: {
          create: prev.lines.map((l) => ({
            categoryId: l.categoryId,
            amount: l.amount,
            rollover: l.rollover,
            carriedIn: carryForward({ allocated: l.amount, carriedIn: l.carriedIn, spent: prevSpent.get(l.categoryId) ?? 0 }, l.rollover as Rollover),
          })),
        },
      },
      include: { lines: true },
    });
  }
  return { period: p, budget };
}

export async function budgetView(db: PrismaClient, viewer: Viewer, scope: BudgetScope, key: string, startDay: number) {
  const { period, budget } = await getOrOpenBudget(db, viewer, scope, key, startDay);
  const t = await periodTotals(db, viewer, period, { kind: scope });
  const elapsed = elapsedFraction(period);
  const lines = (budget?.lines ?? []).map((l) => ({
    ...lineStatus({ categoryId: l.categoryId, allocated: l.amount, carriedIn: l.carriedIn, spent: t.byCategory.get(l.categoryId) ?? 0 }, elapsed),
    rollover: l.rollover as Rollover,
    lineId: l.id,
  }));
  const budgeted = new Set(lines.map((l) => l.categoryId));
  const unbudgeted = [...t.byCategory.entries()].filter(([c, v]) => !budgeted.has(c as string) && v > 0).map(([categoryId, spent]) => ({ categoryId, spent }));
  return {
    period,
    elapsed,
    budget: budget ? { id: budget.id, style: budget.style, plannedIncome: budget.plannedIncome } : null,
    lines,
    unbudgeted,
    summary: summarise(lines, budget?.plannedIncome),
    income: t.income,
  };
}

async function ensureBudget(db: PrismaClient, viewer: Viewer, scope: BudgetScope, key: string, startDay: number) {
  const { period, budget } = await getOrOpenBudget(db, viewer, scope, key, startDay);
  if (budget) return budget;
  return db.budget.create({
    data: { householdId: viewer.householdId, scope, ownerId: scope === "personal" ? viewer.userId : null, month: toDate(period.start) },
    include: { lines: true },
  });
}

export async function setBudgetLine(db: PrismaClient, viewer: Viewer, scope: BudgetScope, key: string, startDay: number, categoryId: string, amount: number, rollover: Rollover) {
  const cat = await db.category.findFirst({ where: { id: categoryId, householdId: viewer.householdId } });
  if (!cat) throw new NotFoundError();
  const budget = await ensureBudget(db, viewer, scope, key, startDay);
  await db.budgetLine.upsert({
    where: { budgetId_categoryId: { budgetId: budget.id, categoryId } },
    create: { budgetId: budget.id, categoryId, amount: Math.max(0, amount), rollover },
    update: { amount: Math.max(0, amount), rollover },
  });
  if (scope === "household") await logActivity(db, viewer, { action: "budget.updated", entityType: "budget", entityId: budget.id, summary: `Updated the ${cat.name} budget` });
}

export async function removeBudgetLine(db: PrismaClient, viewer: Viewer, lineId: string) {
  const line = await db.budgetLine.findFirst({ where: { id: lineId, budget: { householdId: viewer.householdId, OR: [{ scope: "household" }, { ownerId: viewer.userId }] } } });
  if (!line) throw new NotFoundError();
  await db.budgetLine.delete({ where: { id: lineId } });
}

export async function setBudgetStyle(db: PrismaClient, viewer: Viewer, scope: BudgetScope, key: string, startDay: number, style: "targets" | "zero_based", plannedIncome: number | null) {
  const budget = await ensureBudget(db, viewer, scope, key, startDay);
  await db.budget.update({ where: { id: budget.id }, data: { style, plannedIncome } });
}

/** Re-derive carry-in from last period's actuals (after late imports/edits). */
export async function recalcCarryIn(db: PrismaClient, viewer: Viewer, scope: BudgetScope, key: string, startDay: number) {
  const { budget } = await getOrOpenBudget(db, viewer, scope, key, startDay);
  if (!budget) return;
  const prevP = periodForKey(shiftPeriod(key, -1), startDay);
  const prev = await findBudget(db, viewer, scope, prevP.start);
  const spent = (await periodTotals(db, viewer, prevP, { kind: scope })).byCategory;
  for (const l of budget.lines) {
    const pl = prev?.lines.find((x) => x.categoryId === l.categoryId);
    const carriedIn = pl ? carryForward({ allocated: pl.amount, carriedIn: pl.carriedIn, spent: spent.get(l.categoryId) ?? 0 }, l.rollover as Rollover) : 0;
    await db.budgetLine.update({ where: { id: l.id }, data: { carriedIn } });
  }
}
