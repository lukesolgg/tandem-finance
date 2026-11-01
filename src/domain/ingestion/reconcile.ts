import type { ParsedRow } from "./types";

/**
 * Balance reconciliation — the single strongest correctness signal we have.
 *
 * If a statement prints running balances, every row must satisfy
 *   balance[i] = balance[i-1] + amount[i]      (oldest-first)
 * or
 *   balance[i] = balance[i+1] + amount[i]      (newest-first, typical for CSV)
 * A clean chain proves dates were assigned to the right rows, signs are right,
 * and no row was dropped or duplicated. That's what lets us show "100% match"
 * on the review screen and skip forcing the user to eyeball every row.
 */
export interface ChainResult {
  order: "asc" | "desc";
  /** Pairs that chained / pairs checked. */
  matched: number;
  checked: number;
  /** Indices (into the input array) whose balance didn't chain. */
  mismatched: number[];
  openingBalance?: number;
  closingBalance?: number;
}

export function checkRunningBalances(rows: Pick<ParsedRow, "amount" | "runningBalance">[]): ChainResult | null {
  const withBal = rows.filter((r) => r.runningBalance !== undefined);
  if (withBal.length < 2 || withBal.length !== rows.length) return null;

  const score = (order: "asc" | "desc") => {
    const mismatched: number[] = [];
    let matched = 0;
    for (let i = 1; i < rows.length; i++) {
      // In "desc", row i-1 is newer than row i.
      const [prev, cur] = order === "asc" ? [rows[i - 1]!, rows[i]!] : [rows[i]!, rows[i - 1]!];
      if (prev.runningBalance! + cur.amount === cur.runningBalance) matched++;
      else mismatched.push(order === "asc" ? i : i - 1);
    }
    return { matched, mismatched };
  };
  const asc = score("asc");
  const desc = score("desc");
  const order = desc.matched > asc.matched ? "desc" : "asc";
  const best = order === "asc" ? asc : desc;
  const first = order === "asc" ? rows[0]! : rows[rows.length - 1]!;
  const last = order === "asc" ? rows[rows.length - 1]! : rows[0]!;
  return {
    order,
    matched: best.matched,
    checked: rows.length - 1,
    mismatched: best.mismatched,
    openingBalance: first.runningBalance! - first.amount,
    closingBalance: last.runningBalance!,
  };
}

/** opening + Σ amounts == closing. Works for statements with only brought/carried-forward totals. */
export function checkTotals(opening: number | undefined, closing: number | undefined, rows: Pick<ParsedRow, "amount">[]): boolean | null {
  if (opening === undefined || closing === undefined) return null;
  return opening + rows.reduce((s, r) => s + r.amount, 0) === closing;
}

/**
 * Apply the chain result to rows: flag mismatches, and return the statement-level
 * reconciled flag. Mutates `rows[i].warnings`.
 */
export function applyReconciliation(
  rows: ParsedRow[],
  declared: { opening?: number; closing?: number },
): { reconciled: boolean | null; opening?: number; closing?: number } {
  const chain = checkRunningBalances(rows);
  if (chain) {
    for (const i of chain.mismatched) {
      const w = rows[i]!.warnings;
      if (!w.includes("balance_mismatch")) w.push("balance_mismatch");
    }
    const opening = declared.opening ?? chain.openingBalance;
    const closing = declared.closing ?? chain.closingBalance;
    const totals = checkTotals(opening, closing, rows);
    return {
      reconciled: chain.mismatched.length === 0 && totals !== false,
      opening,
      closing,
    };
  }
  return { reconciled: checkTotals(declared.opening, declared.closing, rows), opening: declared.opening, closing: declared.closing };
}
