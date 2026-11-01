import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { hashToken, newToken } from "./crypto";
import type { Viewer } from "@/domain/access/visibility";

/**
 * Sessions: opaque random token in an httpOnly cookie, SHA-256 of it in the DB.
 * A database leak therefore doesn't leak live sessions, and signing out
 * everywhere is one DELETE.
 *
 * Why not Auth.js: for a two-person app we need exactly name + PIN, invite-link
 * sign-up and DB sessions. Auth.js adds an adapter layer, JWT
 * defaults we'd turn off, and email infrastructure we don't need. ~80 lines
 * of auditable code is the better trade here.
 */
export const SESSION_COOKIE = "tandem_session";
const SESSION_DAYS = 60;

export async function createSession(userId: string, userAgent?: string | null): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 200) ?? null } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export interface ViewerContext extends Viewer {
  user: { id: string; name: string; colour: string };
  partner: { id: string; name: string; colour: string } | null;
  household: { id: string; name: string; monthStartDay: number; currency: string };
  role: string;
}

/** Cached per request: layouts and pages can both call it for free. */
export const getViewerContext = cache(async (): Promise<ViewerContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { membership: { include: { household: { include: { members: { include: { user: true } } } } } } } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const m = session.user.membership;
  if (!m) return null;
  const other = m.household.members.find((x) => x.userId !== session.userId);
  return {
    userId: session.userId,
    householdId: m.householdId,
    role: m.role,
    user: { id: session.user.id, name: session.user.name, colour: session.user.displayColour },
    partner: other ? { id: other.userId, name: other.user.name, colour: other.user.displayColour } : null,
    household: { id: m.household.id, name: m.household.name, monthStartDay: m.household.monthStartDay, currency: m.household.currency },
  };
});

export async function getViewer(): Promise<Viewer | null> {
  const c = await getViewerContext();
  return c ? { userId: c.userId, householdId: c.householdId } : null;
}

export class UnauthorisedError extends Error {}

/** For route handlers: throws → 401. */
export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new UnauthorisedError();
  return v;
}

/** For pages & server actions: redirects to /login. */
export async function requireViewerContext(): Promise<ViewerContext> {
  const c = await getViewerContext();
  if (!c) redirect("/login");
  return c;
}
