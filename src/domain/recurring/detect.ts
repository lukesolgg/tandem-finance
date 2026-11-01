import { addDays, daysBetween } from "../ingestion/dates";

/**
 * Recurring payment detection — pure.
 *
 * Group by merchant + direction, then look for a stable gap between dates.
 * UK specifics: "four-weekly" (13/yr, common for salaries and some bills) is
 * distinct from monthly; monthly DDs drift ±3 days around weekends/bank
 * holidays. Amount can vary (utilities) — we report the coefficient of
 * variation so the UI can say "~£80, varies".
 */
export type Cadence = "weekly" | "fortnightly" | "four_weekly" | "monthly" | "quarterly" | "annual";

const CADENCES: { cadence: Cadence; days: number; tolerance: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 1 },
  { cadence: "fortnightly", days: 14, tolerance: 2 },
  { cadence: "four_weekly", days: 28, tolerance: 1 },
  { cadence: "monthly", days: 30.44, tolerance: 4 },
  { cadence: "quarterly", days: 91.3, tolerance: 7 },
  { cadence: "annual", days: 365.25, tolerance: 10 },
];

export interface RecurringInput {
  id: string;
  merchantKey: string;
  date: string;
  amount: number;
}

export interface RecurringSeriesGuess {
  merchantKey: string;
  cadence: Cadence;
  typicalAmount: number; // median
  amountVariance: number; // coefficient of variation
  transactionIds: string[];
  lastDate: string;
  nextExpected: string;
}

export function detectRecurring(txns: RecurringInput[], minOccurrences = 3): RecurringSeriesGuess[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const t of txns) {
    const k = `${t.merchantKey}|${t.amount < 0 ? "out" : "in"}`;
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const out: RecurringSeriesGuess[] = [];
  for (const g of groups.values()) {
    if (g.length < minOccurrences) continue;
    g.sort((a, b) => (a.date < b.date ? -1 : 1));
    // Collapse same-day duplicates (e.g. split payments) for gap analysis.
    const dates = [...new Set(g.map((t) => t.date))];
    if (dates.length < minOccurrences) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
    const med = median(gaps);
    // Monthly is checked before four-weekly when the median is ambiguous (28–31).
    const ordered = med >= 29 ? [...CADENCES].sort((a, b) => (a.cadence === "monthly" ? -1 : b.cadence === "monthly" ? 1 : 0)) : CADENCES;
    const match = ordered.find((c) => gaps.filter((x) => Math.abs(x - c.days) <= c.tolerance).length >= Math.ceil(gaps.length * 0.75));
    if (!match) continue;
    const amounts = g.map((t) => Math.abs(t.amount));
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length);
    const cv = mean ? sd / mean : 0;
    if (cv > 0.5) continue; // too irregular to be a bill
    const last = dates[dates.length - 1]!;
    out.push({
      merchantKey: g[0]!.merchantKey,
      cadence: match.cadence,
      typicalAmount: Math.sign(g[0]!.amount) * median(amounts),
      amountVariance: Math.round(cv * 100) / 100,
      transactionIds: g.map((t) => t.id),
      lastDate: last,
      nextExpected: nextDate(last, match.cadence),
    });
  }
  return out;
}

function nextDate(last: string, c: Cadence): string {
  if (c === "monthly" || c === "quarterly" || c === "annual") {
    const d = new Date(last + "T00:00:00Z");
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (c === "monthly" ? 1 : c === "quarterly" ? 3 : 12));
    const max = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, max));
    return d.toISOString().slice(0, 10);
  }
  return addDays(last, CADENCES.find((x) => x.cadence === c)!.days);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
