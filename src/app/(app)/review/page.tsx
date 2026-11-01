import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { periodTotals } from "@/domain/insights/service";
import { budgetView } from "@/domain/budgets/service";
import { topN } from "@/domain/insights/aggregate";
import { periodForKey, shiftPeriod } from "@/domain/periods";
import { aggregateTransactionWhere, transactionWhere } from "@/domain/access/visibility";
import { Card, CardHeader, Money, PageHeader, buttonClass, cx, formatMoney } from "@/components/ui";
import { CompareBars } from "@/components/charts";
import { currentPeriodKey, loadCategories } from "../data";
import { PrintButton } from "./print-button";

export const metadata = { title: "Monthly review" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const v = await requireViewerContext();
  const sd = v.household.monthStartDay;
  const sp = await searchParams;
  // Default: the last COMPLETE period — that's what a review is for.
  const key = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : shiftPeriod(currentPeriodKey(sd), -1);
  const p = periodForKey(key, sd);
  const prevP = periodForKey(shiftPeriod(key, -1), sd);
  const toDate = (s: string) => new Date(s + "T00:00:00Z");
  const [now, prev, budget, categories, biggest, uncategorised, contributions] = await Promise.all([
    periodTotals(db, v, p),
    periodTotals(db, v, prevP),
    budgetView(db, v, "household", key, sd),
    loadCategories(v.householdId),
    db.transaction.findMany({
      where: { AND: [transactionWhere(v), { date: { gte: toDate(p.start), lte: toDate(p.end) }, amount: { lt: 0 }, transferGroupId: null, parentId: null }] },
      orderBy: { amount: "asc" },
      take: 5,
      include: { account: { select: { name: true } }, category: { select: { emoji: true } } },
    }),
    db.transaction.count({ where: { AND: [aggregateTransactionWhere(v), { date: { gte: toDate(p.start), lte: toDate(p.end) }, categoryId: null, splits: { none: {} }, parentId: null }] } }),
    db.goalContribution.aggregate({ where: { date: { gte: toDate(p.start), lte: toDate(p.end) }, goal: { householdId: v.householdId, OR: [{ ownerId: null }, { ownerId: v.userId }, { isPrivate: false }] } }, _sum: { amount: true } }),
  ]);
  const cats = new Map(categories.flatMap((g) => g.categories).map((c) => [c.id, c]));
  const savingsRate = now.income > 0 ? now.net / now.income : null;
  const spendDelta = prev.spend ? (now.spend - prev.spend) / prev.spend : null;
  const over = budget.lines.filter((l) => l.state === "over");
  const under = budget.lines.filter((l) => l.state !== "over");

  return (
    <>
      <PageHeader
        title={`${p.label} in review`}
        subtitle={`${new Date(p.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(p.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
        actions={
          <div className="no-print flex items-center gap-1">
            <Link href={`/review?period=${shiftPeriod(key, -1)}`} className="grid size-9 place-items-center rounded-lg border border-border bg-surface" aria-label="Previous"><ChevronLeft size={16} /></Link>
            <Link href={`/review?period=${shiftPeriod(key, 1)}`} className="grid size-9 place-items-center rounded-lg border border-border bg-surface" aria-label="Next"><ChevronRight size={16} /></Link>
            <a href={`/api/export?from=${p.start}&to=${p.end}`} className={buttonClass("secondary", "sm")}><Download size={14} /> CSV</a>
            <PrintButton />
          </div>
        }
      />

      <Card className="p-5 sm:p-6">
        <p className="text-lg leading-relaxed">
          {v.partner ? "Together you" : "You"} brought in <Money minor={now.income} className="font-semibold" whole /> and spent{" "}
          <span className="font-semibold tabular">{formatMoney(now.spend, { whole: true })}</span>
          {spendDelta !== null && Math.abs(spendDelta) >= 0.02 && (
            <> — <span className={spendDelta > 0 ? "text-warn" : "text-pos"}>{Math.abs(Math.round(spendDelta * 100))}% {spendDelta > 0 ? "more" : "less"}</span> than {prevP.label.split(" ")[0]}</>
          )}
          . {now.net >= 0 ? <>That leaves <span className="font-semibold text-pos tabular">{formatMoney(now.net, { whole: true })}</span>{savingsRate !== null && <> ({Math.round(savingsRate * 100)}% of income)</>}.</> : <>That&apos;s <span className="font-semibold text-neg tabular">{formatMoney(-now.net, { whole: true })}</span> more out than in.</>}
          {(contributions._sum.amount ?? 0) > 0 && <> You put <span className="font-semibold tabular">{formatMoney(contributions._sum.amount!, { whole: true })}</span> towards goals.</>}
        </p>
        {uncategorised > 0 && (
          <p className="no-print mt-3 text-sm text-muted">
            {uncategorised} transaction{uncategorised > 1 ? "s are" : " is"} uncategorised —{" "}
            <Link className="text-accent" href={`/transactions?category=none&from=${p.start}&to=${p.end}`}>sort them</Link> for a sharper picture.
          </p>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where it went" subtitle={`vs ${prevP.label.split(" ")[0]} (grey)`} />
          <div className="p-4 sm:p-5">
            <CompareBars
              rows={topN(now.byCategory, 10, (x) => x)
                .filter(([, x]) => x > 0)
                .map(([id, x]) => ({ label: id ? cats.get(id)?.name ?? "Other" : "Uncategorised", emoji: id ? cats.get(id)?.emoji : "❔", now: x, prev: prev.byCategory.get(id) ?? 0 }))}
            />
          </div>
        </Card>
        <div className="space-y-4">
          {budget.lines.length > 0 && (
            <Card>
              <CardHeader title="Budgets" subtitle={`${under.length} of ${budget.lines.length} on target`} />
              <ul className="divide-y divide-border px-4 pb-2 sm:px-5">
                {[...over, ...under].map((l) => (
                  <li key={l.categoryId} className="flex justify-between py-2 text-sm">
                    <span>{cats.get(l.categoryId)?.emoji} {cats.get(l.categoryId)?.name}</span>
                    <span className={cx("tabular", l.remaining < 0 ? "text-neg" : "text-pos")}>{l.remaining < 0 ? `${formatMoney(-l.remaining, { whole: true })} over` : `${formatMoney(l.remaining, { whole: true })} under`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Biggest purchases" />
            <ul className="divide-y divide-border px-4 pb-2 sm:px-5">
              {biggest.map((t) => (
                <li key={t.id} className="flex justify-between gap-2 py-2 text-sm">
                  <span className="truncate">{t.category?.emoji} {t.description} <span className="text-xs text-muted">· {t.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></span>
                  <Money minor={t.amount} />
                </li>
              ))}
              {biggest.length === 0 && <li className="py-3 text-sm text-muted">No transactions in this period.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Top merchants" />
            <ul className="divide-y divide-border px-4 pb-2 sm:px-5">
              {topN(now.byMerchant, 5, (m) => m.spend).map(([k, m]) => (
                <li key={k} className="flex justify-between py-2 text-sm"><span>{m.name}</span><span className="tabular text-muted">{m.count}× · <span className="text-text">{formatMoney(m.spend, { whole: true })}</span></span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
