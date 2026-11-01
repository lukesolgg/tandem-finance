"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireViewerContext } from "@/lib/session";
import { NotFoundError, canManageAccount } from "@/domain/access/visibility";
import { DomainError, changePin, createInvite } from "@/domain/household/service";
import * as txns from "@/domain/transactions/service";
import * as budgets from "@/domain/budgets/service";
import * as goals from "@/domain/goals/service";
import { commitStatement } from "@/domain/ingestion/service";
import { logActivity } from "@/domain/activity";

/**
 * All mutations. Each one: resolve viewer → validate with zod → call the
 * domain (which enforces access) → revalidate. Errors return `{ error }` with a
 * human message; nothing financial is logged.
 */
export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, paths: string[] = ["/"]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p, "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    if (e instanceof NotFoundError) return { ok: false, error: "That item doesn't exist or isn't shared with you." };
    if (e instanceof z.ZodError) return { ok: false, error: "Some of those values aren't valid." };
    console.error("action failed:", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** "£12.34" / "12.34" / "-5" → minor units. */
const money = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "Not a number" });
    return z.NEVER;
  }
  return Math.round(n * 100);
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(40);

// ── Accounts ────────────────────────────────────────────────────────────────

const AccountInput = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(["current", "savings", "credit_card", "loan", "mortgage", "investment", "cash"]),
  institution: z.string().max(30).optional(),
  owner: z.enum(["me", "joint"]),
  visibility: z.enum(["shared", "summary_only", "private"]),
  maskedNumber: z.string().regex(/^\d{4}$/).optional().or(z.literal("")),
  isSavingsLike: z.boolean().optional(),
  openingBalance: money.optional(),
});

export async function createAccountAction(input: z.input<typeof AccountInput>) {
  return run(async () => {
    const v = await requireViewerContext();
    const a = AccountInput.parse(input);
    const acc = await db.account.create({
      data: {
        householdId: v.householdId,
        ownerId: a.owner === "joint" ? null : v.userId,
        name: a.name,
        type: a.type,
        institution: a.institution || null,
        visibility: a.owner === "joint" ? "shared" : a.visibility,
        maskedNumber: a.maskedNumber || null,
        isSavingsLike: a.isSavingsLike ?? a.type === "savings",
      },
    });
    if (a.openingBalance !== undefined) {
      await db.balanceSnapshot.create({ data: { accountId: acc.id, date: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"), balance: a.openingBalance, source: "manual" } });
    }
    await logActivity(db, v, { action: "account.created", entityType: "account", entityId: acc.id, summary: a.visibility === "private" && a.owner === "me" ? "Added an account" : `Added account "${a.name}"`, visibleToPartner: !(a.visibility === "private" && a.owner === "me") });
    return { id: acc.id };
  }, ["/accounts", "/import", "/"]);
}

export async function updateAccountAction(accountId: string, patch: { name?: string; visibility?: "shared" | "summary_only" | "private"; archived?: boolean; balance?: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    const acc = await db.account.findFirst({ where: { id: id.parse(accountId), householdId: v.householdId } });
    if (!acc || !canManageAccount(v, acc)) throw new NotFoundError();
    const vis = patch.visibility ? z.enum(["shared", "summary_only", "private"]).parse(patch.visibility) : undefined;
    await db.account.update({
      where: { id: acc.id },
      data: {
        name: patch.name?.trim() || undefined,
        visibility: acc.ownerId === null ? undefined : vis, // joint accounts are always shared
        archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null,
      },
    });
    if (patch.balance !== undefined && patch.balance !== "") {
      const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
      await db.balanceSnapshot.upsert({
        where: { accountId_date_source: { accountId: acc.id, date: today, source: "manual" } },
        create: { accountId: acc.id, date: today, balance: money.parse(patch.balance), source: "manual" },
        update: { balance: money.parse(patch.balance) },
      });
    }
    if (vis && vis !== acc.visibility) {
      await logActivity(db, v, { action: "account.visibility", entityType: "account", entityId: acc.id, summary: "Changed what's shared from an account", visibleToPartner: true });
    }
  }, ["/accounts", "/"]);
}

// ── Import ──────────────────────────────────────────────────────────────────

export async function commitStatementAction(statementId: string, decisions: { exclude?: number[]; forceInclude?: number[] }) {
  return run(async () => {
    const v = await requireViewerContext();
    return commitStatement(db, v, id.parse(statementId), {
      exclude: z.array(z.number().int()).optional().parse(decisions.exclude),
      forceInclude: z.array(z.number().int()).optional().parse(decisions.forceInclude),
    });
  }, ["/"]);
}

export async function discardStatementAction(statementId: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await db.statement.updateMany({ where: { id: id.parse(statementId), householdId: v.householdId, uploadedById: v.userId, status: { in: ["parsed", "needs_review", "failed"] } }, data: { status: "discarded" } });
  }, ["/import"]);
}

// ── Transactions ────────────────────────────────────────────────────────────

export async function setCategoryAction(txnId: string, categoryId: string | null) {
  return run(async () => {
    const v = await requireViewerContext();
    return txns.setCategory(db, v, id.parse(txnId), categoryId ? id.parse(categoryId) : null);
  }, ["/transactions", "/", "/budgets"]);
}

export async function bulkCategoryAction(ids: string[], categoryId: string) {
  return run(async () => {
    const v = await requireViewerContext();
    return txns.bulkSetCategory(db, v, z.array(id).max(1000).parse(ids), id.parse(categoryId));
  }, ["/transactions", "/", "/budgets"]);
}

export async function createRuleAction(input: { merchantKey?: string; contains?: string; categoryId: string; applyToExisting: boolean }) {
  return run(async () => {
    const v = await requireViewerContext();
    return txns.createMerchantRule(db, v, {
      merchantKey: input.merchantKey ? z.string().max(80).parse(input.merchantKey) : undefined,
      contains: input.contains ? z.string().max(80).parse(input.contains) : undefined,
      categoryId: id.parse(input.categoryId),
      applyToExisting: Boolean(input.applyToExisting),
    });
  }, ["/transactions", "/settings", "/"]);
}

export async function deleteRuleAction(ruleId: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await db.categorisationRule.deleteMany({ where: { id: id.parse(ruleId), householdId: v.householdId } });
  }, ["/settings"]);
}

export async function setPrivateAction(txnId: string, isPrivate: boolean) {
  return run(async () => {
    const v = await requireViewerContext();
    await txns.setPrivate(db, v, id.parse(txnId), Boolean(isPrivate));
  }, ["/transactions", "/"]);
}

export async function updateTxnAction(txnId: string, patch: { description?: string; date?: string; amount?: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    await txns.updateDetails(db, v, id.parse(txnId), {
      description: patch.description ? z.string().max(200).parse(patch.description) : undefined,
      date: patch.date ? isoDate.parse(patch.date) : undefined,
      amount: patch.amount ? money.parse(patch.amount) : undefined,
    });
  }, ["/transactions"]);
}

export async function splitAction(txnId: string, parts: { categoryId: string; amount: string; description?: string }[]) {
  return run(async () => {
    const v = await requireViewerContext();
    await txns.splitTransaction(
      db,
      v,
      id.parse(txnId),
      parts.map((p) => ({ categoryId: id.parse(p.categoryId), amount: money.parse(p.amount), description: p.description?.slice(0, 200) })),
    );
  }, ["/transactions", "/budgets", "/"]);
}

export async function noteAction(txnId: string, body: string, isPrivate: boolean) {
  return run(async () => {
    const v = await requireViewerContext();
    await txns.addNote(db, v, id.parse(txnId), z.string().max(1000).parse(body), Boolean(isPrivate));
  }, ["/transactions"]);
}

export async function deleteNoteAction(noteId: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await txns.deleteNote(db, v, id.parse(noteId));
  }, ["/transactions"]);
}

export async function reactAction(txnId: string, emoji: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await txns.toggleReaction(db, v, id.parse(txnId), z.string().min(1).max(8).parse(emoji));
  }, ["/transactions"]);
}

export async function addTxnAction(input: { accountId: string; date: string; amount: string; direction: "out" | "in"; description: string; categoryId?: string; isPrivate?: boolean }) {
  return run(async () => {
    const v = await requireViewerContext();
    const amt = Math.abs(money.parse(input.amount));
    const t = await txns.addManualTransaction(db, v, {
      accountId: id.parse(input.accountId),
      date: isoDate.parse(input.date),
      amount: input.direction === "in" ? amt : -amt,
      description: z.string().trim().min(1).max(200).parse(input.description),
      categoryId: input.categoryId ? id.parse(input.categoryId) : null,
      isPrivate: Boolean(input.isPrivate),
    });
    return { id: t.id };
  }, ["/transactions", "/", "/budgets"]);
}

export async function deleteTxnAction(txnId: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await txns.deleteTransaction(db, v, id.parse(txnId));
  }, ["/transactions", "/", "/budgets"]);
}

// ── Budgets ─────────────────────────────────────────────────────────────────

const scope = z.enum(["household", "personal"]);
const periodKey = z.string().regex(/^\d{4}-\d{2}$/);

export async function setBudgetLineAction(input: { scope: string; period: string; categoryId: string; amount: string; rollover: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    await budgets.setBudgetLine(db, v, scope.parse(input.scope), periodKey.parse(input.period), v.household.monthStartDay, id.parse(input.categoryId), money.parse(input.amount), z.enum(["none", "positive", "both"]).parse(input.rollover));
  }, ["/budgets", "/"]);
}

export async function removeBudgetLineAction(lineId: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await budgets.removeBudgetLine(db, v, id.parse(lineId));
  }, ["/budgets", "/"]);
}

export async function setBudgetStyleAction(input: { scope: string; period: string; style: string; plannedIncome?: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    await budgets.setBudgetStyle(db, v, scope.parse(input.scope), periodKey.parse(input.period), v.household.monthStartDay, z.enum(["targets", "zero_based"]).parse(input.style), input.plannedIncome ? money.parse(input.plannedIncome) : null);
  }, ["/budgets"]);
}

export async function recalcCarryAction(input: { scope: string; period: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    await budgets.recalcCarryIn(db, v, scope.parse(input.scope), periodKey.parse(input.period), v.household.monthStartDay);
  }, ["/budgets"]);
}

// ── Goals ───────────────────────────────────────────────────────────────────

export async function createGoalAction(input: { name: string; emoji?: string; target: string; targetDate?: string; shared: boolean; isPrivate?: boolean; linkedAccountId?: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    await goals.createGoal(db, v, {
      name: z.string().trim().min(1).max(80).parse(input.name),
      emoji: input.emoji?.slice(0, 8),
      targetAmount: money.parse(input.target),
      targetDate: input.targetDate ? isoDate.parse(input.targetDate) : null,
      shared: Boolean(input.shared),
      isPrivate: Boolean(input.isPrivate),
      linkedAccountId: input.linkedAccountId || null,
    });
  }, ["/goals", "/"]);
}

export async function contributeAction(goalId: string, amount: string, date: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await goals.contribute(db, v, id.parse(goalId), money.parse(amount), isoDate.parse(date));
  }, ["/goals", "/"]);
}

export async function deleteGoalAction(goalId: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await goals.deleteGoal(db, v, id.parse(goalId));
  }, ["/goals", "/"]);
}

// ── Household & settings ────────────────────────────────────────────────────

export async function createInviteAction() {
  return run(async () => {
    const v = await requireViewerContext();
    const { token, expiresAt } = await createInvite(db, v);
    const h = await headers();
    const origin = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    return { url: `${origin}/invite/${token}`, expiresAt: expiresAt.toISOString() };
  }, ["/settings"]);
}

export async function updateHouseholdAction(input: { name?: string; monthStartDay?: number }) {
  return run(async () => {
    const v = await requireViewerContext();
    await db.household.update({
      where: { id: v.householdId },
      data: { name: input.name?.trim().slice(0, 60) || undefined, monthStartDay: input.monthStartDay ? z.number().int().min(1).max(31).parse(input.monthStartDay) : undefined },
    });
    await logActivity(db, v, { action: "household.updated", entityType: "household", entityId: v.householdId, summary: "Updated household settings" });
  }, ["/"]);
}

export async function updateProfileAction(input: { name?: string; colour?: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    await db.user.update({
      where: { id: v.userId },
      data: { name: input.name?.trim().slice(0, 60) || undefined, displayColour: input.colour && /^#[0-9a-f]{6}$/i.test(input.colour) ? input.colour : undefined },
    });
  }, ["/"]);
}

export async function createCategoryAction(input: { name: string; emoji?: string; groupId: string }) {
  return run(async () => {
    const v = await requireViewerContext();
    const g = await db.categoryGroup.findFirst({ where: { id: id.parse(input.groupId), householdId: v.householdId } });
    if (!g) throw new NotFoundError();
    await db.category.create({ data: { householdId: v.householdId, groupId: g.id, name: z.string().trim().min(1).max(40).parse(input.name), emoji: input.emoji?.slice(0, 8) || null, sortOrder: 999 } });
  }, ["/settings", "/transactions", "/budgets"]);
}

export async function changePinAction(currentPin: string, newPin: string) {
  return run(async () => {
    const v = await requireViewerContext();
    await changePin(db, v, z.string().max(8).parse(currentPin), z.string().max(8).parse(newPin));
  }, ["/settings"]);
}

export async function signOutEverywhereAction() {
  return run(async () => {
    const v = await requireViewerContext();
    await db.session.deleteMany({ where: { userId: v.userId } });
  }, ["/"]);
}
