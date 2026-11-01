import { Activity } from "lucide-react";
import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { activityWhere } from "@/domain/activity";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Activity" };

export default async function ActivityPage() {
  const v = await requireViewerContext();
  const items = await db.activityLog.findMany({ where: activityWhere(v), orderBy: { createdAt: "desc" }, take: 200, include: { actor: { select: { id: true, name: true, displayColour: true } } } });
  return (
    <>
      <PageHeader title="Activity" subtitle="Who changed what. Private items only show up for the person who made them." />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<Activity />} title="Nothing yet" />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5">
                <Avatar name={a.actor.name ?? "?"} colour={a.actor.displayColour} />
                <span className="flex-1"><span className="font-medium">{a.actor.id === v.userId ? "You" : a.actor.name}</span> — {a.summary.charAt(0).toLowerCase() + a.summary.slice(1)}</span>
                <time className="whitespace-nowrap text-xs text-muted">{a.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
