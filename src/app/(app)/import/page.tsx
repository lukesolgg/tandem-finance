import Link from "next/link";
import { Upload } from "lucide-react";
import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { BANKS } from "@/domain/banks";
import { Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { ImportFlow } from "./flow";

export const metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const v = await requireViewerContext();
  const { account } = await searchParams;
  const accounts = await db.account.findMany({
    where: { householdId: v.householdId, archivedAt: null, OR: [{ ownerId: v.userId }, { ownerId: null }] },
    orderBy: [{ ownerId: "asc" }, { name: "asc" }],
    select: { id: true, name: true, institution: true, type: true, ownerId: true, statements: { where: { status: "committed" }, orderBy: { periodEnd: "desc" }, take: 1, select: { periodEnd: true } } },
  });
  const recent = await db.statement.findMany({
    where: { householdId: v.householdId, uploadedById: v.userId, status: { not: "discarded" } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, originalFilename: true, status: true, createdAt: true, confidence: true, account: { select: { name: true } }, _count: { select: { transactions: true } } },
  });

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Import statements" />
        <Card>
          <EmptyState icon={<Upload />} title="Add an account first" body="Statements are imported into an account, so we know whose money it is and what your partner can see." action={<Link href="/accounts" className={buttonClass("primary")}>Add account</Link>} />
        </Card>
      </>
    );
  }
  const tips = Object.fromEntries(BANKS.map((b) => [b.id, b.exportTip]));
  return (
    <>
      <PageHeader title="Import statements" subtitle="PDF, CSV, OFX/QFX or Santander TXT. The last 1–3 months is perfect; overlaps are de-duplicated." />
      <ImportFlow
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, institution: a.institution, type: a.type, joint: a.ownerId === null, lastTo: a.statements[0]?.periodEnd?.toISOString().slice(0, 10) ?? null }))}
        tips={tips}
        initialAccountId={accounts.some((a) => a.id === account) ? account! : accounts[0]!.id}
      />
      {recent.length > 0 && (
        <Card className="mt-8">
          <CardHeader title="Your recent uploads" />
          <ul className="mt-2 divide-y divide-border">
            {recent.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0 flex-1 truncate">{s.originalFilename}<span className="text-muted"> · {s.account?.name}</span></span>
                <span className="text-xs text-muted">{s.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                <Badge tone={s.status === "committed" ? "pos" : s.status === "failed" ? "neg" : "warn"}>
                  {s.status === "committed" ? `${s._count.transactions} imported` : s.status === "failed" ? "couldn't read" : "not imported"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
