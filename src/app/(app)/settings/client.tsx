"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Download, Share2, Trash2 } from "lucide-react";
import { Avatar, Button, Card, CardHeader, ErrorText, Field, Input, Select } from "@/components/ui";
import { changePinAction, createCategoryAction, createInviteAction, deleteRuleAction, signOutEverywhereAction, updateHouseholdAction, updateProfileAction } from "../actions";

const COLOURS = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#0EA5E9", "#8B5CF6", "#EF4444", "#14B8A6"];

export function SettingsClient(props: {
  me: { name: string; colour: string };
  partner: { name: string; colour: string } | null;
  household: { name: string; monthStartDay: number };
  pendingInviteExpires: string | null;
  rules: { id: string; match: string; category: string; markPrivate: boolean }[];
  groups: { id: string; name: string; count: number; categories: string[] }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(props.me.name);
  const [colour, setColour] = useState(props.me.colour);
  const [hh, setHh] = useState(props.household);
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [cat, setCat] = useState({ name: "", emoji: "", groupId: props.groups[0]?.id ?? "" });
  const [err, setErr] = useState<string>();
  const [pins, setPins] = useState({ current: "", next: "", confirm: "" });
  const [pinMsg, setPinMsg] = useState<string>();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (d: unknown) => void) =>
    start(async () => {
      setErr(undefined);
      const r = await fn();
      if (!r.ok) setErr(r.error);
      else {
        after?.(r.data);
        router.refresh();
      }
    });

  return (
    <div className="space-y-5">
      <ErrorText>{err}</ErrorText>

      <Card>
        <CardHeader title="You" />
        <form className="space-y-4 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); run(() => updateProfileAction({ name, colour })); }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Your colour" hint="Used to show whose transactions are whose.">
            <div className="flex flex-wrap gap-2">
              {COLOURS.map((c) => (
                <button type="button" key={c} onClick={() => setColour(c)} className={`size-8 rounded-full ${colour === c ? "ring-2 ring-offset-2 ring-offset-surface" : ""}`} style={{ background: c, ["--tw-ring-color" as string]: c }} aria-label={c} />
              ))}
            </div>
          </Field>
          <Button variant="primary" disabled={pending}>Save</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Household" />
        <div className="space-y-4 p-4 sm:p-5">
          {props.partner ? (
            <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3 text-sm">
              <Avatar name={props.partner.name} colour={props.partner.colour} size={28} />
              <span>{props.partner.name} is in your household.</span>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-4">
              <div className="font-medium">Invite your partner</div>
              <p className="mt-1 text-sm text-muted">Create a private link and send it however you like — WhatsApp, text, email. It works once and lasts 7 days.</p>
              {invite ? (
                <div className="mt-3 space-y-2">
                  <Input readOnly value={invite.url} onFocus={(e) => e.target.select()} />
                  <div className="flex gap-2">
                    <Button onClick={async () => { await navigator.clipboard.writeText(invite.url); setCopied(true); }}><Copy size={14} /> {copied ? "Copied" : "Copy link"}</Button>
                    {typeof navigator !== "undefined" && "share" in navigator && (
                      <Button onClick={() => navigator.share({ title: "Join me on Tandem", text: "Here's the link to join our household on Tandem:", url: invite.url }).catch(() => {})}><Share2 size={14} /> Share</Button>
                    )}
                  </div>
                </div>
              ) : (
                <Button className="mt-3" variant="primary" disabled={pending} onClick={() => run(() => createInviteAction(), (d) => setInvite(d as { url: string; expiresAt: string }))}>
                  {props.pendingInviteExpires ? "Create a new link" : "Create invite link"}
                </Button>
              )}
              {props.pendingInviteExpires && !invite && <p className="mt-2 text-xs text-muted">A link is already out (expires {new Date(props.pendingInviteExpires).toLocaleDateString("en-GB")}). Creating a new one cancels it.</p>}
            </div>
          )}
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => updateHouseholdAction(hh)); }}>
            <Field label="Household name"><Input value={hh.name} onChange={(e) => setHh({ ...hh, name: e.target.value })} /></Field>
            <Field label="Budget month starts on" hint="Match it to payday so each month's budget lines up with your wages.">
              <Select value={hh.monthStartDay} onChange={(e) => setHh({ ...hh, monthStartDay: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 1 ? "1st (calendar month)" : `${d}${d === 2 || d === 22 ? "nd" : d === 3 || d === 23 ? "rd" : d === 21 ? "st" : "th"}`}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2"><Button variant="primary" disabled={pending}>Save household</Button></div>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader title="Categorisation rules" subtitle="Rules run before anything else. Create them from any transaction." />
        <ul className="divide-y divide-border px-4 pb-2 sm:px-5">
          {props.rules.length === 0 && <li className="py-3 text-sm text-muted">No rules yet. Tandem also learns from your corrections without them.</li>}
          {props.rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2.5 text-sm">
              <span className="flex-1 capitalize">{r.match} → {r.category}</span>
              <button onClick={() => run(() => deleteRuleAction(r.id))} aria-label="Delete rule"><Trash2 size={14} className="text-muted" /></button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Categories" />
        <div className="space-y-3 p-4 sm:p-5">
          {props.groups.map((g) => (
            <div key={g.id} className="text-sm"><span className="font-medium">{g.name}:</span> <span className="text-muted">{g.categories.join(", ")}</span></div>
          ))}
          <form className="flex flex-wrap gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); run(() => createCategoryAction(cat), () => setCat({ ...cat, name: "", emoji: "" })); }}>
            <Input className="w-16" placeholder="😀" value={cat.emoji} onChange={(e) => setCat({ ...cat, emoji: e.target.value })} aria-label="Emoji" />
            <Input className="min-w-0 flex-1" required placeholder="New category" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
            <Select className="w-36" value={cat.groupId} onChange={(e) => setCat({ ...cat, groupId: e.target.value })}>{props.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
            <Button disabled={pending}>Add</Button>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader title="Your PIN" subtitle="8 digits. 5 wrong tries locks sign-in for 15 minutes." />
        <form
          className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setPinMsg(undefined);
            if (pins.next !== pins.confirm) return setErr("The new PINs don't match.");
            run(() => changePinAction(pins.current, pins.next), () => { setPins({ current: "", next: "", confirm: "" }); setPinMsg("PIN changed."); });
          }}
        >
          {(["current", "next", "confirm"] as const).map((k) => (
            <Field key={k} label={k === "current" ? "Current PIN" : k === "next" ? "New PIN" : "New PIN again"}>
              <Input type="password" inputMode="numeric" maxLength={8} required autoComplete={k === "current" ? "current-password" : "new-password"} value={pins[k]} onChange={(e) => setPins({ ...pins, [k]: e.target.value.replace(/\D/g, "") })} className="font-mono tracking-widest" />
            </Field>
          ))}
          <div className="flex items-center gap-3 sm:col-span-3">
            <Button disabled={pending}>Change PIN</Button>
            {pinMsg && <span className="text-sm text-pos">{pinMsg}</span>}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Data & security" />
        <div className="flex flex-wrap gap-2 p-4 sm:p-5">
          <a href="/api/export" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm"><Download size={14} /> Export everything (CSV)</a>
          <Button variant="danger" disabled={pending} onClick={() => confirm("Sign out on every device, including this one?") && run(() => signOutEverywhereAction(), () => location.assign("/login"))}>Sign out everywhere</Button>
        </div>
      </Card>
    </div>
  );
}
