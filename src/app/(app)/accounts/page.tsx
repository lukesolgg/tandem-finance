import { Landmark } from "lucide-react";
import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { netWorth } from "@/domain/insights/service";
import { Card, EmptyState, Money, PageHeader } from "@/components/ui";
import { AccountsClient } from "./client";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const v = await requireViewerContext();
  const nw = await netWorth(db, v);
  const accounts = await db.account.findMany({
    where: { id: { in: nw.accounts.map((a) => a.id) } },
    include: { _count: { select: { transactions: true } }, statements: { where: { status: "committed" }, orderBy: { periodEnd: "desc" }, take: 1, select: { periodEnd: true } } },
  });
  const rows = nw.accounts.map((n) => {
    const a = accounts.find((x) => x.id === n.id)!;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution,
      ownerId: a.ownerId,
      visibility: a.visibility,
      maskedNumber: a.maskedNumber,
      balance: n.balance,
      asOf: n.asOf,
      txnCount: a._count.transactions,
      lastStatement: a.statements[0]?.periodEnd?.toISOString().slice(0, 10) ?? null,
      canManage: a.ownerId === null || a.ownerId === v.userId,
    };
  });
  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={
          <>
            Net worth <Money minor={nw.total} colour={false} className="font-medium text-text" />
            {nw.unknownCount > 0 && <> · {nw.unknownCount} without a balance yet</>}
          </>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Landmark />} title="Add your first account" body="One per bank account or card. You choose what your partner can see for each one." />
        </Card>
      ) : null}
      <AccountsClient
        accounts={rows}
        me={{ id: v.userId, name: v.user.name, colour: v.user.colour }}
        partner={v.partner}
      />
    </>
  );
}
