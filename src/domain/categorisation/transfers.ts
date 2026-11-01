import { daysBetween } from "../ingestion/dates";

/**
 * Internal transfer detection.
 *
 * Money moving between the household's own accounts (current → savings, or
 * Luke → partner's account for rent share) is not spending or income. If we
 * miss it, the dashboard double-counts: −£500 "spend" on one account and
 * +£500 "income" on the other.
 *
 * Match: opposite amounts, different accounts in the same household, within
 * 3 days (Faster Payments are instant, but statement dates can be posting
 * dates). Greedy closest-date pairing; each txn pairs at most once.
 */
export interface TransferCandidate {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  description: string;
}

export interface TransferPair {
  outId: string;
  inId: string;
  /** Both accounts owned by different people → partner transfer, else own transfer. */
}

const TRANSFER_HINT = /\b(?:transfer|tfr|to savings|from savings|pot|moved|faster payment|fpi|fpo|standing order|so)\b/i;

export function findTransferPairs(txns: TransferCandidate[], maxDays = 3): TransferPair[] {
  const outs = txns.filter((t) => t.amount < 0);
  const ins = txns.filter((t) => t.amount > 0);
  const byAmount = new Map<number, TransferCandidate[]>();
  for (const t of ins) {
    const list = byAmount.get(t.amount);
    if (list) list.push(t);
    else byAmount.set(t.amount, [t]);
  }
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  // Prefer outs whose text looks like a transfer, then larger amounts (less likely coincidental).
  const ordered = [...outs].sort(
    (a, b) => Number(TRANSFER_HINT.test(b.description)) - Number(TRANSFER_HINT.test(a.description)) || a.amount - b.amount,
  );
  for (const o of ordered) {
    const candidates = (byAmount.get(-o.amount) ?? [])
      .filter((i) => !used.has(i.id) && i.accountId !== o.accountId && Math.abs(daysBetween(o.date, i.date)) <= maxDays)
      .sort((a, b) => Math.abs(daysBetween(o.date, a.date)) - Math.abs(daysBetween(o.date, b.date)));
    const match = candidates[0];
    if (!match) continue;
    // Small round-number coincidences (two £5 payments) need a textual hint too.
    if (Math.abs(o.amount) < 2000 && !TRANSFER_HINT.test(o.description) && !TRANSFER_HINT.test(match.description)) continue;
    used.add(match.id);
    pairs.push({ outId: o.id, inId: match.id });
  }
  return pairs;
}
