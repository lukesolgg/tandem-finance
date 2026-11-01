"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, EyeOff, Plus, Users } from "lucide-react";
import { ACCOUNT_TYPES, BANKS, VISIBILITY, bankName } from "@/domain/banks";
import { Avatar, Badge, Button, Card, ErrorText, Field, Input, Money, Select } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { createAccountAction, updateAccountAction } from "../actions";

type Row = {
  id: string; name: string; type: string; institution: string | null; ownerId: string | null; visibility: string; maskedNumber: string | null;
  balance: number | null; asOf: string | null; txnCount: number; lastStatement: string | null; canManage: boolean;
};
type Person = { id: string; name: string; colour: string };

export function AccountsClient({ accounts, me, partner }: { accounts: Row[]; me: Person; partner: Person | null }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const groups: [string, Row[], React.ReactNode][] = [
    ["Yours", accounts.filter((a) => a.ownerId === me.id), <Avatar key="m" name={me.name} colour={me.colour} />],
    ["Joint", accounts.filter((a) => a.ownerId === null), <Users key="j" size={16} className="text-muted" />],
    [partner ? `${partner.name}'s` : "Partner's", accounts.filter((a) => a.ownerId && a.ownerId !== me.id), partner ? <Avatar key="p" name={partner.name} colour={partner.colour} /> : null],
  ];
  return (
    <div className="space-y-6">
      <Button variant="primary" onClick={() => setAdding(true)}>
        <Plus size={16} /> Add account
      </Button>
      {groups.map(([label, rows, icon]) =>
        rows.length ? (
          <section key={label}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">{icon}{label}</h2>
            <Card className="divide-y divide-border">
              {rows.map((a) => (
                <button key={a.id} disabled={!a.canManage} onClick={() => setEditing(a)} className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-surface-2/60 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.name}</span>
                      {a.maskedNumber && <span className="text-xs text-muted">··{a.maskedNumber}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {bankName(a.institution)} · {ACCOUNT_TYPES.find((t) => t.id === a.type)?.label}
                      {a.ownerId !== null && a.ownerId === me.id && (
                        <Badge tone={a.visibility === "private" ? "warn" : a.visibility === "summary_only" ? "accent" : "neutral"}>
                          {a.visibility === "shared" ? <Eye size={11} /> : <EyeOff size={11} />}
                          {VISIBILITY.find((x) => x.id === a.visibility)?.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {a.balance !== null ? <Money minor={a.balance} colour={false} className="font-medium" /> : <span className="text-sm text-muted">—</span>}
                    <div className="text-[11px] text-muted">{a.lastStatement ? `to ${new Date(a.lastStatement).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "no statements"}</div>
                  </div>
                </button>
              ))}
            </Card>
          </section>
        ) : null,
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add account">
        <AddAccountForm onDone={() => setAdding(false)} />
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? ""}>
        {editing && <EditAccountForm account={editing} isMine={editing.ownerId === me.id} partnerName={partner?.name ?? "your partner"} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

function AddAccountForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [bank, setBank] = useState("monzo");
  const [type, setType] = useState("current");
  const [owner, setOwner] = useState<"me" | "joint">("me");
  const [visibility, setVisibility] = useState<"shared" | "summary_only" | "private">("shared");
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createAccountAction({ name: name || `${bankName(bank)} ${ACCOUNT_TYPES.find((t) => t.id === type)?.label}`, type: type as "current", institution: bank, owner, visibility, maskedNumber: last4 });
          if (!r.ok) return setErr(r.error);
          onDone();
          router.refresh();
        });
      }}
    >
      <Field label="Bank">
        <Select value={bank} onChange={(e) => { setBank(e.target.value); setType(BANKS.find((b) => b.id === e.target.value)?.defaultType ?? "current"); }}>
          {BANKS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Last 4 digits" hint="Optional">
          <Input inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <Field label="Name" hint="Leave blank for a sensible default.">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${bankName(bank)} ${ACCOUNT_TYPES.find((t) => t.id === type)?.label}`} />
      </Field>
      <Field label="Whose is it?">
        <div className="grid grid-cols-2 gap-2">
          {(["me", "joint"] as const).map((o) => (
            <button type="button" key={o} onClick={() => setOwner(o)} className={`h-10 rounded-lg border text-sm ${owner === o ? "border-accent bg-accent-soft font-medium text-accent" : "border-border"}`}>
              {o === "me" ? "Mine" : "Joint"}
            </button>
          ))}
        </div>
      </Field>
      {owner === "me" && <VisibilityPicker value={visibility} onChange={setVisibility} />}
      <ErrorText>{err}</ErrorText>
      <Button variant="primary" className="w-full" disabled={pending}>{pending ? "Adding…" : "Add account"}</Button>
    </form>
  );
}

function VisibilityPicker({ value, onChange, partnerName = "Your partner" }: { value: string; onChange: (v: "shared" | "summary_only" | "private") => void; partnerName?: string }) {
  return (
    <Field label={`What can ${partnerName.toLowerCase() === "your partner" ? "your partner" : partnerName} see?`}>
      <div className="space-y-2">
        {VISIBILITY.map((o) => (
          <button type="button" key={o.id} onClick={() => onChange(o.id)} className={`block w-full rounded-xl border p-3 text-left ${value === o.id ? "border-accent bg-accent-soft" : "border-border"}`}>
            <div className="text-sm font-medium">{o.label}</div>
            <div className="text-xs text-muted">{o.help}</div>
          </button>
        ))}
      </div>
    </Field>
  );
}

function EditAccountForm({ account, isMine, partnerName, onDone }: { account: Row; isMine: boolean; partnerName: string; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [visibility, setVisibility] = useState(account.visibility as "shared" | "summary_only" | "private");
  const [balance, setBalance] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof updateAccountAction>[1]) =>
    start(async () => {
      const r = await updateAccountAction(account.id, patch);
      if (!r.ok) return setErr(r.error);
      onDone();
      router.refresh();
    });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save({ name, visibility: isMine ? visibility : undefined, balance }); }}>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {isMine && <VisibilityPicker value={visibility} onChange={setVisibility} partnerName={partnerName} />}
      <Field label="Set current balance" hint="Optional. Statements set this automatically; use for accounts you don't import.">
        <Input inputMode="decimal" placeholder="e.g. 1250.00 (or -340.00 for a card)" value={balance} onChange={(e) => setBalance(e.target.value)} />
      </Field>
      <ErrorText>{err}</ErrorText>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={pending}>Save</Button>
        <Button type="button" variant="danger" disabled={pending} onClick={() => confirm("Archive this account? Its transactions are kept.") && save({ archived: true })}>Archive</Button>
      </div>
    </form>
  );
}
