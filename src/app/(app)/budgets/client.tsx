"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, Trash2, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Money, Progress, Select, cx, formatMoney } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import type { CategoryGroups } from "../data";
import { recalcCarryAction, removeBudgetLineAction, setBudgetLineAction, setBudgetStyleAction } from "../actions";

type Line = { lineId: string; categoryId: string; allocated: number; carriedIn: number; spent: number; available: number; remaining: number; usedRatio: number; state: "ok" | "warning" | "over"; aheadOfPace: boolean; rollover: "none" | "positive" | "both" };
type View = {
  elapsed: number;
  budget: { id: string; style: string; plannedIncome: number | null } | null;
  lines: Line[];
  unbudgeted: { categoryId: string | null; spent: number }[];
  summary: { allocated: number; available: number; spent: number; remaining: number; overCount: number; toAssign?: number };
  income: number;
};

const ROLLOVER = { none: "Resets each month", positive: "Unspent carries over", both: "Carries over (incl. overspend)" };

export function BudgetClient({ scope, periodKey, view, categories, hint }: { scope: string; periodKey: string; view: View; categories: CategoryGroups; hint: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ categoryId: string; amount: string; rollover: Line["rollover"] } | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [pending, start] = useTransition();
  const cats = new Map(categories.flatMap((g) => g.categories).map((c) => [c.id, c]));
  const { summary } = view;
  const zero = view.budget?.style === "zero_based";

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">{hint}</p>
      {view.lines.length > 0 && (
        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
          <Stat label="Budgeted" value={formatMoney(summary.available, { whole: true })} />
          <Stat label="Spent" value={formatMoney(summary.spent, { whole: true })} />
          <Stat label="Left" value={formatMoney(summary.remaining, { whole: true })} tone={summary.remaining < 0 ? "neg" : undefined} />
          {zero ? (
            <Stat label="To assign" value={formatMoney(summary.toAssign ?? 0, { whole: true })} tone={(summary.toAssign ?? 0) < 0 ? "neg" : (summary.toAssign ?? 0) > 0 ? "warn" : "pos"} />
          ) : (
            <Stat label="Over budget" value={String(summary.overCount)} tone={summary.overCount ? "neg" : "pos"} />
          )}
          <div className="col-span-full">
            <Progress value={summary.available ? summary.spent / summary.available : 0} marker={view.elapsed} tone={summary.remaining < 0 ? "neg" : "accent"} />
          </div>
        </Card>
      )}

      {view.lines.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet />}
            title="No budget for this month yet"
            body="Pick the categories you want to keep an eye on. Next month starts from these automatically."
            action={<Button variant="primary" onClick={() => setEditing({ categoryId: "", amount: "", rollover: "none" })}>Add a category</Button>}
          />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {view.lines
            .sort((a, b) => b.usedRatio - a.usedRatio)
            .map((l) => {
              const c = cats.get(l.categoryId);
              return (
                <button key={l.lineId} className="block w-full px-4 py-3.5 text-left hover:bg-surface-2/50 sm:px-5" onClick={() => setEditing({ categoryId: l.categoryId, amount: (l.allocated / 100).toFixed(2), rollover: l.rollover })}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {c?.emoji} {c?.name ?? "Category"}
                      {l.state === "over" ? <Badge tone="neg">Over by {formatMoney(-l.remaining, { whole: true })}</Badge> : l.aheadOfPace ? <Badge tone="warn">Spending fast</Badge> : null}
                    </span>
                    <span className={cx("tabular text-sm", l.remaining < 0 ? "text-neg" : "")}>
                      {formatMoney(l.remaining, { whole: true })} <span className="text-xs text-muted">left</span>
                    </span>
                  </div>
                  <Progress className="mt-2" value={l.usedRatio} marker={view.elapsed} tone={l.state === "over" ? "neg" : l.state === "warning" ? "warn" : "accent"} />
                  <div className="mt-1 flex justify-between text-[11px] text-muted">
                    <span>{formatMoney(l.spent, { whole: true })} of {formatMoney(l.available, { whole: true })}</span>
                    {l.carriedIn !== 0 && <span>{l.carriedIn > 0 ? "+" : ""}{formatMoney(l.carriedIn, { whole: true })} carried in</span>}
                  </div>
                </button>
              );
            })}
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {view.lines.length > 0 && <Button onClick={() => setEditing({ categoryId: "", amount: "", rollover: "none" })}>Add category</Button>}
        <Button variant="ghost" onClick={() => setStyleOpen(true)}>{zero ? "Zero-based" : "Simple targets"} · change</Button>
        {view.lines.some((l) => l.rollover !== "none") && (
          <Button variant="ghost" disabled={pending} onClick={() => start(async () => { await recalcCarryAction({ scope, period: periodKey }); router.refresh(); })}>
            <RefreshCw size={14} /> Recalculate carry-over
          </Button>
        )}
      </div>

      {view.unbudgeted.length > 0 && (
        <Card>
          <div className="px-4 pt-4 text-sm font-semibold sm:px-5">Spending without a budget</div>
          <ul className="divide-y divide-border px-4 pb-2 sm:px-5">
            {view.unbudgeted.sort((a, b) => b.spent - a.spent).slice(0, 10).map((u) => {
              const c = u.categoryId ? cats.get(u.categoryId) : null;
              return (
                <li key={u.categoryId ?? "none"} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{c ? `${c.emoji ?? ""} ${c.name}` : "Uncategorised"}</span>
                  <span className="flex items-center gap-3">
                    <Money minor={u.spent} colour={false} whole />
                    {c && <button className="text-xs text-accent" onClick={() => setEditing({ categoryId: c.id, amount: (Math.ceil(u.spent / 1000) * 10).toFixed(2), rollover: "none" })}>Budget</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.categoryId && view.lines.some((l) => l.categoryId === editing.categoryId) ? "Edit budget" : "Add to budget"}>
        {editing && (
          <LineForm
            initial={editing}
            categories={categories}
            existingLine={view.lines.find((l) => l.categoryId === editing.categoryId)}
            onSave={(f) => setBudgetLineAction({ scope, period: periodKey, ...f })}
            onDone={() => { setEditing(null); router.refresh(); }}
          />
        )}
      </Sheet>
      <Sheet open={styleOpen} onClose={() => setStyleOpen(false)} title="Budget style">
        <StyleForm
          current={view.budget}
          income={view.income}
          onSave={(style, plannedIncome) => setBudgetStyleAction({ scope, period: periodKey, style, plannedIncome })}
          onDone={() => { setStyleOpen(false); router.refresh(); }}
        />
      </Sheet>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "neg" | "pos" | "warn" }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("tabular text-lg font-semibold", tone === "neg" && "text-neg", tone === "pos" && "text-pos", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}

function LineForm({ initial, categories, existingLine, onSave, onDone }: {
  initial: { categoryId: string; amount: string; rollover: Line["rollover"] };
  categories: CategoryGroups;
  existingLine?: Line;
  onSave: (f: { categoryId: string; amount: string; rollover: string }) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => void;
}) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await onSave(f); if (!r.ok) setErr(r.error); else onDone(); }); }}>
      <Field label="Category">
        <Select required value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} disabled={Boolean(existingLine)}>
          <option value="">Choose…</option>
          {categories.map((g) => <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>)}
        </Select>
      </Field>
      <Field label="Monthly amount (£)"><Input required autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="At month end">
        <Select value={f.rollover} onChange={(e) => setF({ ...f, rollover: e.target.value as Line["rollover"] })}>
          {Object.entries(ROLLOVER).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
      </Field>
      <ErrorText>{err}</ErrorText>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={pending}>Save</Button>
        {existingLine && (
          <Button type="button" variant="danger" disabled={pending} onClick={() => start(async () => { await removeBudgetLineAction(existingLine.lineId); onDone(); })} aria-label="Remove">
            <Trash2 size={15} />
          </Button>
        )}
      </div>
    </form>
  );
}

function StyleForm({ current, income, onSave, onDone }: { current: View["budget"]; income: number; onSave: (s: string, i?: string) => Promise<{ ok: boolean; error?: string }>; onDone: () => void }) {
  const [style, setStyle] = useState(current?.style ?? "targets");
  const [planned, setPlanned] = useState(current?.plannedIncome ? (current.plannedIncome / 100).toFixed(2) : income ? (income / 100).toFixed(2) : "");
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { await onSave(style, style === "zero_based" ? planned : undefined); onDone(); }); }}>
      {[
        { id: "targets", title: "Simple targets", body: "Set limits for the categories you care about. Everything else is just tracked." },
        { id: "zero_based", title: "Zero-based", body: "Give every pound of income a job. Shows what's still to assign." },
      ].map((o) => (
        <button type="button" key={o.id} onClick={() => setStyle(o.id)} className={`block w-full rounded-xl border p-3 text-left ${style === o.id ? "border-accent bg-accent-soft" : "border-border"}`}>
          <div className="text-sm font-medium">{o.title}</div>
          <div className="text-xs text-muted">{o.body}</div>
        </button>
      ))}
      {style === "zero_based" && <Field label="Income to assign this month (£)"><Input inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} /></Field>}
      <Button variant="primary" className="w-full" disabled={pending}>Save</Button>
    </form>
  );
}
