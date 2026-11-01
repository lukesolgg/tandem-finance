import Link from "next/link";
import { ArrowRight, Check, Landmark, Upload, UserPlus } from "lucide-react";
import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { cashFlowSeries, netWorth, periodTotals } from "@/domain/insights/service";
import { budgetView } from "@/domain/budgets/service";
import { budgetHealth } from "@/domain/budgets/compute";
import { listGoals } from "@/domain/goals/service";
import { topN } from "@/domain/insights/aggregate";
import { periodForKey, shiftPeriod, todayIso, elapsedFraction } from "@/domain/periods";
import { aggregateTransactionWhere } from "@/domain/access/visibility";
import { Avatar, Badge, Card, CardHeader, Money, Progress, buttonClass, cx, formatMoney } from "@/components/ui";
import { CashFlowChart, CompareBars, Ring } from "@/components/charts";
import { currentPeriodKey, loadCategories } from "./data";

export const metadata = { title: "Home" };

export default async function Dashboard() {
  const v = await requireViewerContext();
  const key = currentPeriodKey(v.household.monthStartDay);
  const p = periodForKey(key, v.household.monthStartDay);
  const prevP = periodForKey(shiftPeriod(key, -1), v.household.monthStartDay);
  const txnCount = await db.transaction.count({ where: aggregateTransactionWhere(v) });
  const accountCount = await db.account.count({ where: { householdId: v.householdId, OR: [{ ownerId: v.userId }, { ownerId: null }] } });

  const hour = new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" });
  const greeting = +hour < 12 ? "Good morning" : +hour < 18 ? "Good afternoon" : "Good evening";

  if (txnCount === 0) {
    const steps = [
      { done: accountCount > 0, title: "Add your accounts", body: "One per bank account or card — and choose what your partner sees.", href: "/accounts", icon: Landmark },
      { done: Boolean(v.partner), title: "Invite your partner", body: "They get their own login. Send the link however you like.", href: "/settings", icon: UserPlus },
      { done: false, title: "Import a statement", body: "Drop in the last 1–3 months. PDF, CSV, OFX or Santander TXT.", href: "/import", icon: Upload },
    ];
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}, {v.user.name}</h1>
        <p className="mt-1 text-sm text-muted">Let&apos;s get {v.household.name} set up. Three steps, about five minutes.</p>
        <Card className="mt-6 divide-y divide-border">
          {steps.map((s, i) => (
            <Link key={s.title} href={s.href} className="flex items-center gap-4 p-4 hover:bg-surface-2/50 sm:p-5">
              <span className={cx("grid size-10 shrink-0 place-items-center rounded-full", s.done ? "bg-pos/10 text-pos" : "bg-accent-soft text-accent")}>
                {s.done ? <Check size={18} /> : <s.icon size={18} />}
              </span>
              <span className="flex-1">
                <span className={cx("block font-medium", s.done && "text-muted line-through")}>{i + 1}. {s.title}</span>
                <span className="block text-sm text-muted">{s.body}</span>
              </span>
              <ArrowRight size={16} className="text-muted" />
            </Link>
          ))}
        </Card>
      </>
    );
  }

  const [now, prev, flow, nw, budget, goals, categories, upcoming] = await Promise.all([
    periodTotals(db, v, p),
    periodTotals(db, v, prevP),
    cashFlowSeries(db, v, key, v.household.monthStartDay, 6),
    netWorth(db, v),
    budgetView(db, v, "household", key, v.household.monthStartDay),
    listGoals(db, v),
    loadCategories(v.householdId),
    db.recurringSeries.findMany({
      where: { dismissedAt: null, nextExpected: { gte: new Date(todayIso() + "T00:00:00Z"), lte: new Date(Date.now() + 14 * 86_400_000) }, transactions: { some: aggregateTransactionWhere(v) } },
      include: { merchant: { select: { name: true } } },
      orderBy: { nextExpected: "asc" },
      take: 5,
    }),
  ]);
  const cats = new Map(categories.flatMap((g) => g.categories).map((c) => [c.id, c]));
  const elapsed = elapsedFraction(p);
  const categoryRows = topN(now.byCategory, 7, (x) => x)
    .filter(([, v]) => v > 0)
    .map(([id, val]) => ({ label: id ? cats.get(id)?.name ?? "Other" : "Uncategorised", emoji: id ? cats.get(id)?.emoji : "❔", now: val, prev: prev.byCategory.get(id) ?? 0 }));
  const groceriesId = categories.flatMap((g) => g.categories).find((c) => c.key === "groceries")?.id;
  const focus = budget.lines.find((l) => l.categoryId === groceriesId) ?? budget.lines.sort((a, b) => b.usedRatio - a.usedRatio)[0];
  const health = budgetHealth(budget.lines);
  const people = [{ id: v.userId, name: v.user.name, colour: v.user.colour }, ...(v.partner ? [v.partner] : [])];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{greeting}, {v.user.name}</h1>
          <p className="mt-1 text-sm text-muted">{p.label} · {Math.round(elapsed * 100)}% through the month</p>
          {now.income === 0 && now.spend === 0 && (prev.spend > 0 || prev.income > 0) && (
            <p className="mt-2 text-sm">
              Nothing imported for {p.label.split(" ")[0]} yet. <Link href="/review" className="text-accent">See how {prevP.label.split(" ")[0]} went</Link> or <Link href="/import" className="text-accent">import new statements</Link>.
            </p>
          )}
        </div>
        <Link href="/review" className={buttonClass("secondary", "sm")}>Monthly review</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Spent" value={<Money minor={-now.spend} colour={false} whole />} sub={prev.spend ? `${formatMoney(prev.spend, { whole: true })} last month` : undefined} />
        <Kpi label="Income" value={<Money minor={now.income} whole />} />
        <Kpi label="Left over" value={<Money minor={now.net} colour={false} whole className={now.net < 0 ? "text-neg" : ""} />} sub="income − spending" />
        <Kpi label="Net worth" value={<Money minor={nw.total} colour={false} whole />} sub={nw.unknownCount ? `${nw.unknownCount} account${nw.unknownCount > 1 ? "s" : ""} without balance` : "across visible accounts"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          {focus ? (
            <div className="p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">{cats.get(focus.categoryId)?.emoji} {cats.get(focus.categoryId)?.name} left this month</span>
                <Badge tone={focus.state === "over" ? "neg" : focus.aheadOfPace ? "warn" : "pos"}>{focus.state === "over" ? "Over" : focus.aheadOfPace ? "Ahead of pace" : "On track"}</Badge>
              </div>
              <div className={cx("mt-2 text-3xl font-semibold tabular", focus.remaining < 0 && "text-neg")}>{formatMoney(focus.remaining)}</div>
              <Progress className="mt-3" value={focus.usedRatio} tone={focus.state === "over" ? "neg" : focus.state === "warning" ? "warn" : "accent"} marker={elapsed} />
              <div className="mt-1.5 text-xs text-muted">{formatMoney(focus.spent)} of {formatMoney(focus.available)}</div>
              <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                <Ring value={health} tone={health === 1 ? "var(--pos)" : health > 0.7 ? "var(--warn)" : "var(--neg)"} size={44} />
                <div className="text-sm">
                  <div className="font-medium">Budget health</div>
                  <div className="text-muted">{budget.lines.length - budget.summary.overCount} of {budget.lines.length} categories within budget</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5">
              <h2 className="font-semibold">Set a budget</h2>
              <p className="mt-1 text-sm text-muted">See at a glance how much is left for groceries, eating out and the rest.</p>
              <Link href="/budgets" className={cx(buttonClass("primary", "sm"), "mt-4")}>Create budget</Link>
            </div>
          )}
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Cash flow" subtitle={<span className="flex gap-3"><span className="flex items-center gap-1"><i className="inline-block size-2 rounded-full bg-pos" /> In</span><span className="flex items-center gap-1"><i className="inline-block size-2 rounded-full bg-accent" /> Out</span></span>} />
          <div className="px-2 pb-2 sm:px-3"><CashFlowChart data={flow} /></div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Spending by category" subtitle="This month vs last (grey)" action={<Link href="/transactions" className="text-xs text-accent">All</Link>} />
          <div className="p-4 sm:p-5">{categoryRows.length ? <CompareBars rows={categoryRows} /> : <p className="text-sm text-muted">Nothing spent yet this month.</p>}</div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Top merchants" />
            <ul className="divide-y divide-border px-4 pb-2 sm:px-5">
              {topN(now.byMerchant, 5, (m) => m.spend).map(([key, m]) => (
                <li key={key} className="flex items-center justify-between py-2.5 text-sm">
                  <Link href={`/transactions?q=${encodeURIComponent(m.name)}&from=${p.start}`} className="truncate hover:text-accent">{m.name}</Link>
                  <span className="tabular whitespace-nowrap text-muted">{m.count}× · <span className="text-text">{formatMoney(m.spend, { whole: true })}</span></span>
                </li>
              ))}
            </ul>
          </Card>
          {v.partner && now.byOwner.size > 0 && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-semibold">Who spent what</h2>
              <div className="space-y-2">
                {[...people.map((x) => ({ key: x.id, label: x.name, node: <Avatar name={x.name} colour={x.colour} size={18} /> })), { key: null as string | null, label: "Joint", node: <span className="text-xs">🤝</span> }].map((x) => {
                  const val = now.byOwner.get(x.key) ?? 0;
                  return (
                    <div key={x.key ?? "joint"} className="flex items-center gap-2 text-sm">
                      {x.node}
                      <span className="w-14">{x.label}</span>
                      <Progress className="flex-1" value={now.spend ? val / now.spend : 0} />
                      <span className="tabular w-16 text-right">{formatMoney(val, { whole: true })}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Goals" action={<Link href="/goals" className="text-xs text-accent">All</Link>} />
          <div className="space-y-4 p-4 sm:p-5">
            {goals.length === 0 && <p className="text-sm text-muted">No goals yet. <Link href="/goals" className="text-accent">Start one together</Link> — a holiday, an emergency fund, a house deposit.</p>}
            {goals.slice(0, 4).map((g) => (
              <div key={g.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{g.emoji ?? "🎯"} {g.name}</span>
                  <span className="tabular text-muted">{formatMoney(g.saved, { whole: true })} / {formatMoney(g.targetAmount, { whole: true })}</span>
                </div>
                <Progress value={g.plan.progress} tone={g.plan.progress >= 1 ? "pos" : "accent"} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Coming up" subtitle="Recurring payments due in the next two weeks" />
          <ul className="divide-y divide-border px-4 pb-2 sm:px-5">
            {upcoming.length === 0 && <li className="py-3 text-sm text-muted">Nothing detected yet — recurring bills appear after a couple of months of statements.</li>}
            {upcoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>{r.merchant?.name ?? "Payment"} <span className="text-xs text-muted">· {r.nextExpected!.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></span>
                <span className="tabular">{r.amountVariance > 0.1 ? "~" : ""}<Money minor={r.typicalAmount} /></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted">{sub}</div>}
    </Card>
  );
}
