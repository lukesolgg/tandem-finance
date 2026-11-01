/**
 * Cash-flow aggregation — pure.
 *
 * Classification of each transaction:
 *   category group kind "transfer"  → ignored (moving our own money around)
 *   transferGroupId set             → ignored
 *   kind "income"                   → income (refunds into expense cats net off spend instead)
 *   kind "expense"                  → spend (negative = spend, positive = refund reduces spend)
 *   uncategorised                   → sign decides
 */
export interface AggTxn {
  date: string;
  amount: number;
  categoryId: string | null;
  groupKind: "expense" | "income" | "transfer" | null;
  merchantKey: string | null;
  merchantName: string | null;
  isTransfer: boolean;
  ownerId: string | null; // account owner; null = joint
}

export interface Totals {
  income: number;
  spend: number; // positive number
  net: number;
  byCategory: Map<string | null, number>; // spend per category (positive), null = uncategorised
  byMerchant: Map<string, { name: string; spend: number; count: number }>;
  byOwner: Map<string | null, number>; // spend per person / joint
}

export function classify(t: AggTxn): "income" | "spend" | "ignore" {
  if (t.isTransfer || t.groupKind === "transfer") return "ignore";
  if (t.groupKind === "income") return "income";
  if (t.groupKind === "expense") return "spend";
  return t.amount > 0 ? "income" : "spend";
}

export function totals(txns: AggTxn[]): Totals {
  const out: Totals = { income: 0, spend: 0, net: 0, byCategory: new Map(), byMerchant: new Map(), byOwner: new Map() };
  for (const t of txns) {
    const kind = classify(t);
    if (kind === "ignore") continue;
    if (kind === "income") {
      out.income += t.amount;
      continue;
    }
    const spend = -t.amount; // refunds (positive) reduce spend
    out.spend += spend;
    out.byCategory.set(t.categoryId, (out.byCategory.get(t.categoryId) ?? 0) + spend);
    out.byOwner.set(t.ownerId, (out.byOwner.get(t.ownerId) ?? 0) + spend);
    if (t.merchantKey && spend > 0) {
      const m = out.byMerchant.get(t.merchantKey) ?? { name: t.merchantName ?? t.merchantKey, spend: 0, count: 0 };
      m.spend += spend;
      m.count++;
      out.byMerchant.set(t.merchantKey, m);
    }
  }
  out.net = out.income - out.spend;
  return out;
}

export function topN<K, V>(m: Map<K, V>, n: number, by: (v: V) => number): [K, V][] {
  return [...m.entries()].sort((a, b) => by(b[1]) - by(a[1])).slice(0, n);
}
