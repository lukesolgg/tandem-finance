import type { Prisma, PrismaClient } from "@prisma/client";
import { canManageAccount, canSeeTransaction, NotFoundError, transactionWhere, type Viewer } from "../access/visibility";
import { applyCorrection } from "../categorisation/learning";
import { identifyMerchant } from "../categorisation/engine";
import { fingerprintFor } from "../ingestion/dedupe";
import { logActivity } from "../activity";
import { DomainError } from "../household/service";

/**
 * Transaction reads & writes. Every function takes a Viewer and resolves the
 * row through `transactionWhere` first — a transaction you can't see is a
 * transaction that doesn't exist (404).
 */

export interface TxnFilters {
  q?: string;
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string; // "none" = uncategorised
  person?: "me" | "partner" | "joint";
  direction?: "in" | "out";
  min?: number; // minor units, absolute
  max?: number;
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function filtersWhere(viewer: Viewer, f: TxnFilters): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [transactionWhere(viewer), { parentId: null }];
  if (f.from) and.push({ date: { gte: toDate(f.from) } });
  if (f.to) and.push({ date: { lte: toDate(f.to) } });
  if (f.accountId) and.push({ accountId: f.accountId });
  if (f.categoryId === "none") and.push({ categoryId: null, splits: { none: {} } });
  else if (f.categoryId) and.push({ OR: [{ categoryId: f.categoryId }, { splits: { some: { categoryId: f.categoryId } } }] });
  if (f.person === "me") and.push({ account: { ownerId: viewer.userId } });
  if (f.person === "joint") and.push({ account: { ownerId: null } });
  if (f.person === "partner") and.push({ account: { ownerId: { not: viewer.userId }, NOT: { ownerId: null } } });
  if (f.direction === "in") and.push({ amount: { gt: 0 } });
  if (f.direction === "out") and.push({ amount: { lt: 0 } });
  if (f.min != null) and.push({ OR: [{ amount: { gte: f.min } }, { amount: { lte: -f.min } }] });
  if (f.max != null) and.push({ amount: { gte: -f.max, lte: f.max } });
  if (f.q?.trim()) {
    const q = f.q.trim();
    const has = { contains: q, mode: "insensitive" as const };
    and.push({ OR: [{ description: has }, { rawDescription: has }, { merchant: { name: has } }, { notes: { some: { body: has, isPrivate: false } } }] });
  }
  return { AND: and };
}

export const txnInclude = (viewer: Viewer) =>
  ({
    account: { select: { id: true, name: true, ownerId: true, type: true } },
    category: { select: { id: true, name: true, emoji: true, colour: true } },
    merchant: { select: { id: true, name: true, normalisedKey: true } },
    splits: { include: { category: { select: { id: true, name: true, emoji: true } } }, orderBy: { amount: "asc" as const } },
    notes: { where: { OR: [{ isPrivate: false }, { authorId: viewer.userId }] }, include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" as const } },
    reactions: { select: { emoji: true, userId: true } },
  }) satisfies Prisma.TransactionInclude;

export type TxnRow = Prisma.TransactionGetPayload<{ include: ReturnType<typeof txnInclude> }>;

export async function listTransactions(db: PrismaClient, viewer: Viewer, f: TxnFilters, page: { take?: number; cursor?: string } = {}) {
  const take = Math.min(page.take ?? 100, 500);
  const rows = await db.transaction.findMany({
    where: filtersWhere(viewer, f),
    include: txnInclude(viewer),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  return { rows: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1]!.id : null };
}

async function loadVisible(db: PrismaClient | Prisma.TransactionClient, viewer: Viewer, id: string) {
  const t = await db.transaction.findFirst({ where: { AND: [{ id }, transactionWhere(viewer)] }, include: { account: true, merchant: true } });
  if (!t || !canSeeTransaction(viewer, t)) throw new NotFoundError();
  return t;
}

/**
 * Change a category. Teaches the household's merchant memory and tells the
 * caller whether to offer "always categorise X as Y".
 */
export async function setCategory(db: PrismaClient, viewer: Viewer, id: string, categoryId: string | null) {
  const t = await loadVisible(db, viewer, id);
  if (categoryId) await assertCategory(db, viewer, categoryId);
  let suggestRule = false;
  await db.$transaction(async (tx) => {
    await tx.transaction.update({ where: { id }, data: { categoryId, categorySource: "user", categoryConfidence: 1 } });
    if (t.merchant && categoryId) {
      const cat = await tx.category.findUniqueOrThrow({ where: { id: categoryId }, select: { key: true, id: true } });
      const key = cat.key ?? `id:${cat.id}`;
      const prevCat = t.merchant.defaultCategoryId
        ? await tx.category.findUnique({ where: { id: t.merchant.defaultCategoryId }, select: { key: true, id: true } })
        : null;
      const current = prevCat
        ? { key: t.merchant.normalisedKey, categoryKey: prevCat.key ?? `id:${prevCat.id}`, confirmations: t.merchant.confirmations, overrides: t.merchant.overrides }
        : undefined;
      const r = applyCorrection(current, t.merchant.normalisedKey, key);
      suggestRule = r.suggestRule;
      await tx.merchant.update({
        where: { id: t.merchant.id },
        data: { defaultCategoryId: categoryId, confirmations: r.next.confirmations, overrides: r.next.overrides },
      });
    }
  });
  return { suggestRule, merchant: t.merchant ? { key: t.merchant.normalisedKey, name: t.merchant.name } : null };
}

export async function bulkSetCategory(db: PrismaClient, viewer: Viewer, ids: string[], categoryId: string) {
  await assertCategory(db, viewer, categoryId);
  const visible = await db.transaction.findMany({ where: { AND: [{ id: { in: ids.slice(0, 1000) } }, transactionWhere(viewer)] }, select: { id: true } });
  await db.transaction.updateMany({ where: { id: { in: visible.map((v) => v.id) } }, data: { categoryId, categorySource: "user", categoryConfidence: 1 } });
  await logActivity(db, viewer, { action: "transaction.bulk_categorised", entityType: "transaction", entityId: "bulk", summary: `Recategorised ${visible.length} transactions` });
  return visible.length;
}

export async function updateDetails(db: PrismaClient, viewer: Viewer, id: string, patch: { description?: string; date?: string; amount?: number }) {
  const t = await loadVisible(db, viewer, id);
  // Amount/date edits are only for manual transactions — statement data is provenance.
  if ((patch.amount !== undefined || patch.date !== undefined) && t.source !== "manual") {
    throw new DomainError("immutable", "Only manually added transactions can change amount or date.");
  }
  await db.transaction.update({ where: { id }, data: { description: patch.description?.trim() || undefined, amount: patch.amount, date: patch.date ? toDate(patch.date) : undefined } });
}

/**
 * Hide / unhide from partner. You can hide anything you can see on an account
 * you manage (yours, or joint). Only the person who hid it can unhide it.
 */
export async function setPrivate(db: PrismaClient, viewer: Viewer, id: string, isPrivate: boolean) {
  const t = await loadVisible(db, viewer, id);
  if (!canManageAccount(viewer, t.account)) throw new NotFoundError();
  if (!isPrivate && t.isPrivate && (t.privateOwnerId ?? t.account.ownerId) !== viewer.userId) throw new NotFoundError();
  await db.transaction.update({ where: { id }, data: { isPrivate, privateOwnerId: isPrivate ? viewer.userId : null } });
  await db.transaction.updateMany({ where: { parentId: id }, data: { isPrivate, privateOwnerId: isPrivate ? viewer.userId : null } });
}

/** Split into category parts that must sum to the original. Empty `parts` removes the split. */
export async function splitTransaction(db: PrismaClient, viewer: Viewer, id: string, parts: { categoryId: string; amount: number; description?: string }[]) {
  const t = await loadVisible(db, viewer, id);
  if (t.parentId) throw new DomainError("nested_split", "Can't split a split.");
  if (parts.length === 1) throw new DomainError("split_parts", "A split needs at least two parts.");
  if (parts.length && parts.reduce((s, p) => s + p.amount, 0) !== t.amount) throw new DomainError("split_sum", "Parts must add up to the transaction amount.");
  for (const p of parts) await assertCategory(db, viewer, p.categoryId);
  await db.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { parentId: id } });
    for (const [i, p] of parts.entries()) {
      await tx.transaction.create({
        data: {
          accountId: t.accountId,
          parentId: id,
          date: t.date,
          amount: p.amount,
          currency: t.currency,
          description: p.description?.trim() || t.description,
          rawDescription: t.rawDescription,
          merchantId: t.merchantId,
          categoryId: p.categoryId,
          categorySource: "user",
          isPrivate: t.isPrivate,
          privateOwnerId: t.privateOwnerId,
          fingerprint: `${t.fingerprint}:split:${i}`,
          source: "manual",
        },
      });
    }
    await tx.transaction.update({ where: { id }, data: { categorySource: parts.length ? "split_parent" : null, categoryId: parts.length ? null : t.categoryId } });
  });
}

export async function addNote(db: PrismaClient, viewer: Viewer, id: string, body: string, isPrivate = false) {
  await loadVisible(db, viewer, id);
  const text = body.trim().slice(0, 1000);
  if (!text) return;
  await db.transactionNote.create({ data: { transactionId: id, authorId: viewer.userId, body: text, isPrivate } });
}

export async function deleteNote(db: PrismaClient, viewer: Viewer, noteId: string) {
  await db.transactionNote.deleteMany({ where: { id: noteId, authorId: viewer.userId } });
}

export async function toggleReaction(db: PrismaClient, viewer: Viewer, id: string, emoji: string) {
  await loadVisible(db, viewer, id);
  const e = [...emoji].slice(0, 2).join("");
  const key = { transactionId_userId_emoji: { transactionId: id, userId: viewer.userId, emoji: e } };
  const existing = await db.transactionReaction.findUnique({ where: key });
  if (existing) await db.transactionReaction.delete({ where: key });
  else await db.transactionReaction.create({ data: { transactionId: id, userId: viewer.userId, emoji: e } });
}

export async function addManualTransaction(
  db: PrismaClient,
  viewer: Viewer,
  input: { accountId: string; date: string; amount: number; description: string; categoryId?: string | null; isPrivate?: boolean },
) {
  const account = await db.account.findFirst({ where: { id: input.accountId, householdId: viewer.householdId } });
  if (!account || !canManageAccount(viewer, account)) throw new NotFoundError();
  if (input.categoryId) await assertCategory(db, viewer, input.categoryId);
  const m = identifyMerchant(input.description);
  const merchant = await db.merchant.upsert({
    where: { householdId_normalisedKey: { householdId: viewer.householdId, normalisedKey: m.key } },
    create: { householdId: viewer.householdId, normalisedKey: m.key, name: m.name },
    update: {},
  });
  const sameDay = await db.transaction.count({ where: { accountId: account.id, date: toDate(input.date), amount: input.amount } });
  return db.transaction.create({
    data: {
      accountId: account.id,
      date: toDate(input.date),
      amount: input.amount,
      currency: account.currency,
      description: input.description.trim(),
      rawDescription: input.description.trim(),
      merchantId: merchant.id,
      categoryId: input.categoryId ?? null,
      categorySource: input.categoryId ? "user" : null,
      isPrivate: Boolean(input.isPrivate),
      privateOwnerId: input.isPrivate ? viewer.userId : null,
      // Manual rows get a distinct fingerprint namespace so a later statement
      // import flags them as *possible* duplicates rather than silently merging.
      fingerprint: `manual:${fingerprintFor(account.id, input.date, input.amount, sameDay)}:${Date.now()}`,
      source: "manual",
    },
  });
}

export async function deleteTransaction(db: PrismaClient, viewer: Viewer, id: string) {
  const t = await loadVisible(db, viewer, id);
  if (!canManageAccount(viewer, t.account)) throw new NotFoundError();
  await db.transaction.delete({ where: { id } });
  await logActivity(db, viewer, { action: "transaction.deleted", entityType: "transaction", entityId: id, summary: "Deleted a transaction", visibleToPartner: !t.isPrivate });
}

/** "Always categorise <merchant> as <category>" — optionally re-applied to existing rows. */
export async function createMerchantRule(db: PrismaClient, viewer: Viewer, input: { merchantKey?: string; contains?: string; categoryId: string; applyToExisting: boolean }) {
  await assertCategory(db, viewer, input.categoryId);
  if (!input.merchantKey && !input.contains?.trim()) throw new DomainError("rule_empty", "A rule needs something to match.");
  const rule = await db.categorisationRule.create({
    data: {
      householdId: viewer.householdId,
      categoryId: input.categoryId,
      priority: 10,
      origin: "user",
      merchantKey: input.merchantKey ?? null,
      descriptionContains: input.contains?.trim() || null,
    },
  });
  let updated = 0;
  if (input.applyToExisting) {
    const where: Prisma.TransactionWhereInput = {
      AND: [
        transactionWhere(viewer),
        input.merchantKey
          ? { merchant: { normalisedKey: input.merchantKey } }
          : { OR: [{ description: { contains: input.contains!.trim(), mode: "insensitive" } }, { rawDescription: { contains: input.contains!.trim(), mode: "insensitive" } }] },
      ],
    };
    const ids = (await db.transaction.findMany({ where, select: { id: true } })).map((x) => x.id);
    updated = (await db.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId: input.categoryId, categorySource: "rule", categoryConfidence: 1 } })).count;
  }
  await logActivity(db, viewer, { action: "rule.created", entityType: "rule", entityId: rule.id, summary: "Added a categorisation rule" });
  return { ruleId: rule.id, updated };
}

async function assertCategory(db: PrismaClient | Prisma.TransactionClient, viewer: Viewer, categoryId: string) {
  const c = await db.category.findFirst({ where: { id: categoryId, householdId: viewer.householdId } });
  if (!c) throw new NotFoundError();
}
