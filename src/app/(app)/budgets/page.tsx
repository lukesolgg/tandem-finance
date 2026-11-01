import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { budgetView } from "@/domain/budgets/service";
import { shiftPeriod } from "@/domain/periods";
import { PageHeader, cx } from "@/components/ui";
import { loadCategories, validPeriodKey } from "../data";
import { BudgetClient } from "./client";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ period?: string; scope?: string }> }) {
  const v = await requireViewerContext();
  const sp = await searchParams;
  const key = validPeriodKey(sp.period, v.household.monthStartDay);
  const scope = sp.scope === "personal" ? "personal" : "household";
  const [view, categories] = await Promise.all([budgetView(db, v, scope, key, v.household.monthStartDay), loadCategories(v.householdId)]);
  const link = (patch: Record<string, string>) => `/budgets?${new URLSearchParams({ period: key, scope, ...patch })}`;
  return (
    <>
      <PageHeader
        title="Budgets"
        subtitle={`${view.period.label} · ${new Date(view.period.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(view.period.end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
        actions={
          <div className="flex items-center gap-1">
            <Link href={link({ period: shiftPeriod(key, -1) })} className="grid size-9 place-items-center rounded-lg border border-border bg-surface" aria-label="Previous month"><ChevronLeft size={16} /></Link>
            <Link href={link({ period: shiftPeriod(key, 1) })} className="grid size-9 place-items-center rounded-lg border border-border bg-surface" aria-label="Next month"><ChevronRight size={16} /></Link>
          </div>
        }
      />
      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface p-1 text-sm">
        {(["household", "personal"] as const).map((s) => (
          <Link key={s} href={link({ scope: s })} className={cx("rounded-lg px-3.5 py-1.5", scope === s ? "bg-accent-soft font-medium text-accent" : "text-muted")}>
            {s === "household" ? "Household" : "Just me"}
          </Link>
        ))}
      </div>
      <BudgetClient
        scope={scope}
        periodKey={key}
        view={{ ...view, lines: view.lines.map((l) => ({ ...l, usedRatio: Number.isFinite(l.usedRatio) ? l.usedRatio : 9 })) }}
        categories={categories.filter((g) => g.kind === "expense")}
        hint={scope === "household" ? `Counts spending from shared and joint accounts${v.partner ? ` for you and ${v.partner.name}` : ""}. Hidden transactions never show up in the other person's totals.` : "Counts only your own accounts. Only you can see this budget."}
      />
    </>
  );
}
