import Papa from "papaparse";
import { decodeText } from "../detect";
import { detectDateOrder, parseDate } from "../dates";
import { parseAmount } from "../money";
import { cleanDescription } from "../normalise";
import { applyReconciliation } from "../reconcile";
import { scoreRows, statementConfidence } from "../confidence";
import { cardNeedsInversion } from "../cards";
import { CSV_PROFILES, GENERIC_SYNONYMS, normHeader, type CsvProfile } from "./profiles";
import { StatementParseError, type ParseInput, type ParseResult, type ParseWarning, type ParsedRow } from "../types";

/** How many leading lines to scan for the header (Nationwide prints 3–4 lines of account info first). */
const HEADER_SCAN_LINES = 25;

type Grid = string[][];

/**
 * CSV pipeline:
 *  1. decode + let Papa sniff the delimiter (`,` `;` `\t`)
 *  2. find the header row: best-matching bank profile, else generic synonyms,
 *     else a headerless 3-column "date, description, amount" layout (HSBC/First Direct)
 *  3. map columns → rows; skip pending/reverted where the bank tells us
 *  4. detect DD/MM vs MM/DD across the whole date column
 *  5. reconcile running balances, score confidence
 */
export function parseCsv(input: ParseInput): ParseResult {
  const text = decodeText(input.bytes);
  if (!text.trim()) throw new StatementParseError("empty_file", "The file is empty.");

  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter: "" });
  const grid: Grid = parsed.data.map((r) => r.map((c) => (c ?? "").trim()));
  if (grid.length === 0) throw new StatementParseError("empty_file", "No rows found.");

  const located = locateLayout(grid, input.hint?.bankId);
  if (!located) {
    throw new StatementParseError(
      "malformed",
      "Couldn't find date and amount columns in this CSV. Try exporting as OFX, or map the columns manually.",
    );
  }
  const { profile, headerRow, colIndex, generic } = located;
  const body = grid.slice(headerRow + 1);

  const get = (row: string[], name: string | undefined): string => {
    if (!name) return "";
    const i = colIndex.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const firstOf = (row: string[], names: string[]) => {
    for (const n of names) {
      const v = get(row, n);
      if (v) return v;
    }
    return "";
  };

  const dateSamples = body.map((r) => firstOf(r, profile.columns.date)).filter(Boolean);
  const { order, ambiguous } = detectDateOrder(dateSamples);

  const statementWarnings: ParseWarning[] = [];
  if (generic) statementWarnings.push("unrecognised_layout");

  const rows: ParsedRow[] = [];
  let skippedStatus = 0;
  for (const r of body) {
    if (profile.columns.status && profile.keepStatuses) {
      const st = get(r, profile.columns.status).toUpperCase();
      if (st && !profile.keepStatuses.includes(st)) {
        skippedStatus++;
        continue;
      }
    }
    const dateRaw = firstOf(r, profile.columns.date);
    const date = parseDate(dateRaw, { order });
    if (!date) continue; // footer / totals / blank line

    const warnings: ParseWarning[] = [];
    if (ambiguous) warnings.push("date_order_ambiguous");

    let amount: number | null = null;
    if (profile.columns.amount) {
      const a = parseAmount(get(r, profile.columns.amount));
      if (a) {
        amount = (a.explicitSign ?? 1) * a.minor;
        if (profile.amountConvention === "inverted") amount = -amount;
        const fee = parseAmount(get(r, profile.columns.fee));
        if (fee) amount -= fee.minor; // Revolut fees are positive and always reduce the amount
      }
    } else {
      // Split debit/credit columns. Some banks put "-12.00" in the debit column; take abs either way.
      const out = parseAmount(get(r, profile.columns.out));
      const inn = parseAmount(get(r, profile.columns.in));
      if (out && out.minor > 0) amount = -out.minor;
      else if (inn && inn.minor > 0) amount = inn.minor;
      else if (out || inn) amount = 0;
    }
    if (amount === null) continue;

    // Display description = first non-empty description column (Monzo "Name",
    // Starling "Counter Party"); raw keeps every column for search & provenance.
    const descParts = profile.columns.description
      .map((c) => get(r, c).replace(/^'/, "")) // NatWest prefixes descriptions with an apostrophe
      .filter(Boolean);
    const rawDescription = descParts.join(" | ");

    // Starling (and others) emit a synthetic £0 "Opening Balance" row. It's not a transaction.
    if (amount === 0 && /\b(?:opening|closing) balance\b/i.test(rawDescription)) continue;
    if (amount === 0) warnings.push("zero_amount");

    const bal = profile.columns.balance ? parseAmount(get(r, profile.columns.balance)) : null;

    rows.push({
      index: rows.length,
      date: date.iso,
      amount,
      description: cleanDescription(descParts[0] ?? "Unknown"),
      rawDescription,
      runningBalance: bal ? (bal.explicitSign ?? 1) * bal.minor : undefined,
      externalId: get(r, profile.columns.externalId) || undefined,
      bankCategory: get(r, profile.columns.bankCategory) || undefined,
      warnings,
      confidence: 1,
    });
  }

  if (skippedStatus > 0) statementWarnings.push("pending_or_reverted_skipped");
  if (rows.length === 0) throw new StatementParseError("no_transactions_found", "No transactions found in this file.");

  // Credit cards with one amount column: work out whether spend is printed positive.
  const isCard = (profile.accountTypeHint ?? input.hint?.accountType) === "credit_card";
  if (isCard && profile.columns.amount && !profile.amountConvention) {
    const { invert, warning } = cardNeedsInversion(rows);
    if (invert) {
      for (const r of rows) {
        r.amount = -r.amount;
        if (r.runningBalance !== undefined) r.runningBalance = -r.runningBalance;
        if (warning) r.warnings.push(warning);
      }
    }
  }

  const rec = applyReconciliation(rows, {});
  scoreRows(rows);

  const dates = rows.map((r) => r.date).sort();
  return {
    meta: {
      format: "csv",
      bankId: profile.bankId,
      parserId: `csv:${profile.id}@${profile.version}`,
      currency: "GBP",
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      openingBalance: rec.opening,
      closingBalance: rec.closing,
      accountTypeHint: profile.accountTypeHint ?? input.hint?.accountType,
    },
    rows,
    warnings: statementWarnings,
    reconciled: rec.reconciled,
    confidence: statementConfidence(rows, rec.reconciled, statementWarnings),
  };
}

// ── Layout resolution ───────────────────────────────────────────────────────

interface Located {
  profile: CsvProfile;
  headerRow: number; // -1 for headerless
  colIndex: Map<string, number>;
  generic: boolean;
}

function locateLayout(grid: Grid, hintBank?: string): Located | null {
  const scan = Math.min(grid.length, HEADER_SCAN_LINES);

  // 1. Known profiles — longest signature wins (most specific).
  let best: Located | null = null;
  let bestLen = 0;
  for (let i = 0; i < scan; i++) {
    const headers = grid[i]!.map(normHeader);
    const set = new Set(headers);
    for (const p of CSV_PROFILES) {
      if (p.signature.every((h) => set.has(h)) && p.signature.length > bestLen) {
        bestLen = p.signature.length;
        best = { profile: p, headerRow: i, colIndex: indexOf(headers), generic: false };
      }
    }
  }
  if (best) {
    // NatWest Group / Lloyds Group exports are identical across brands; trust the user's account choice.
    if (hintBank && ["natwest", "rbs", "ulster", "lloyds", "halifax"].includes(hintBank)) {
      best.profile = { ...best.profile, bankId: hintBank as CsvProfile["bankId"] };
    }
    return best;
  }

  // 2. Generic header synonyms.
  for (let i = 0; i < scan; i++) {
    const headers = grid[i]!.map(normHeader);
    const pick = (syn: readonly string[]) => syn.find((s) => headers.includes(s));
    const date = pick(GENERIC_SYNONYMS.date);
    const amount = pick(GENERIC_SYNONYMS.amount);
    const out = pick(GENERIC_SYNONYMS.out);
    const inn = pick(GENERIC_SYNONYMS.in);
    if (!date || (!amount && !(out && inn))) continue;
    const descs = GENERIC_SYNONYMS.description.filter((s) => headers.includes(s));
    const profile: CsvProfile = {
      id: "generic",
      version: 1,
      bankId: "generic",
      signature: [],
      columns: {
        date: [date],
        description: descs.slice(0, 2),
        amount: amount && !(out && inn) ? amount : undefined,
        out: out && inn ? out : undefined,
        in: out && inn ? inn : undefined,
        balance: pick(GENERIC_SYNONYMS.balance),
      },
    };
    return { profile, headerRow: i, colIndex: indexOf(headers), generic: true };
  }

  // 3. Headerless "date, description, amount[, balance]" (HSBC / First Direct export).
  const first = grid[0]!;
  if (first.length >= 3 && parseDate(first[0]!) && parseAmount(first[2]!)) {
    const colIndex = new Map<string, number>([
      ["date", 0],
      ["description", 1],
      ["amount", 2],
    ]);
    if (first.length >= 4 && parseAmount(first[3]!)) colIndex.set("balance", 3);
    const bankId = hintBank === "first_direct" ? "first_direct" : "hsbc";
    return {
      profile: {
        id: "headerless_dda",
        version: 1,
        bankId,
        signature: [],
        columns: { date: ["date"], description: ["description"], amount: "amount", balance: colIndex.has("balance") ? "balance" : undefined },
      },
      headerRow: -1,
      colIndex,
      generic: false,
    };
  }
  return null;
}

function indexOf(headers: string[]): Map<string, number> {
  const m = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!m.has(h)) m.set(h, i);
  });
  return m;
}
