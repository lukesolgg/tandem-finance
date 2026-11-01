import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { listGoals } from "@/domain/goals/service";
import { PageHeader } from "@/components/ui";
import { loadAccounts } from "../data";
import { GoalsClient } from "./client";

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const v = await requireViewerContext();
  const [goals, accounts] = await Promise.all([listGoals(db, v), loadAccounts(v)]);
  return (
    <>
      <PageHeader title="Goals" subtitle="Save for things together — or quietly on your own." />
      <GoalsClient
        goals={goals.map((g) => ({
          id: g.id,
          name: g.name,
          emoji: g.emoji,
          target: g.targetAmount,
          saved: g.saved,
          targetDate: g.targetDate?.toISOString().slice(0, 10) ?? null,
          shared: g.ownerId === null,
          mine: g.ownerId === v.userId,
          isPrivate: g.isPrivate,
          achieved: Boolean(g.achievedAt),
          linkedAccountName: g.linkedAccountName,
          byPerson: g.byPerson,
          plan: g.plan,
          recent: g.contributions.slice(0, 5).map((c) => ({ id: c.id, amount: c.amount, date: c.date.toISOString().slice(0, 10), who: c.user.name ?? "" })),
        }))}
        accounts={accounts.filter((a) => a.type === "savings" && (a.ownerId === null || a.ownerId === v.userId)).map((a) => ({ id: a.id, name: a.name }))}
        me={{ id: v.userId, name: v.user.name, colour: v.user.colour }}
        partner={v.partner}
      />
    </>
  );
}
