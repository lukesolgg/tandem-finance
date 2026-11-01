"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, Plus, Target, Trash2, Users } from "lucide-react";
import { Avatar, Badge, Button, Card, EmptyState, ErrorText, Field, Input, Progress, Select, formatMoney } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { contributeAction, createGoalAction, deleteGoalAction } from "../actions";

type Person = { id: string; name: string; colour: string };
type Goal = {
  id: string; name: string; emoji: string | null; target: number; saved: number; targetDate: string | null; shared: boolean; mine: boolean; isPrivate: boolean; achieved: boolean;
  linkedAccountName: string | null; byPerson: Record<string, number>;
  plan: { remaining: number; progress: number; monthsLeft: number | null; monthlyNeeded: number | null; projectedDate: string | null; onTrack: boolean | null };
  recent: { id: string; amount: number; date: string; who: string }[];
};

const EMOJIS = ["🏖️", "🏠", "🛟", "💍", "🚗", "🎄", "👶", "🎓", "✈️", "🎯"];

export function GoalsClient({ goals, accounts, me, partner }: { goals: Goal[]; accounts: { id: string; name: string }[]; me: Person; partner: Person | null }) {
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Goal | null>(null);
  const router = useRouter();
  const [, start] = useTransition();
  const person = (id: string) => (id === me.id ? me : partner);
  return (
    <div className="space-y-4">
      <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New goal</Button>
      {goals.length === 0 && (
        <Card><EmptyState icon={<Target />} title="No goals yet" body="An emergency fund, a holiday, a house deposit. Track it together and see how much you each need to put away each month." /></Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {goals.map((g) => (
          <Card key={g.id} className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-xl">{g.emoji ?? "🎯"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className="truncate">{g.name}</span>
                  {g.shared ? <Users size={13} className="text-muted" /> : g.isPrivate ? <Lock size={13} className="text-warn" /> : null}
                </div>
                <div className="text-xs text-muted">
                  {g.targetDate ? `by ${new Date(g.targetDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : "no deadline"}
                  {g.linkedAccountName && ` · tracks ${g.linkedAccountName}`}
                </div>
              </div>
              {g.achieved ? <Badge tone="pos">Done 🎉</Badge> : g.plan.onTrack === true ? <Badge tone="pos">On track</Badge> : g.plan.onTrack === false ? <Badge tone="warn">Behind</Badge> : null}
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular">{formatMoney(g.saved, { whole: true })}</span>
              <span className="text-sm text-muted tabular">of {formatMoney(g.target, { whole: true })}</span>
            </div>
            <Progress className="mt-2" value={g.plan.progress} tone={g.plan.progress >= 1 ? "pos" : "accent"} />
            {g.plan.monthlyNeeded !== null && g.plan.remaining > 0 && (
              <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                Save <span className="font-semibold">{formatMoney(g.plan.monthlyNeeded, { whole: true })}/month</span>
                {g.shared && partner && <> — {formatMoney(Math.ceil(g.plan.monthlyNeeded / 2), { whole: true })} each</>}
                {" "}for {g.plan.monthsLeft} month{g.plan.monthsLeft === 1 ? "" : "s"}.
              </p>
            )}
            {Object.keys(g.byPerson).length > 0 && g.shared && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                {Object.entries(g.byPerson).map(([pid, amt]) => {
                  const p = person(pid);
                  return p ? <span key={pid} className="flex items-center gap-1.5"><Avatar name={p.name} colour={p.colour} size={16} /> {formatMoney(amt, { whole: true })}</span> : null;
                })}
              </div>
            )}
            {(g.shared || g.mine) && (
              <div className="mt-4 flex gap-2">
                {!g.linkedAccountName && <Button size="sm" onClick={() => setPaying(g)}>Add money</Button>}
                <Button size="sm" variant="ghost" onClick={() => confirm(`Delete "${g.name}"?`) && start(async () => { await deleteGoalAction(g.id); router.refresh(); })} aria-label="Delete goal"><Trash2 size={14} /></Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Sheet open={creating} onClose={() => setCreating(false)} title="New goal">
        <GoalForm accounts={accounts} hasPartner={Boolean(partner)} onDone={() => { setCreating(false); router.refresh(); }} />
      </Sheet>
      <Sheet open={!!paying} onClose={() => setPaying(null)} title={`Add to ${paying?.name ?? ""}`}>
        {paying && <ContributeForm goal={paying} onDone={() => { setPaying(null); router.refresh(); }} />}
      </Sheet>
    </div>
  );
}

function GoalForm({ accounts, hasPartner, onDone }: { accounts: { id: string; name: string }[]; hasPartner: boolean; onDone: () => void }) {
  const [f, setF] = useState({ name: "", emoji: "🏖️", target: "", targetDate: "", shared: hasPartner, isPrivate: false, linkedAccountId: "" });
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await createGoalAction(f); if (!r.ok) setErr(r.error); else onDone(); }); }}>
      <div className="flex flex-wrap gap-1.5">
        {EMOJIS.map((e) => (
          <button type="button" key={e} onClick={() => setF({ ...f, emoji: e })} className={`grid size-10 place-items-center rounded-xl text-lg ${f.emoji === e ? "bg-accent-soft ring-2 ring-accent" : "bg-surface-2"}`}>{e}</button>
        ))}
      </div>
      <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Emergency fund" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target (£)"><Input required inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
        <Field label="By (optional)"><Input type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></Field>
      </div>
      {hasPartner && (
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((s) => (
            <button type="button" key={String(s)} onClick={() => setF({ ...f, shared: s })} className={`h-10 rounded-lg border text-sm ${f.shared === s ? "border-accent bg-accent-soft font-medium text-accent" : "border-border"}`}>
              {s ? "Shared" : "Just me"}
            </button>
          ))}
        </div>
      )}
      {!f.shared && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPrivate} onChange={(e) => setF({ ...f, isPrivate: e.target.checked })} /> Keep this goal private</label>}
      {accounts.length > 0 && (
        <Field label="Track a savings account (optional)" hint="Progress follows the account balance instead of manual contributions.">
          <Select value={f.linkedAccountId} onChange={(e) => setF({ ...f, linkedAccountId: e.target.value })}>
            <option value="">Add money manually</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
      )}
      <ErrorText>{err}</ErrorText>
      <Button variant="primary" className="w-full" disabled={pending}>Create goal</Button>
    </form>
  );
}

function ContributeForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [amount, setAmount] = useState(goal.plan.monthlyNeeded ? (goal.plan.monthlyNeeded / 100).toFixed(2) : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await contributeAction(goal.id, amount, date); if (!r.ok) setErr(r.error); else onDone(); }); }}>
      <Field label="Amount (£)"><Input autoFocus required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {goal.recent.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {goal.recent.map((c) => <li key={c.id}>{c.who} added {formatMoney(c.amount)} on {new Date(c.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</li>)}
        </ul>
      )}
      <ErrorText>{err}</ErrorText>
      <Button variant="primary" className="w-full" disabled={pending}>Add</Button>
    </form>
  );
}
