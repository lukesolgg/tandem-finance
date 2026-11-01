import type { Prisma } from "@prisma/client";

/**
 * The privacy model, in one file.
 *
 * Every read of financial data goes through these builders. There is
 * deliberately no "get all transactions for household" helper anywhere else —
 * if a query doesn't compose `transactionWhere(viewer)` it's a bug, and code
 * review should treat it as one.
 *
 * Two distinct questions:
 *   1. Can the viewer see this ROW?            → transactionWhere / accountWhere
 *   2. Can this row COUNT in totals they see?  → aggregateTransactionWhere
 * They differ for `summary_only` accounts: partner sees "Groceries £412" in
 * the household dashboard, but can't open the list of what made it up.
 *
 * Rules
 *  • You always see everything you own.
 *  • Joint accounts (ownerId = null) are visible to all household members.
 *  • Partner's personal account: per `visibility` (shared | summary_only | private).
 *  • A transaction marked private is visible only to `privateOwnerId`, in rows AND totals.
 */
export interface Viewer {
  userId: string;
  householdId: string;
}

export type AccountVisibility = "shared" | "summary_only" | "private";

// ── Pure predicates (used by tests, client-side filtering, and the activity log) ──

export interface AccountLike {
  householdId: string;
  ownerId: string | null;
  visibility: string;
}
export interface TxnLike {
  isPrivate: boolean;
  privateOwnerId: string | null;
  account: AccountLike;
}

export function canSeeAccount(v: Viewer, a: AccountLike): boolean {
  if (a.householdId !== v.householdId) return false;
  return a.ownerId === null || a.ownerId === v.userId || a.visibility !== "private";
}

export function canSeeTransactionRows(v: Viewer, a: AccountLike): boolean {
  if (a.householdId !== v.householdId) return false;
  return a.ownerId === null || a.ownerId === v.userId || a.visibility === "shared";
}

export function canSeeTransaction(v: Viewer, t: TxnLike): boolean {
  return canSeeTransactionRows(v, t.account) && passesPrivateFlag(v, t);
}

export function countsInViewerTotals(v: Viewer, t: TxnLike): boolean {
  return canSeeAccount(v, t.account) && passesPrivateFlag(v, t);
}

function passesPrivateFlag(v: Viewer, t: Pick<TxnLike, "isPrivate" | "privateOwnerId" | "account">): boolean {
  if (!t.isPrivate) return true;
  // Legacy rows without privateOwnerId fall back to the account owner.
  return (t.privateOwnerId ?? t.account.ownerId) === v.userId;
}

// ── Prisma where-builders (the same rules, for the database) ────────────────

export function accountWhere(v: Viewer): Prisma.AccountWhereInput {
  return {
    householdId: v.householdId,
    OR: [{ ownerId: null }, { ownerId: v.userId }, { visibility: { not: "private" } }],
  };
}

const privateFlag = (v: Viewer): Prisma.TransactionWhereInput => ({
  OR: [
    { isPrivate: false },
    { privateOwnerId: v.userId },
    { privateOwnerId: null, account: { ownerId: v.userId } },
  ],
});

export function transactionWhere(v: Viewer): Prisma.TransactionWhereInput {
  return {
    AND: [
      {
        account: {
          householdId: v.householdId,
          OR: [{ ownerId: null }, { ownerId: v.userId }, { visibility: "shared" }],
        },
      },
      privateFlag(v),
    ],
  };
}

export function aggregateTransactionWhere(v: Viewer): Prisma.TransactionWhereInput {
  return { AND: [{ account: accountWhere(v) }, privateFlag(v)] };
}

/** Throws (→ 404 at the edge, never 403: don't confirm existence) if the viewer can't see it. */
export function assertVisible(visible: boolean): asserts visible {
  if (!visible) throw new NotFoundError();
}

export class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

/** Can the viewer change this account's settings / upload to it? Owner only; joint = any member. */
export function canManageAccount(v: Viewer, a: AccountLike): boolean {
  return a.householdId === v.householdId && (a.ownerId === null || a.ownerId === v.userId);
}
