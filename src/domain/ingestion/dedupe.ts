import { createHash } from "node:crypto";
import { daysBetween } from "./dates";
import { similarity } from "./normalise";
import type { ParsedRow, ParseWarning } from "./types";

/**
 * De-duplication across overlapping statements.
 *
 * Users upload "the last 3 months" and then next month upload "the last 3
 * months" again, or a CSV and the PDF of the same period. Three layers:
 *
 *  1. externalId (FITID / Monzo tx id) — exact, bank-issued. Best possible.
 *  2. fingerprint = (date, amount, occurrence-of-that-pair-on-that-day).
 *     Description is deliberately EXCLUDED: the same transaction reads
 *     "TESCO STORES 3021" in the CSV and "CARD PAYMENT TO TESCO..." in the PDF.
 *     `occurrence` keeps two genuine £3.20 coffees on the same day distinct —
 *     and because statements cut on day boundaries, every statement covering
 *     that day sees both and numbers them identically.
 *  3. Fuzzy: same amount, dates within ±3 days, similar description. Handles
 *     posted-vs-transaction date drift between formats. NOT auto-dropped —
 *     flagged `possible_duplicate` for the user to decide.
 */

export interface LedgerTxn {
  id: string;
  date: string; // ISO
  amount: number;
  description: string;
  externalId?: string | null;
  fingerprint: string;
}

export type Disposition =
  | { kind: "new" }
  | { kind: "duplicate"; of: string; via: "external_id" | "fingerprint" }
  | { kind: "possible_duplicate"; of: string; score: number };

export interface StagedRow extends ParsedRow {
  fingerprint: string;
  disposition: Disposition;
}

export function fingerprintFor(accountId: string, date: string, amount: number, occurrence: number): string {
  return createHash("sha256").update(`${accountId}|${date}|${amount}|${occurrence}`).digest("hex").slice(0, 32);
}

/** Attach fingerprints using per-(date, amount) occurrence counters. Order-independent within a day. */
export function fingerprintRows(accountId: string, rows: ParsedRow[]): (ParsedRow & { fingerprint: string })[] {
  // Sort a copy so occurrence numbering doesn't depend on asc/desc statement order.
  const ordered = [...rows].sort((a, b) => (a.date === b.date ? a.index - b.index : a.date < b.date ? -1 : 1));
  const seen = new Map<string, number>();
  const fp = new Map<number, string>();
  for (const r of ordered) {
    const k = `${r.date}|${r.amount}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    fp.set(r.index, fingerprintFor(accountId, r.date, r.amount, n));
  }
  return rows.map((r) => ({ ...r, fingerprint: fp.get(r.index)! }));
}

const FUZZY_DAYS = 3;
const FUZZY_MIN_SIMILARITY = 0.45;

export function classifyAgainstLedger(accountId: string, rows: ParsedRow[], ledger: LedgerTxn[]): StagedRow[] {
  const byExternal = new Map(ledger.filter((t) => t.externalId).map((t) => [t.externalId!, t]));
  const byFingerprint = new Map(ledger.map((t) => [t.fingerprint, t]));
  const byAmount = new Map<number, LedgerTxn[]>();
  for (const t of ledger) {
    const list = byAmount.get(t.amount);
    if (list) list.push(t);
    else byAmount.set(t.amount, [t]);
  }
  // A ledger txn can only be "claimed" once — two rows can't both duplicate it.
  const claimed = new Set<string>();

  return fingerprintRows(accountId, rows).map((r) => {
    const ext = r.externalId ? byExternal.get(r.externalId) : undefined;
    if (ext && !claimed.has(ext.id)) {
      claimed.add(ext.id);
      return { ...r, disposition: { kind: "duplicate", of: ext.id, via: "external_id" } };
    }
    const fpHit = byFingerprint.get(r.fingerprint);
    // If both sides have external ids and they differ, it's NOT the same txn.
    if (fpHit && !claimed.has(fpHit.id) && !(r.externalId && fpHit.externalId && r.externalId !== fpHit.externalId)) {
      claimed.add(fpHit.id);
      return { ...r, disposition: { kind: "duplicate", of: fpHit.id, via: "fingerprint" } };
    }
    let best: { t: LedgerTxn; score: number } | undefined;
    for (const t of byAmount.get(r.amount) ?? []) {
      if (claimed.has(t.id) || Math.abs(daysBetween(t.date, r.date)) > FUZZY_DAYS) continue;
      const score = similarity(t.description, r.description);
      if (score >= FUZZY_MIN_SIMILARITY && (!best || score > best.score)) best = { t, score };
    }
    if (best) {
      claimed.add(best.t.id);
      const warnings: ParseWarning[] = r.warnings.includes("possible_duplicate") ? r.warnings : [...r.warnings, "possible_duplicate"];
      return { ...r, warnings, disposition: { kind: "possible_duplicate", of: best.t.id, score: Math.round(best.score * 100) / 100 } };
    }
    return { ...r, disposition: { kind: "new" } };
  });
}
