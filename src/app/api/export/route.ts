import { db } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { filtersWhere } from "@/domain/transactions/service";
import { logActivity } from "@/domain/activity";

export const runtime = "nodejs";

/** CSV export of everything the viewer can see in a date range (UK date format, Excel-friendly BOM). */
export async function GET(req: Request) {
  try {
    const viewer = await requireViewer();
    const url = new URL(req.url);
    const iso = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
    const from = iso(url.searchParams.get("from"));
    const to = iso(url.searchParams.get("to"));
    const rows = await db.transaction.findMany({
      where: filtersWhere(viewer, { from, to }),
      orderBy: { date: "asc" },
      include: {
        account: { select: { name: true, owner: { select: { name: true } } } },
        category: { select: { name: true, group: { select: { name: true } } } },
        splits: { include: { category: { select: { name: true } } } },
        notes: { where: { OR: [{ isPrivate: false }, { authorId: viewer.userId }] }, select: { body: true } },
      },
    });
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    // Guard against CSV/formula injection when opened in Excel.
    const safe = (v: string) => esc(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const lines = ["Date,Account,Owner,Description,Category,Group,Amount,Notes"];
    for (const t of rows) {
      const date = t.date.toISOString().slice(0, 10).split("-").reverse().join("/");
      const base = [date, safe(t.account.name), safe(t.account.owner?.name ?? "Joint")];
      const parts = t.splits.length ? t.splits.map((s) => ({ amount: s.amount, cat: s.category?.name ?? "", grp: "" })) : [{ amount: t.amount, cat: t.category?.name ?? "", grp: t.category?.group.name ?? "" }];
      for (const p of parts) {
        lines.push([...base, safe(t.description), safe(p.cat), safe(p.grp), (p.amount / 100).toFixed(2), safe(t.notes.map((n) => n.body).join(" | "))].join(","));
      }
    }
    await logActivity(db, viewer, { action: "export.csv", entityType: "export", entityId: "csv", summary: `Exported ${rows.length} transactions` });
    return new Response("﻿" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tandem-${from ?? "all"}-to-${to ?? "now"}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
