"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, ShieldCheck, Upload, X } from "lucide-react";
import { Badge, Button, Card, Field, Money, Select, buttonClass, cx, formatMoney } from "@/components/ui";
import { commitStatementAction, discardStatementAction } from "../actions";

type Acct = { id: string; name: string; institution: string | null; type: string; joint: boolean; lastTo: string | null };
type Row = {
  index: number; date: string; amount: number; description: string; rawDescription: string; confidence: number; warnings: string[];
  disposition: { kind: "new" } | { kind: "duplicate"; of: string; via: string } | { kind: "possible_duplicate"; of: string; score: number };
};
type Review = {
  result: { meta: { bankId: string; format: string; periodStart?: string; periodEnd?: string; closingBalance?: number }; reconciled: boolean | null; confidence: number; warnings: string[] };
  rows: Row[];
  summary: { total: number; new: number; duplicates: number; possibleDuplicates: number; needsAttention: number; moneyIn: number; moneyOut: number };
  canQuickCommit: boolean;
};
type Result = { filename: string; statementId?: string; review?: Review; error?: { code: string; message: string } };

const WARNING_COPY: Record<string, string> = {
  date_order_ambiguous: "Date order assumed DD/MM",
  year_inferred: "Year worked out from statement",
  sign_inferred_from_balance: "In/out worked out from balance",
  sign_assumed: "Couldn't tell if money in or out",
  sign_convention_inferred: "Card: payments treated as money in",
  multiline_merged: "Description joined from several lines",
  balance_mismatch: "Balance doesn't add up here",
  zero_amount: "£0.00",
  possible_duplicate: "Looks like one you already have",
  unrecognised_layout: "Unfamiliar layout",
  pending_or_reverted_skipped: "Pending payments skipped",
};

export function ImportFlow({ accounts, tips, initialAccountId }: { accounts: Acct[]; tips: Record<string, string>; initialAccountId: string }) {
  const [accountId, setAccountId] = useState(initialAccountId);
  const [results, setResults] = useState<Result[]>([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const account = accounts.find((a) => a.id === accountId)!;

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setErr(undefined);
    setUploading(true);
    try {
      // One file per request: keeps each upload under the host's request size
      // limit (4.5 MB on Vercel) and lets results appear as each file finishes.
      for (const f of list) {
        if (f.size > 4_400_000) {
          setResults((r) => [{ filename: f.name, error: { code: "too_large", message: "This file is over 4.4 MB. Download a shorter date range, or the CSV/OFX version." } }, ...r]);
          continue;
        }
        const form = new FormData();
        form.set("accountId", accountId);
        form.set("retainOriginal", "true");
        form.append("files", f);
        const res = await fetch("/api/statements", { method: "POST", body: form });
        const json = await res.json().catch(() => ({ error: "Upload failed" }));
        if (!res.ok) {
          setErr(json.error ?? "Upload failed");
          break;
        }
        setResults((r) => [...json.results, ...r]);
      }
    } catch {
      setErr("Upload failed — check your connection.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Import into">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.joint ? " (joint)" : ""}</option>
              ))}
            </Select>
          </Field>
          <Link href="/accounts" className={buttonClass("ghost", "sm")}>Manage accounts</Link>
        </div>
        <p className="mt-3 text-xs text-muted">
          <span className="font-medium text-text">Tip: </span>
          {tips[account.institution ?? "generic"] ?? tips.generic}
          {account.lastTo && <> Last import covered up to {new Date(account.lastTo).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</>}
        </p>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          className={cx("mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors", drag ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2/50")}
        >
          {uploading ? <Loader2 className="animate-spin text-accent" /> : <Upload className="text-accent" />}
          <span className="mt-2 font-medium">{uploading ? "Reading your statements…" : "Drop statements here or tap to choose"}</span>
          <span className="mt-1 text-xs text-muted">Up to 12 files · nothing is imported until you confirm</span>
          <input ref={input} type="file" multiple accept=".pdf,.csv,.ofx,.qfx,.txt,text/csv,application/pdf" className="sr-only" onChange={(e) => e.target.files && upload(e.target.files)} />
        </label>
        {err && <p className="mt-3 text-sm text-neg">{err}</p>}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} /> Originals are encrypted at rest. Parsing happens on your server — nothing is sent to third parties.</p>
      </Card>
      {results.map((r, i) => (
        <ResultCard key={r.statementId ?? `${r.filename}-${i}`} r={r} onGone={() => setResults((all) => all.filter((x) => x !== r))} />
      ))}
    </div>
  );
}

function ResultCard({ r, onGone }: { r: Result; onGone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const rows = r.review?.rows ?? [];
  // Default selection: new rows yes; exact duplicates no; possible duplicates no (user can tick).
  const [included, setIncluded] = useState<Set<number>>(() => new Set(rows.filter((x) => x.disposition.kind === "new").map((x) => x.index)));
  const visibleRows = useMemo(() => {
    const flagged = rows.filter((x) => x.confidence < 0.8 || x.disposition.kind !== "new");
    return showAll ? rows : flagged.length ? flagged : rows.slice(0, 8);
  }, [rows, showAll]);

  if (r.error || !r.review) {
    return (
      <Card className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 shrink-0 text-neg" size={18} />
        <div className="flex-1 text-sm">
          <div className="font-medium">{r.filename}</div>
          <div className="text-muted">{r.error?.message ?? "Couldn't read this file."}</div>
        </div>
        <button onClick={onGone} aria-label="Dismiss"><X size={16} className="text-muted" /></button>
      </Card>
    );
  }
  const { summary, result } = r.review;
  const pct = Math.round(result.confidence * 100);
  const commit = () =>
    start(async () => {
      const exclude = rows.filter((x) => x.disposition.kind === "new" && !included.has(x.index)).map((x) => x.index);
      const forceInclude = rows.filter((x) => x.disposition.kind !== "new" && included.has(x.index)).map((x) => x.index);
      const res = await commitStatementAction(r.statementId!, { exclude, forceInclude });
      if (!res.ok) return setErr(res.error);
      setDone((res.data as { created: number }).created);
      router.refresh();
    });

  if (done !== null) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <CheckCircle2 className="text-pos" />
        <div className="flex-1 text-sm"><span className="font-medium">{done} transactions imported</span> from {r.filename}</div>
        <Link href="/transactions" className={buttonClass("secondary", "sm")}>View</Link>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 sm:px-5">
        <FileText size={18} className="text-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{r.filename}</div>
          <div className="text-xs text-muted">
            {result.meta.periodStart && `${fmt(result.meta.periodStart)} – ${fmt(result.meta.periodEnd!)}`} · {summary.total} transactions
          </div>
        </div>
        {result.reconciled === true ? <Badge tone="pos"><CheckCircle2 size={11} /> Balances match</Badge> : result.reconciled === false ? <Badge tone="warn">Balances don&apos;t match</Badge> : null}
        <Badge tone={pct >= 90 ? "pos" : pct >= 75 ? "warn" : "neg"}>{pct}% confident</Badge>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border text-center text-sm sm:grid-cols-4">
        <Stat label="New" value={summary.new} />
        <Stat label="Already imported" value={summary.duplicates} />
        <Stat label="Check these" value={summary.needsAttention + summary.possibleDuplicates} warn={summary.needsAttention + summary.possibleDuplicates > 0} />
        <div className="bg-surface px-3 py-2.5">
          <div className="text-xs text-muted">In / out</div>
          <div className="tabular text-[13px]"><span className="text-pos">+{formatMoney(summary.moneyIn, { whole: true })}</span> / {formatMoney(summary.moneyOut, { whole: true })}</div>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {visibleRows.map((x) => (
          <li key={x.index} className={cx("flex items-start gap-3 px-4 py-2.5 sm:px-5", x.confidence < 0.8 && "bg-warn/5")}>
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--accent)]"
              checked={included.has(x.index)}
              onChange={(e) => setIncluded((s) => { const n = new Set(s); if (e.target.checked) n.add(x.index); else n.delete(x.index); return n; })}
              aria-label={`Include ${x.description}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm">{x.description}</span>
                <Money minor={x.amount} className="text-sm" />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-muted">
                <span>{fmt(x.date)}</span>
                {x.disposition.kind === "duplicate" && <Badge>Already imported</Badge>}
                {x.warnings.map((w) => <Badge key={w} tone={["sign_assumed", "balance_mismatch", "possible_duplicate"].includes(w) ? "warn" : "neutral"}>{WARNING_COPY[w] ?? w}</Badge>)}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > visibleRows.length && (
        <button onClick={() => setShowAll(true)} className="w-full border-t border-border py-2 text-xs text-accent">Show all {rows.length}</button>
      )}
      {err && <p className="px-5 pb-2 text-sm text-neg">{err}</p>}
      <div className="flex flex-wrap gap-2 border-t border-border p-4 sm:px-5">
        <Button variant="primary" onClick={commit} disabled={pending || included.size === 0} className="flex-1 sm:flex-none">
          {pending ? "Importing…" : `Import ${included.size} transaction${included.size === 1 ? "" : "s"}`}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => start(async () => { await discardStatementAction(r.statementId!); onGone(); })}>Discard</Button>
      </div>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("tabular font-semibold", warn && "text-warn")}>{value}</div>
    </div>
  );
}

const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
