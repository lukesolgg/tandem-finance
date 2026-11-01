"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckSquare, EyeOff, Filter, Lock, Plus, Repeat, Search, SplitSquareHorizontal, Square, Trash2, X, ArrowLeftRight } from "lucide-react";
import { Avatar, Badge, Button, Card, EmptyState, ErrorText, Field, Input, Money, Select, cx, formatMoney } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import type { CategoryGroups } from "../data";
import {
  addTxnAction, bulkCategoryAction, createRuleAction, deleteNoteAction, deleteTxnAction, noteAction, reactAction, setCategoryAction, setPrivateAction, splitAction, updateTxnAction,
} from "../actions";

export type TxnView = {
  id: string; date: string; amount: number; description: string; rawDescription: string; source: string;
  isPrivate: boolean; canUnhide: boolean; canManage: boolean; isRecurring: boolean; isTransfer: boolean;
  categorySource: string | null; categoryConfidence: number | null;
  account: { id: string; name: string; ownerId: string | null };
  category: { id: string; name: string; emoji: string | null } | null;
  merchant: { key: string; name: string } | null;
  splits: { id: string; amount: number; description: string; category: { id: string; name: string; emoji: string | null } | null }[];
  notes: { id: string; body: string; isPrivate: boolean; mine: boolean; author: string }[];
  reactions: { emoji: string; userId: string }[];
};
type Person = { id: string; name: string; colour: string };
type Acct = { id: string; name: string; ownerId: string | null; canManage: boolean };

const REACTIONS = ["👍", "❤️", "😬", "🤔", "🎉"];

export function TransactionsClient(props: {
  txns: TxnView[]; hasMore: boolean; take: number; categories: CategoryGroups; accounts: Acct[]; me: Person; partner: Person | null; initialFilters: Record<string, string | undefined>;
}) {
  const { txns, categories, accounts, me, partner } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(props.initialFilters.q ?? "");
  const [showFilters, setShowFilters] = useState(Boolean(props.initialFilters.account || props.initialFilters.category || props.initialFilters.person || props.initialFilters.from));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(params.get("new") === "1");
  const [optimistic, setOptimistic] = useState<Record<string, TxnView["category"]>>({});
  const [, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const catById = useMemo(() => new Map(categories.flatMap((g) => g.categories).map((c) => [c.id, c])), [categories]);

  useEffect(() => {
    if (params.get("focus") === "1") searchRef.current?.focus();
  }, [params]);
  useEffect(() => setOptimistic({}), [txns]);

  const setParam = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, val] of Object.entries(patch)) (val ? sp.set(k, val) : sp.delete(k));
    sp.delete("new");
    sp.delete("focus");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };
  // Debounced search
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => setParam({ q: q || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const byDay = useMemo(() => {
    const m = new Map<string, TxnView[]>();
    for (const t of txns) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m.entries()];
  }, [txns]);
  const open = txns.find((t) => t.id === openId) ?? null;
  const owner = (a: { ownerId: string | null }) => (a.ownerId === null ? null : a.ownerId === me.id ? me : partner);
  const activeFilters = ["account", "category", "person", "from", "to", "dir", "min", "max"].filter((k) => params.get(k)).length;

  const changeCategory = (t: TxnView, categoryId: string | null) => {
    const c = categoryId ? catById.get(categoryId) : null;
    setOptimistic((o) => ({ ...o, [t.id]: c ? { id: c.id, name: c.name, emoji: c.emoji } : null }));
    start(async () => {
      const r = await setCategoryAction(t.id, categoryId);
      if (r.ok && (r.data as { suggestRule?: boolean })?.suggestRule && t.merchant && categoryId && c) {
        if (confirm(`Always categorise ${t.merchant.name} as ${c.name}? This also updates past ${t.merchant.name} transactions.`)) {
          await createRuleAction({ merchantKey: t.merchant.key, categoryId, applyToExisting: true });
        }
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input ref={searchRef} data-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchants, notes…" className="pl-9" />
        </div>
        <Button onClick={() => setShowFilters((s) => !s)} className={cx(activeFilters && "border-accent text-accent")}>
          <Filter size={15} /> Filters{activeFilters ? ` · ${activeFilters}` : ""}
        </Button>
        <Button onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }}>
          <CheckSquare size={15} /> <span className="hidden sm:inline">Select</span>
        </Button>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> <span className="hidden sm:inline">Add</span>
        </Button>
      </div>

      {showFilters && (
        <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Field label="Account">
            <Select value={params.get("account") ?? ""} onChange={(e) => setParam({ account: e.target.value || undefined })}>
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={params.get("category") ?? ""} onChange={(e) => setParam({ category: e.target.value || undefined })}>
              <option value="">All categories</option>
              <option value="none">Uncategorised</option>
              {categories.map((g) => (
                <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Whose">
            <Select value={params.get("person") ?? ""} onChange={(e) => setParam({ person: e.target.value || undefined })}>
              <option value="">Everyone</option>
              <option value="me">{me.name}</option>
              {partner && <option value="partner">{partner.name}</option>}
              <option value="joint">Joint</option>
            </Select>
          </Field>
          <Field label="Direction">
            <Select value={params.get("dir") ?? ""} onChange={(e) => setParam({ dir: e.target.value || undefined })}>
              <option value="">In & out</option>
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={params.get("from") ?? ""} onChange={(e) => setParam({ from: e.target.value || undefined })} /></Field>
          <Field label="To"><Input type="date" value={params.get("to") ?? ""} onChange={(e) => setParam({ to: e.target.value || undefined })} /></Field>
          <Field label="Min £"><Input inputMode="decimal" defaultValue={params.get("min") ?? ""} onBlur={(e) => setParam({ min: e.target.value || undefined })} /></Field>
          <Field label="Max £"><Input inputMode="decimal" defaultValue={params.get("max") ?? ""} onBlur={(e) => setParam({ max: e.target.value || undefined })} /></Field>
          {activeFilters > 0 && (
            <button className="col-span-full text-left text-sm text-accent" onClick={() => setParam({ account: undefined, category: undefined, person: undefined, from: undefined, to: undefined, dir: undefined, min: undefined, max: undefined })}>
              Clear filters
            </button>
          )}
        </Card>
      )}

      {selecting && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-surface p-2 shadow-lg">
          <span className="px-2 text-sm font-medium">{selected.size} selected</span>
          <button className="text-sm text-accent" onClick={() => setSelected(new Set(txns.map((t) => t.id)))}>All</button>
          <Select
            className="h-9 w-auto flex-1"
            value=""
            disabled={!selected.size}
            onChange={(e) => {
              const cat = e.target.value;
              if (!cat) return;
              start(async () => {
                await bulkCategoryAction([...selected], cat);
                setSelected(new Set());
                setSelecting(false);
                router.refresh();
              });
            }}
          >
            <option value="">Set category…</option>
            {categories.map((g) => <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>)}
          </Select>
          <button onClick={() => { setSelecting(false); setSelected(new Set()); }} aria-label="Cancel selection" className="grid size-9 place-items-center rounded-lg hover:bg-surface-2"><X size={16} /></button>
        </div>
      )}

      {txns.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ArrowLeftRight />}
            title={q || activeFilters ? "Nothing matches" : "No transactions yet"}
            body={q || activeFilters ? "Try a different search or clear the filters." : "Import a statement to get started — it takes about a minute."}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, list]) => {
            const dayTotal = list.reduce((s, t) => s + t.amount, 0);
            return (
              <section key={day}>
                <div className="mb-1.5 flex items-baseline justify-between px-1 text-xs text-muted">
                  <span className="font-medium">{new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: day.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "numeric", timeZone: "UTC" })}</span>
                  <span className="tabular">{formatMoney(dayTotal)}</span>
                </div>
                <Card className="divide-y divide-border overflow-hidden">
                  {list.map((t) => {
                    const cat = t.id in optimistic ? optimistic[t.id] : t.category;
                    const who = owner(t.account);
                    const isSel = selected.has(t.id);
                    return (
                      <div key={t.id} className={cx("flex items-center gap-3 px-3 py-2.5 sm:px-4", isSel && "bg-accent-soft/60")}>
                        {selecting && (
                          <button onClick={() => setSelected((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} aria-label="Select">
                            {isSel ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} className="text-muted" />}
                          </button>
                        )}
                        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => (selecting ? setSelected((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; }) : setOpenId(t.id))}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-base">{t.splits.length ? "✂️" : cat?.emoji ?? (t.isTransfer ? "🔄" : <span className="text-sm font-semibold text-muted">{t.description.slice(0, 1).toUpperCase()}</span>)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{t.description}</span>
                              {t.isPrivate && <Lock size={12} className="shrink-0 text-warn" aria-label="Hidden from partner" />}
                              {t.isRecurring && <Repeat size={12} className="shrink-0 text-muted" aria-label="Recurring" />}
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-muted">
                              {who ? <Avatar name={who.name} colour={who.colour} size={14} /> : <span className="rounded bg-surface-2 px-1 text-[10px]">Joint</span>}
                              <span className="truncate">{t.splits.length ? `Split ${t.splits.length} ways` : cat?.name ?? <span className="text-warn">Uncategorised</span>} · {t.account.name}</span>
                              {t.notes.length > 0 && <span>· 💬{t.notes.length}</span>}
                              {t.reactions.length > 0 && <span>{[...new Set(t.reactions.map((r) => r.emoji))].join("")}</span>}
                            </span>
                          </span>
                          <Money minor={t.amount} className="text-sm font-medium" />
                        </button>
                      </div>
                    );
                  })}
                </Card>
              </section>
            );
          })}
          {props.hasMore && (
            <Button className="w-full" onClick={() => setParam({ take: String(props.take + 150) })}>Load more</Button>
          )}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setOpenId(null)} title="Transaction" wide>
        {open && (
          <TxnDetail
            t={open}
            category={open.id in optimistic ? optimistic[open.id]! : open.category}
            categories={categories}
            me={me}
            partner={partner}
            onCategory={(c) => changeCategory(open, c)}
            onClose={() => setOpenId(null)}
          />
        )}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add transaction">
        <AddTxn accounts={accounts.filter((a) => a.canManage)} categories={categories} onDone={() => { setAdding(false); router.refresh(); }} />
      </Sheet>
    </div>
  );
}

function CategorySelect({ value, categories, onChange, className }: { value: string; categories: CategoryGroups; onChange: (v: string) => void; className?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Uncategorised</option>
      {categories.map((g) => <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>)}
    </Select>
  );
}

function TxnDetail({ t, category, categories, me, partner, onCategory, onClose }: {
  t: TxnView; category: TxnView["category"]; categories: CategoryGroups; me: Person; partner: Person | null; onCategory: (c: string | null) => void; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [notePrivate, setNotePrivate] = useState(false);
  const [desc, setDesc] = useState(t.description);
  const [splitting, setSplitting] = useState(false);
  const [err, setErr] = useState<string>();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, close = false) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error);
      else {
        router.refresh();
        if (close) onClose();
      }
    });
  const autoLabel = t.categorySource && t.categorySource !== "user" && t.categoryConfidence !== null ? `auto · ${Math.round(t.categoryConfidence * 100)}%` : null;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <Money minor={t.amount} className="text-3xl font-semibold" />
        <div className="mt-1 text-sm text-muted">{new Date(t.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} · {t.account.name}</div>
        <div className="mt-1 break-words text-xs text-muted/80">{t.rawDescription}</div>
      </div>

      <Field label="Description">
        <div className="flex gap-2">
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          {desc !== t.description && <Button disabled={pending} onClick={() => act(() => updateTxnAction(t.id, { description: desc }))}>Save</Button>}
        </div>
      </Field>

      {t.splits.length === 0 && !splitting ? (
        <Field label="Category" hint={autoLabel && <span>Categorised {autoLabel}. Changing it teaches Tandem for next time — for both of you.</span>}>
          <div className="flex gap-2">
            <CategorySelect value={category?.id ?? ""} categories={categories} onChange={(v) => onCategory(v || null)} className="flex-1" />
            <Button onClick={() => setSplitting(true)} title="Split"><SplitSquareHorizontal size={15} /> Split</Button>
          </div>
        </Field>
      ) : (
        <SplitEditor t={t} categories={categories} onCancel={() => setSplitting(false)} onDone={() => { setSplitting(false); router.refresh(); }} />
      )}

      {t.merchant && category && (
        <button
          className="text-sm text-accent"
          disabled={pending}
          onClick={() => act(async () => {
            const r = await createRuleAction({ merchantKey: t.merchant!.key, categoryId: category.id, applyToExisting: true });
            if (r.ok) alert(`Done — ${(r.data as { updated: number }).updated} ${t.merchant!.name} transactions updated.`);
            return r;
          })}
        >
          Always categorise {t.merchant.name} as {category.name}
        </button>
      )}

      {t.canManage && (
        <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
          <div className="flex items-center gap-2 text-sm">
            <EyeOff size={16} className="text-muted" />
            <div>
              <div className="font-medium">Hide from {partner?.name ?? "partner"}</div>
              <div className="text-xs text-muted">They won&apos;t see it or have it in their totals.</div>
            </div>
          </div>
          <input
            type="checkbox"
            role="switch"
            className="size-5 accent-[var(--accent)]"
            checked={t.isPrivate}
            disabled={pending || (t.isPrivate && !t.canUnhide)}
            onChange={(e) => act(() => setPrivateAction(t.id, e.target.checked))}
          />
        </div>
      )}

      <div>
        <div className="mb-2 flex gap-1.5">
          {REACTIONS.map((e) => {
            const mine = t.reactions.some((r) => r.emoji === e && r.userId === me.id);
            const count = t.reactions.filter((r) => r.emoji === e).length;
            return (
              <button key={e} onClick={() => act(() => reactAction(t.id, e))} className={cx("h-8 rounded-full border px-2.5 text-sm", mine ? "border-accent bg-accent-soft" : "border-border")}>
                {e}{count > 0 && <span className="ml-1 text-xs">{count}</span>}
              </button>
            );
          })}
        </div>
        <ul className="space-y-2">
          {t.notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span className="flex-1"><span className="font-medium">{n.author}</span> {n.body} {n.isPrivate && <Badge tone="warn">only you</Badge>}</span>
              {n.mine && <button onClick={() => act(() => deleteNoteAction(n.id))} aria-label="Delete note"><X size={14} className="text-muted" /></button>}
            </li>
          ))}
        </ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) act(async () => { const r = await noteAction(t.id, note, notePrivate); if (r.ok) setNote(""); return r; }); }}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Add a note${partner ? ` for ${partner.name}` : ""}…`} />
          <Button disabled={pending || !note.trim()}>Add</Button>
        </form>
        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={notePrivate} onChange={(e) => setNotePrivate(e.target.checked)} /> Note visible only to me
        </label>
      </div>

      <ErrorText>{err}</ErrorText>
      {t.canManage && (
        <button className="flex items-center gap-1.5 text-sm text-neg" disabled={pending} onClick={() => confirm("Delete this transaction?") && act(() => deleteTxnAction(t.id), true)}>
          <Trash2 size={14} /> Delete transaction
        </button>
      )}
    </div>
  );
}

function SplitEditor({ t, categories, onCancel, onDone }: { t: TxnView; categories: CategoryGroups; onCancel: () => void; onDone: () => void }) {
  const sign = t.amount < 0 ? -1 : 1;
  const abs = Math.abs(t.amount) / 100;
  const [parts, setParts] = useState(
    t.splits.length
      ? t.splits.map((s) => ({ categoryId: s.category?.id ?? "", amount: (Math.abs(s.amount) / 100).toFixed(2) }))
      : [{ categoryId: t.category?.id ?? "", amount: abs.toFixed(2) }, { categoryId: "", amount: "0.00" }],
  );
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const sum = parts.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
  const left = Math.round(abs * 100) - sum;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between text-sm font-medium">
        Split {formatMoney(Math.abs(t.amount))}
        <span className={cx("tabular text-xs", left === 0 ? "text-pos" : "text-warn")}>{left === 0 ? "Balanced" : `${formatMoney(left)} left`}</span>
      </div>
      {parts.map((p, i) => (
        <div key={i} className="flex gap-2">
          <CategorySelect value={p.categoryId} categories={categories} onChange={(v) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, categoryId: v } : x)))} className="flex-1" />
          <Input className="w-28" inputMode="decimal" value={p.amount} onChange={(e) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          {parts.length > 2 && <button onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} aria-label="Remove part"><X size={15} className="text-muted" /></button>}
        </div>
      ))}
      <button className="text-sm text-accent" onClick={() => setParts((ps) => [...ps, { categoryId: "", amount: (left / 100).toFixed(2) }])}>+ Add part</button>
      <ErrorText>{err}</ErrorText>
      <div className="flex gap-2 pt-1">
        <Button
          variant="primary"
          disabled={pending || left !== 0 || parts.some((p) => !p.categoryId)}
          onClick={() => start(async () => {
            const r = await splitAction(t.id, parts.map((p) => ({ categoryId: p.categoryId, amount: String(sign * Number(p.amount)) })));
            if (!r.ok) setErr(r.error);
            else onDone();
          })}
        >
          Save split
        </Button>
        {t.splits.length > 0 && <Button disabled={pending} onClick={() => start(async () => { await splitAction(t.id, []); onDone(); })}>Remove split</Button>}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function AddTxn({ accounts, categories, onDone }: { accounts: Acct[]; categories: CategoryGroups; onDone: () => void }) {
  const [f, setF] = useState({ accountId: accounts[0]?.id ?? "", date: new Date().toISOString().slice(0, 10), amount: "", direction: "out" as "out" | "in", description: "", categoryId: "", isPrivate: false });
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  if (!accounts.length) return <p className="text-sm text-muted">Add an account first.</p>;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addTxnAction(f); if (!r.ok) setErr(r.error); else onDone(); }); }}>
      <div className="grid grid-cols-2 gap-2">
        {(["out", "in"] as const).map((d) => (
          <button type="button" key={d} onClick={() => setF({ ...f, direction: d })} className={`h-10 rounded-lg border text-sm ${f.direction === d ? "border-accent bg-accent-soft font-medium text-accent" : "border-border"}`}>
            {d === "out" ? "Money out" : "Money in"}
          </button>
        ))}
      </div>
      <Field label="Amount (£)"><Input autoFocus inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" /></Field>
      <Field label="Description"><Input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Cash for babysitter" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Account">
          <Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
      </div>
      <Field label="Category"><CategorySelect value={f.categoryId} categories={categories} onChange={(v) => setF({ ...f, categoryId: v })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPrivate} onChange={(e) => setF({ ...f, isPrivate: e.target.checked })} /> Hide from partner</label>
      <ErrorText>{err}</ErrorText>
      <Button variant="primary" className="w-full" disabled={pending}>{pending ? "Saving…" : "Add transaction"}</Button>
    </form>
  );
}
