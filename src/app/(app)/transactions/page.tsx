import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { listTransactions, type TxnFilters } from "@/domain/transactions/service";
import { PageHeader } from "@/components/ui";
import { loadAccounts, loadCategories } from "../data";
import { TransactionsClient, type TxnView } from "./client";

export const metadata = { title: "Transactions" };

type SP = Record<string, string | undefined>;

function parseFilters(sp: SP): TxnFilters {
  const pounds = (s?: string) => (s && !Number.isNaN(Number(s)) ? Math.round(Number(s) * 100) : undefined);
  const date = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  return {
    q: sp.q?.slice(0, 80),
    from: date(sp.from),
    to: date(sp.to),
    accountId: sp.account,
    categoryId: sp.category,
    person: sp.person === "me" || sp.person === "partner" || sp.person === "joint" ? sp.person : undefined,
    direction: sp.dir === "in" || sp.dir === "out" ? sp.dir : undefined,
    min: pounds(sp.min),
    max: pounds(sp.max),
  };
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const v = await requireViewerContext();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const take = Math.min(Number(sp.take) || 150, 1000);
  const [{ rows, nextCursor }, categories, accounts] = await Promise.all([
    listTransactions(db, v, filters, { take }),
    loadCategories(v.householdId),
    loadAccounts(v),
  ]);
  const view: TxnView[] = rows.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    amount: t.amount,
    description: t.description,
    rawDescription: t.rawDescription,
    source: t.source,
    isPrivate: t.isPrivate,
    canUnhide: t.isPrivate && (t.privateOwnerId ?? t.account.ownerId) === v.userId,
    canManage: t.account.ownerId === null || t.account.ownerId === v.userId,
    isRecurring: t.isRecurring,
    isTransfer: Boolean(t.transferGroupId),
    categorySource: t.categorySource,
    categoryConfidence: t.categoryConfidence,
    account: { id: t.account.id, name: t.account.name, ownerId: t.account.ownerId },
    category: t.category ? { id: t.category.id, name: t.category.name, emoji: t.category.emoji } : null,
    merchant: t.merchant ? { key: t.merchant.normalisedKey, name: t.merchant.name } : null,
    splits: t.splits.map((s) => ({ id: s.id, amount: s.amount, description: s.description, category: s.category ? { id: s.category.id, name: s.category.name, emoji: s.category.emoji } : null })),
    notes: t.notes.map((n) => ({ id: n.id, body: n.body, isPrivate: n.isPrivate, mine: n.authorId === v.userId, author: n.author.name ?? "" })),
    reactions: t.reactions,
  }));
  return (
    <>
      <PageHeader title="Transactions" />
      <TransactionsClient
        txns={view}
        hasMore={Boolean(nextCursor)}
        take={take}
        categories={categories}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, ownerId: a.ownerId, canManage: a.ownerId === null || a.ownerId === v.userId }))}
        me={{ id: v.userId, name: v.user.name, colour: v.user.colour }}
        partner={v.partner}
        initialFilters={sp}
      />
    </>
  );
}
