import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError, type Viewer } from "../access/visibility";
import { netWorth } from "../insights/service";
import { planGoal } from "./plan";
import { logActivity } from "../activity";
import { todayIso } from "../periods";

/**
 * Goals: shared (ownerId null) or personal. A personal goal can be private.
 * Progress = Σ contributions, or the live balance of a linked savings account
 * (if the viewer may see it).
 */
export function goalWhere(viewer: Viewer): Prisma.GoalWhereInput {
  return { householdId: viewer.householdId, OR: [{ ownerId: null }, { ownerId: viewer.userId }, { isPrivate: false }] };
}

export async function listGoals(db: PrismaClient, viewer: Viewer) {
  const goals = await db.goal.findMany({
    where: goalWhere(viewer),
    include: { contributions: { orderBy: { date: "desc" }, include: { user: { select: { id: true, name: true } } } } },
    orderBy: [{ achievedAt: "asc" }, { createdAt: "asc" }],
  });
  const linked = goals.some((g) => g.linkedAccountId) ? (await netWorth(db, viewer)).accounts : [];
  const today = todayIso();
  return goals.map((g) => {
    const acct = g.linkedAccountId ? linked.find((a) => a.id === g.linkedAccountId) : undefined;
    const contributed = g.contributions.reduce((s, c) => s + c.amount, 0);
    const saved = acct?.balance ?? contributed;
    const byPerson = new Map<string, number>();
    for (const c of g.contributions) byPerson.set(c.userId, (byPerson.get(c.userId) ?? 0) + c.amount);
    return {
      ...g,
      saved,
      linkedAccountName: acct?.name ?? null,
      byPerson: Object.fromEntries(byPerson),
      plan: planGoal({
        target: g.targetAmount,
        saved,
        targetDate: g.targetDate?.toISOString().slice(0, 10),
        today,
        recentContributions: g.contributions.map((c) => ({ date: c.date.toISOString().slice(0, 10), amount: c.amount })),
      }),
    };
  });
}

export async function createGoal(
  db: PrismaClient,
  viewer: Viewer,
  input: { name: string; emoji?: string; targetAmount: number; targetDate?: string | null; shared: boolean; isPrivate?: boolean; linkedAccountId?: string | null },
) {
  const goal = await db.goal.create({
    data: {
      householdId: viewer.householdId,
      ownerId: input.shared ? null : viewer.userId,
      name: input.name.trim().slice(0, 80),
      emoji: input.emoji || null,
      targetAmount: Math.max(1, input.targetAmount),
      targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00Z`) : null,
      isPrivate: !input.shared && Boolean(input.isPrivate),
      linkedAccountId: input.linkedAccountId || null,
    },
  });
  await logActivity(db, viewer, { action: "goal.created", entityType: "goal", entityId: goal.id, summary: input.shared ? `Created shared goal "${goal.name}"` : "Created a personal goal", visibleToPartner: !goal.isPrivate });
  return goal;
}

async function editableGoal(db: PrismaClient, viewer: Viewer, id: string) {
  const g = await db.goal.findFirst({ where: { id, householdId: viewer.householdId, OR: [{ ownerId: null }, { ownerId: viewer.userId }] } });
  if (!g) throw new NotFoundError();
  return g;
}

export async function contribute(db: PrismaClient, viewer: Viewer, goalId: string, amount: number, date: string) {
  const g = await editableGoal(db, viewer, goalId);
  await db.goalContribution.create({ data: { goalId, userId: viewer.userId, amount, date: new Date(`${date}T00:00:00Z`) } });
  const total = (await db.goalContribution.aggregate({ where: { goalId }, _sum: { amount: true } }))._sum.amount ?? 0;
  if (!g.achievedAt && total >= g.targetAmount) await db.goal.update({ where: { id: goalId }, data: { achievedAt: new Date() } });
  await logActivity(db, viewer, { action: "goal.contributed", entityType: "goal", entityId: goalId, summary: `Added to "${g.name}"`, visibleToPartner: !g.isPrivate });
}

export async function deleteGoal(db: PrismaClient, viewer: Viewer, goalId: string) {
  const g = await editableGoal(db, viewer, goalId);
  await db.goal.delete({ where: { id: g.id } });
}
