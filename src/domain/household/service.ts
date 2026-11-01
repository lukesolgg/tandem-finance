import type { PrismaClient } from "@prisma/client";
import { hashToken, newToken } from "@/lib/crypto";
import { hashPassword, pinProblem, verifyPassword } from "../auth/password";
import { createHousehold } from "./seed-household";
import type { Viewer } from "../access/visibility";

export const MAX_MEMBERS = 2;
const INVITE_DAYS = 7;
export const MAX_FAILED_PINS = 5;
export const LOCKOUT_MINUTES = 15;

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/**
 * One instance = one household. Only the very first person can sign up (they
 * become the owner); their partner joins with an invite link. A public URL is
 * therefore never open for strangers to create accounts.
 */
export async function signupAllowed(db: PrismaClient): Promise<boolean> {
  return (await db.user.count()) === 0;
}

/** First names + colours for the "who's this?" picker on the login screen. */
export async function loginPeople(db: PrismaClient) {
  return db.user.findMany({ select: { id: true, name: true, displayColour: true }, orderBy: { createdAt: "asc" }, take: MAX_MEMBERS });
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!n) throw new DomainError("name_required", "Enter your first name.");
  return n;
}

function assertPin(pin: string) {
  const problem = pinProblem(pin);
  if (problem) throw new DomainError("weak_pin", problem);
}

export async function signUp(db: PrismaClient, input: { name: string; pin: string; householdName?: string }) {
  if (!(await signupAllowed(db))) throw new DomainError("signup_closed", "This Tandem is already set up. Ask your partner for an invite link.");
  assertPin(input.pin);
  const name = cleanName(input.name);
  const user = await db.user.create({ data: { name, pinHash: await hashPassword(input.pin), displayColour: "#6366F1" } });
  await createHousehold(db, user.id, input.householdName?.trim() || "Us");
  return user;
}

/**
 * Check a PIN with a database-backed lockout (serverless instances don't share
 * memory, so an in-process counter would be useless). The failure counter is
 * updated atomically so parallel guesses can't slip past the limit.
 */
export async function loginWithPin(db: PrismaClient, userId: string, pin: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    await verifyPassword(pin, null); // constant-ish time
    throw new DomainError("bad_pin", "That PIN isn't right.");
  }
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    const mins = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw new DomainError("locked", `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  if (await verifyPassword(pin, user.pinHash)) {
    if (user.failedLogins || user.lockedUntil) await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    return user;
  }
  const updated = await db.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
  if (updated.failedLogins >= MAX_FAILED_PINS) {
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) } });
    throw new DomainError("locked", `Too many wrong PINs. Locked for ${LOCKOUT_MINUTES} minutes.`);
  }
  const left = MAX_FAILED_PINS - updated.failedLogins;
  throw new DomainError("bad_pin", `That PIN isn't right. ${left} ${left === 1 ? "try" : "tries"} left before a ${LOCKOUT_MINUTES}-minute lock.`);
}

export async function changePin(db: PrismaClient, viewer: Viewer, currentPin: string, newPin: string) {
  await loginWithPin(db, viewer.userId, currentPin);
  assertPin(newPin);
  await db.user.update({ where: { id: viewer.userId }, data: { pinHash: await hashPassword(newPin) } });
}

export async function createInvite(db: PrismaClient, viewer: Viewer): Promise<{ token: string; expiresAt: Date }> {
  const members = await db.householdMember.count({ where: { householdId: viewer.householdId } });
  if (members >= MAX_MEMBERS) throw new DomainError("household_full", "Your household already has two people.");
  // One live invite at a time keeps things simple and revokes old links.
  await db.householdInvite.deleteMany({ where: { householdId: viewer.householdId, acceptedAt: null } });
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await db.householdInvite.create({ data: { householdId: viewer.householdId, tokenHash: hashToken(token), invitedById: viewer.userId, expiresAt } });
  return { token, expiresAt };
}

export async function findInvite(db: PrismaClient, token: string) {
  const inv = await db.householdInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { household: true, invitedBy: { select: { name: true } } },
  });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

export async function acceptInvite(db: PrismaClient, token: string, input: { name: string; pin: string }) {
  const inv = await findInvite(db, token);
  if (!inv) throw new DomainError("invite_invalid", "This invite link has expired or been used.");
  assertPin(input.pin);
  const name = cleanName(input.name);
  const pinHash = await hashPassword(input.pin);
  return db.$transaction(async (tx) => {
    const members = await tx.householdMember.findMany({ where: { householdId: inv.householdId }, include: { user: { select: { name: true } } } });
    if (members.length >= MAX_MEMBERS) throw new DomainError("household_full", "This household is already full.");
    // Names are how you pick yourself on the login screen, so they must differ.
    if (members.some((m) => m.user.name.toLowerCase() === name.toLowerCase())) {
      throw new DomainError("name_taken", `${name} is already in this household — add an initial, e.g. "${name} B".`);
    }
    const user = await tx.user.create({ data: { name, pinHash, displayColour: "#EC4899" } });
    await tx.householdMember.create({ data: { householdId: inv.householdId, userId: user.id, role: "member" } });
    await tx.householdInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await tx.activityLog.create({
      data: { householdId: inv.householdId, actorId: user.id, action: "household.joined", entityType: "user", entityId: user.id, summary: `${name} joined the household` },
    });
    return user;
  });
}
