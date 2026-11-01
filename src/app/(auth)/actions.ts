"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/session";
import { rateLimit } from "@/domain/auth/rate-limit";
import { acceptInvite, DomainError, loginWithPin, signUp } from "@/domain/household/service";

export type FormState = { error?: string } | undefined;

async function ipKey(extra: string) {
  const h = await headers();
  return `${h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}|${extra}`;
}

const pin = z.string().regex(/^\d{8}$/, "Your PIN is 8 digits.");

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ userId: z.string().min(1).max(40), pin }).safeParse({ userId: form.get("userId"), pin: form.get("pin") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter your 8-digit PIN." };
  try {
    // The real protection is the per-person lockout stored in the DB.
    const user = await loginWithPin(db, parsed.data.userId, parsed.data.pin);
    await createSession(user.id, (await headers()).get("user-agent"));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(safeNext(form.get("next")));
}

const NewPerson = z.object({
  name: z.string().trim().min(1, "Enter your first name.").max(40),
  pin,
  pinConfirm: z.string(),
  householdName: z.string().trim().max(60).optional(),
});

type NewPersonResult = { error: string; data?: undefined } | { error?: undefined; data: z.infer<typeof NewPerson> };

function parseNewPerson(form: FormData): NewPersonResult {
  const parsed = NewPerson.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  if (parsed.data.pin !== parsed.data.pinConfirm) return { error: "The two PINs don't match." };
  return { data: parsed.data };
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  const p = parseNewPerson(form);
  if (!p.data) return { error: p.error };
  if (!rateLimit(await ipKey("signup"), 5)) return { error: "Too many attempts. Try again later." };
  try {
    const user = await signUp(db, p.data);
    await createSession(user.id, (await headers()).get("user-agent"));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/");
}

export async function acceptInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const p = parseNewPerson(form);
  if (!p.data) return { error: p.error };
  if (!rateLimit(await ipKey("invite"), 10)) return { error: "Too many attempts. Try again later." };
  try {
    const user = await acceptInvite(db, token, p.data);
    await createSession(user.id, (await headers()).get("user-agent"));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}
