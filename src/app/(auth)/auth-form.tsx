"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar, Button, ErrorText, Field, Input, cx } from "@/components/ui";
import type { FormState } from "./actions";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

/** 8-digit PIN field: numeric keypad on phones, password-manager friendly. */
export function PinInput({ name, label, autoComplete, autoFocus, hint }: { name: string; label: string; autoComplete: string; autoFocus?: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input
        name={name}
        type="password"
        inputMode="numeric"
        pattern="\d{8}"
        maxLength={8}
        minLength={8}
        required
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder="••••••••"
        className="text-center font-mono text-xl tracking-[0.5em]"
        onInput={(e) => (e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "").slice(0, 8))}
      />
    </Field>
  );
}

/** Sign-up / join: name + new PIN twice. */
export function NewPersonForm({ action, submit, hidden, askHousehold }: { action: Action; submit: string; hidden?: Record<string, string>; askHousehold?: boolean }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Field label="Your first name" hint="This is how you'll pick yourself on the sign-in screen.">
        <Input name="name" autoComplete="username" required maxLength={40} />
      </Field>
      <PinInput name="pin" label="Choose an 8-digit PIN" autoComplete="new-password" hint="Not a birthday or 12345678. Your partner gets their own." />
      <PinInput name="pinConfirm" label="Type it again" autoComplete="new-password" />
      {askHousehold && (
        <Field label="Household name"><Input name="householdName" defaultValue="Us" maxLength={60} /></Field>
      )}
      <ErrorText>{state?.error}</ErrorText>
      <Button variant="primary" className="w-full" disabled={pending}>{pending ? "One moment…" : submit}</Button>
    </form>
  );
}

/** Sign-in: tap your name, type your PIN. Remembers who used this device last. */
export function LoginForm({ action, people, next }: { action: Action; people: { id: string; name: string; displayColour: string }[]; next?: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [who, setWho] = useState<string | null>(people.length === 1 ? people[0]!.id : null);
  const pinRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const last = localStorage.getItem("lastUser");
      if (last && people.some((p) => p.id === last)) setWho(last);
    } catch {}
  }, [people]);
  useEffect(() => {
    if (who) pinRef.current?.querySelector("input")?.focus();
  }, [who]);
  return (
    <form
      action={(fd) => {
        try {
          if (who) localStorage.setItem("lastUser", who);
        } catch {}
        formAction(fd);
      }}
      className="space-y-5"
    >
      {next && <input type="hidden" name="next" value={next} />}
      <input type="hidden" name="userId" value={who ?? ""} />
      <div className="grid grid-cols-2 gap-3">
        {people.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => setWho(p.id)}
            className={cx("flex flex-col items-center gap-2 rounded-2xl border p-4 transition-colors", who === p.id ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2")}
          >
            <Avatar name={p.name} colour={p.displayColour} size={44} />
            <span className="font-medium">{p.name}</span>
          </button>
        ))}
      </div>
      {who && (
        <div ref={pinRef}>
          <PinInput name="pin" label="Your PIN" autoComplete="current-password" />
        </div>
      )}
      <ErrorText>{state?.error}</ErrorText>
      <Button variant="primary" className="w-full" disabled={pending || !who}>{pending ? "Checking…" : "Sign in"}</Button>
    </form>
  );
}
