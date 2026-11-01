import { requireViewerContext } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { loadCategories } from "../data";
import { SettingsClient } from "./client";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const v = await requireViewerContext();
  const [rules, categories, invite] = await Promise.all([
    db.categorisationRule.findMany({ where: { householdId: v.householdId }, include: { category: { select: { name: true, emoji: true } } }, orderBy: { createdAt: "desc" } }),
    loadCategories(v.householdId),
    db.householdInvite.findFirst({ where: { householdId: v.householdId, acceptedAt: null, expiresAt: { gt: new Date() } }, select: { expiresAt: true } }),
  ]);
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsClient
        me={{ name: v.user.name, colour: v.user.colour }}
        partner={v.partner}
        household={{ name: v.household.name, monthStartDay: v.household.monthStartDay }}
        pendingInviteExpires={invite?.expiresAt.toISOString() ?? null}
        rules={rules.map((r) => ({ id: r.id, match: r.merchantKey ? `Merchant: ${r.merchantKey.replace(/_/g, " ")}` : `Contains "${r.descriptionContains ?? r.descriptionRegex ?? ""}"`, category: `${r.category.emoji ?? ""} ${r.category.name}`, markPrivate: r.markPrivate }))}
        groups={categories.map((g) => ({ id: g.id, name: g.name, count: g.categories.length, categories: g.categories.map((c) => `${c.emoji ?? ""} ${c.name}`) }))}
      />
    </>
  );
}
