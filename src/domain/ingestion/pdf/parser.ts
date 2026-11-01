import { extractPdfLines, type PdfCell, type PdfLine } from "./extract";
import { detectDateOrder, looksLikeDate, parseDate, type DateOrder } from "../dates";
import { looksLikeAmount, parseAmount, type ParsedAmount } from "../money";
import { cleanDescription } from "../normalise";
import { checkTotals } from "../reconcile";
import { scoreRows, statementConfidence } from "../confidence";
import { detectPdfBank, PDF_BANK_TWEAKS } from "./banks";
import { looksLikeCardPayment } from "../cards";
import { StatementParseError, type ParseInput, type ParseResult, type ParseWarning, type ParsedRow } from "../types";

/**
 * Generic, geometry-based PDF statement parser.
 *
 * Rather than one hand-written parser per bank (which rot whenever a bank
 * tweaks its template), we parse the thing every UK statement has in common:
 * a table with a header row containing Date + some money columns. Bank-specific
 * knowledge lives in small `PDF_BANK_TWEAKS` overrides (see ./banks.ts).
 *
 * Hard cases this handles:
 *  • Debit / credit in separate columns  → sign from column position
 *  • Single "Amount" column               → sign from "-", "CR"/"DR", or balance deltas
 *  • Date printed once per day (HSBC, Barclays) → later rows inherit it
 *  • Multi-line descriptions — both layouts:
 *      "terminates": description lines first, amount on the LAST line (HSBC)
 *      "leads":      amount on the FIRST line, detail lines after (Monzo, Starling)
 *  • Page breaks: header repeated per page, "carried/brought forward" rows skipped
 *  • "05 Jan" with no year, incl. Dec→Jan rollover
 *  • Balances printed only at end of day → reconcile per balance group, and use
 *    the group equation to recover missing signs (small brute force, n ≤ 12)
 */

type ColKind = "date" | "description" | "type" | "out" | "in" | "amount" | "balance";
interface Column {
  kind: ColKind;
  x0: number;
  x1: number;
}
const MONEY_KINDS: ColKind[] = ["out", "in", "amount", "balance"];

const MONEY_SUFFIX = String.raw`(?:\s*\(?\s*(?:£|€|gbp|eur)\s*\)?)?`;
const HEADER_PATTERNS: [ColKind, RegExp][] = [
  ["date", /^(?:transaction |posting |posted |value |trans\.? )?date$/i],
  ["out", new RegExp(String.raw`^(?:paid out|money out|debits?|withdrawals?|payments? out|out|spent|debit amount)${MONEY_SUFFIX}$`, "i")],
  ["in", new RegExp(String.raw`^(?:paid in|money in|credits?|deposits?|payments? in|in|received|credit amount)${MONEY_SUFFIX}$`, "i")],
  ["balance", new RegExp(String.raw`^balance${MONEY_SUFFIX}$`, "i")],
  ["amount", new RegExp(String.raw`^(?:amount|value)${MONEY_SUFFIX}$`, "i")],
  ["type", /^(?:type|payment type)$/i],
  ["description", /^(?:description|details|transaction details|payment type and details|particulars|transaction|transactions|narrative|merchant|payee)$/i],
];

const OPENING_RE = /\b(?:balance\s+)?(?:brought\s+forward|b\/f|opening\s+balance|start(?:ing)?\s+balance|balance\s+at\s+start|previous\s+balance)\b/i;
const CLOSING_RE = /\b(?:balance\s+)?(?:carried\s+forward|c\/f|closing\s+balance|end(?:ing)?\s+balance|balance\s+at\s+end|new\s+balance)\b/i;
const SKIP_RE = /^(?:totals?|sub\s?total|page\s+\d|continued|statement\s+(?:no|number))\b/i;
const LEADING_DATE_RE =
  /^(\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?|\d{1,2}(?:st|nd|rd|th)?\s?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s\d{2,4}(?=\s|$))?)(?:\s+|$)/i;

interface ClassifiedLine {
  line: PdfLine;
  dateRaw?: string;
  desc: string[];
  out?: ParsedAmount;
  in?: ParsedAmount;
  amount?: ParsedAmount;
  balance?: ParsedAmount;
}

interface Txn {
  dateRaw: string;
  descParts: string[];
  magnitude: number;
  sign: -1 | 1 | null;
  signWarning?: ParseWarning;
  balance?: number;
}

export async function parsePdf(input: ParseInput): Promise<ParseResult> {
  const doc = await extractPdfLines(input.bytes);
  const bankId = input.hint?.bankId ?? detectPdfBank(doc.fullText);
  const tweaks = PDF_BANK_TWEAKS[bankId] ?? {};

  // ── 1. Walk pages, classify table lines ───────────────────────────────────
  const classified: ClassifiedLine[] = [];
  let opening: number | undefined;
  let closing: number | undefined;
  let columns: Column[] | null = null;
  let sawHeader = false;

  const byPage = groupBy(doc.lines, (l) => l.page);
  for (const [, pageLines] of byPage) {
    let inTable = false;
    let lastTableY = 0;
    for (const line of pageLines) {
      const header = detectHeader(line);
      if (header) {
        columns = header;
        sawHeader = true;
        inTable = true;
        lastTableY = line.y;
        continue;
      }
      // Continuation pages without a repeated header reuse the last column map,
      // starting at the first line that has a date or money in a money column.
      if (!columns) continue;
      if (!inTable) {
        const probe = classifyLine(line, columns);
        if (!(probe.dateRaw || hasTxnAmount(probe))) continue;
        inTable = true;
      }

      const text = line.text;
      if (OPENING_RE.test(text) || CLOSING_RE.test(text)) {
        const amt = lastMoney(line);
        if (amt) {
          const v = (amt.explicitSign ?? 1) * amt.minor;
          if (OPENING_RE.test(text) && opening === undefined && classified.length === 0) opening = v;
          if (CLOSING_RE.test(text)) closing = v;
        }
        lastTableY = line.y;
        continue;
      }
      if (SKIP_RE.test(text) || tweaks.skip?.some((re) => re.test(text))) continue;

      const c = classifyLine(line, columns);
      const isFragment = !c.dateRaw && !hasTxnAmount(c) && !c.balance;
      // A big vertical gap followed by plain text = we've left the table (footer, legal small print).
      if (isFragment && line.y - lastTableY > line.height * 2.6) {
        inTable = false;
        continue;
      }
      lastTableY = line.y;
      classified.push(c);
    }
  }
  if (!sawHeader) {
    throw new StatementParseError(
      "no_transactions_found",
      "Couldn't find a transactions table in this PDF. If your bank offers CSV or OFX downloads, those are more reliable.",
    );
  }

  // ── 2. Assemble transactions (multi-line + date inheritance) ──────────────
  const datedLines = classified.filter((c) => c.dateRaw);
  const leadRatio = datedLines.length ? datedLines.filter(hasTxnAmount).length / datedLines.length : 1;
  const mode: "leads" | "terminates" = tweaks.mode ?? (leadRatio >= 0.9 ? "leads" : "terminates");

  const signStyle = detectSignStyle(classified);
  const txns: Txn[] = [];
  let currentDate: string | undefined;
  let buffer: string[] = [];

  const makeTxn = (c: ClassifiedLine, parts: string[]): Txn | null => {
    if (!currentDate) return null;
    const { magnitude, sign, signWarning } = resolveSign(c, signStyle);
    return {
      dateRaw: currentDate,
      descParts: parts.filter(Boolean),
      magnitude,
      sign,
      signWarning,
      balance: c.balance ? (c.balance.explicitSign ?? 1) * c.balance.minor : undefined,
    };
  };

  for (const c of classified) {
    if (c.dateRaw) currentDate = c.dateRaw;
    if (mode === "terminates") {
      if (c.dateRaw && !hasTxnAmount(c)) buffer = [];
      if (hasTxnAmount(c)) {
        const t = makeTxn(c, [...buffer, ...c.desc]);
        if (t) txns.push(t);
        buffer = [];
      } else {
        buffer.push(...c.desc);
        // A balance-only line closes the day: attach to the previous txn.
        if (c.balance && txns.length) txns[txns.length - 1]!.balance = (c.balance.explicitSign ?? 1) * c.balance.minor;
      }
    } else {
      if (hasTxnAmount(c)) {
        const t = makeTxn(c, c.desc);
        if (t) txns.push(t);
      } else if (txns.length) {
        txns[txns.length - 1]!.descParts.push(...c.desc);
        if (c.balance) txns[txns.length - 1]!.balance = (c.balance.explicitSign ?? 1) * c.balance.minor;
      }
    }
  }
  if (txns.length === 0) throw new StatementParseError("no_transactions_found", "Found the table but no transactions in it.");

  // ── 3. Resolve signs via balance groups + reconcile ───────────────────────
  const isCard = input.hint?.accountType === "credit_card" || /\bcredit limit\b|\bminimum payment\b/i.test(doc.fullText);
  const recon = reconcileGroups(txns, opening, closing, isCard);

  // ── 4. Dates: order, year inference, Dec→Jan rollover ─────────────────────
  const { order, ambiguous } = detectDateOrder(txns.map((t) => t.dateRaw));
  const baseYear = findStatementYear(doc.fullText);
  const rows = buildRows(txns, order, ambiguous, baseYear);

  scoreRows(rows);
  const reconciled = recon.checks === 0 ? checkTotals(opening, closing, rows) : recon.failures === 0;
  const statementWarnings: ParseWarning[] = bankId === "generic" ? ["unrecognised_layout"] : [];
  const dates = rows.map((r) => r.date).sort();
  return {
    meta: {
      format: "pdf",
      bankId,
      parserId: `pdf:table@1${tweaks.mode ? `+${bankId}` : ""}`,
      currency: /€|\bEUR\b/.test(doc.fullText) && !/£/.test(doc.fullText) ? "EUR" : "GBP",
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      openingBalance: opening,
      closingBalance: closing,
      maskedAccountNumber: findMaskedAccount(doc.fullText),
      accountTypeHint: isCard ? "credit_card" : input.hint?.accountType,
    },
    rows,
    warnings: statementWarnings,
    reconciled,
    confidence: statementConfidence(rows, reconciled, statementWarnings),
  };
}

// ── Header & line classification ────────────────────────────────────────────

function detectHeader(line: PdfLine): Column[] | null {
  const cols: Column[] = [];
  for (const cell of line.cells) {
    const hit = HEADER_PATTERNS.find(([, re]) => re.test(cell.text.trim()));
    if (hit) cols.push({ kind: hit[0], x0: cell.x0, x1: cell.x1 });
  }
  const hasDate = cols.some((c) => c.kind === "date");
  const hasMoney = cols.some((c) => c.kind === "out" || c.kind === "in" || c.kind === "amount");
  return hasDate && hasMoney && cols.length >= 3 ? cols : null;
}

function classifyLine(line: PdfLine, cols: Column[]): ClassifiedLine {
  const out: ClassifiedLine = { line, desc: [] };
  const dateCol = cols.find((c) => c.kind === "date");
  const moneyCols = cols.filter((c) => MONEY_KINDS.includes(c.kind));
  const firstMoneyX = Math.min(...moneyCols.map((c) => c.x0));
  const lineH = line.height;

  for (const cell of line.cells) {
    let text = cell.text;
    // Date: only at the left, in or near the date column.
    if (!out.dateRaw && dateCol && cell.x0 <= dateCol.x1 + lineH * 2) {
      const m = text.match(LEADING_DATE_RE);
      if (m && looksLikeDate(m[1]!)) {
        out.dateRaw = m[1]!;
        text = text.slice(m[0].length).trim();
        if (!text) continue;
      }
    }
    if (looksLikeAmount(text) && cell.x1 > firstMoneyX - lineH * 2) {
      const col = nearestColumn(cell, moneyCols);
      const amt = parseAmount(text);
      if (col && amt && out[col.kind as "out"] === undefined) {
        out[col.kind as "out" | "in" | "amount" | "balance"] = amt;
        continue;
      }
    }
    out.desc.push(text);
  }
  return out;
}

/** Money is usually right-aligned under headers that may be left-, centre- or right-aligned. */
function nearestColumn(cell: PdfCell, cols: Column[]): Column | undefined {
  let best: Column | undefined;
  let bestD = Infinity;
  const cc = (cell.x0 + cell.x1) / 2;
  for (const c of cols) {
    const d = Math.min(Math.abs(cell.x1 - c.x1), Math.abs(cc - (c.x0 + c.x1) / 2), Math.abs(cell.x0 - c.x0));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function hasTxnAmount(c: ClassifiedLine): boolean {
  return Boolean(c.out || c.in || c.amount);
}

function lastMoney(line: PdfLine): ParsedAmount | null {
  for (let i = line.cells.length - 1; i >= 0; i--) {
    const t = line.cells[i]!.text;
    if (looksLikeAmount(t)) return parseAmount(t);
  }
  return null;
}

// ── Signs ───────────────────────────────────────────────────────────────────

type SignStyle = "minus_marks_debit" | "cr_marks_credit" | "unknown";

/**
 * In single-amount-column layouts, banks mark ONE direction and leave the other
 * bare. Look at the whole statement to learn which convention is in play.
 */
function detectSignStyle(lines: ClassifiedLine[]): SignStyle {
  const amounts = lines.map((l) => l.amount).filter((a): a is ParsedAmount => !!a);
  const neg = amounts.filter((a) => a.explicitSign === -1).length;
  const pos = amounts.filter((a) => a.explicitSign === 1).length;
  const bare = amounts.filter((a) => a.explicitSign === null).length;
  if (bare === 0) return "unknown";
  if (neg > 0 && pos === 0) return "minus_marks_debit";
  if (pos > 0 && neg === 0) return "cr_marks_credit";
  return "unknown";
}

function resolveSign(c: ClassifiedLine, style: SignStyle): Pick<Txn, "magnitude" | "sign" | "signWarning"> {
  if (c.out) return { magnitude: c.out.minor, sign: -1 };
  if (c.in) return { magnitude: c.in.minor, sign: 1 };
  const a = c.amount!;
  if (a.explicitSign !== null) return { magnitude: a.minor, sign: a.explicitSign };
  if (style === "minus_marks_debit") return { magnitude: a.minor, sign: 1 };
  if (style === "cr_marks_credit") return { magnitude: a.minor, sign: -1 };
  return { magnitude: a.minor, sign: null };
}

/**
 * Walk the statement in balance-delimited groups:
 *   lastBalance + Σ sign·amount = printedBalance
 * Every group with no unknown signs is a reconciliation check. Groups with
 * unknown signs are solved by trying sign combinations — if exactly one fits,
 * the balance has *proved* the signs.
 */
function reconcileGroups(txns: Txn[], opening?: number, closing?: number, isCard = false): { checks: number; failures: number } {
  // With nothing to solve against, card statements still have a strong tell:
  // payments to the card are credits, everything else is spend.
  const fallback = (t: Txn): [-1 | 1, ParseWarning] =>
    isCard ? [looksLikeCardPayment(t.descParts.join(" ")) ? 1 : -1, "sign_convention_inferred"] : [-1, "sign_assumed"];
  let last = opening;
  let group: Txn[] = [];
  let checks = 0;
  let failures = 0;

  const settle = (target: number | undefined) => {
    if (last === undefined || target === undefined) {
      for (const t of group) if (t.sign === null) [t.sign, t.signWarning] = fallback(t);
      return;
    }
    const unknown = group.filter((t) => t.sign === null);
    const known = group.filter((t) => t.sign !== null).reduce((s, t) => s + t.sign! * t.magnitude, 0);
    const need = target - last - known;
    if (unknown.length === 0) {
      checks++;
      if (need !== 0) {
        failures++;
        for (const t of group) t.signWarning = "balance_mismatch";
      }
      return;
    }
    const solution = unknown.length <= 12 ? solveSigns(unknown.map((t) => t.magnitude), need) : null;
    if (solution) {
      checks++;
      unknown.forEach((t, i) => ([t.sign, t.signWarning] = [solution[i]!, "sign_inferred_from_balance"]));
    } else {
      for (const t of unknown) [t.sign, t.signWarning] = fallback(t);
    }
  };

  for (const t of txns) {
    group.push(t);
    if (t.balance !== undefined) {
      settle(t.balance);
      last = t.balance;
      group = [];
    }
  }
  if (group.length) settle(closing);
  else if (closing !== undefined && last !== undefined) {
    checks++;
    if (closing !== last) failures++;
  }
  return { checks, failures };
}

/** Unique ±1 assignment s.t. Σ s_i·a_i = target, or null if none/ambiguous. */
function solveSigns(mags: number[], target: number): (-1 | 1)[] | null {
  let found: (-1 | 1)[] | null = null;
  const n = mags.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += mask & (1 << i) ? mags[i]! : -mags[i]!;
    if (sum === target) {
      const sol = mags.map((_, i) => (mask & (1 << i) ? 1 : -1)) as (-1 | 1)[];
      if (found && found.some((s, i) => s !== sol[i])) return null; // ambiguous
      found = sol;
    }
  }
  return found;
}

// ── Rows & dates ────────────────────────────────────────────────────────────

function buildRows(txns: Txn[], order: DateOrder, ambiguous: boolean, baseYear: number): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let yearOffset = 0;
  let prevMonth = 0;
  for (const t of txns) {
    const warnings: ParseWarning[] = [];
    let d = parseDate(t.dateRaw, { order, fallbackYear: baseYear + yearOffset });
    if (!d) continue;
    if (d.yearInferred) {
      const month = +d.iso.slice(5, 7);
      // Dec → Jan on a statement spanning new year.
      if (prevMonth && month < prevMonth - 6) {
        yearOffset++;
        d = parseDate(t.dateRaw, { order, fallbackYear: baseYear + yearOffset })!;
      }
      warnings.push("year_inferred");
    }
    prevMonth = +d.iso.slice(5, 7);
    if (ambiguous) warnings.push("date_order_ambiguous");
    if (t.descParts.length > 1) warnings.push("multiline_merged");
    if (t.signWarning) warnings.push(t.signWarning);
    const amount = (t.sign ?? -1) * t.magnitude;
    if (amount === 0) warnings.push("zero_amount");
    const rawDescription = t.descParts.join(" | ");
    rows.push({
      index: rows.length,
      date: d.iso,
      amount,
      description: cleanDescription(t.descParts[0] ? t.descParts.join(" ") : "Unknown"),
      rawDescription,
      runningBalance: t.balance,
      warnings,
      confidence: 1,
    });
  }
  return rows;
}

const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/**
 * The year a statement STARTS in. Prefers an explicit period
 * ("1 December 2025 to 31 January 2026", "01 Dec - 31 Jan 2026"), then the
 * most common year in a date-like context, then the current year.
 */
export function findStatementYear(text: string): number {
  const range = new RegExp(
    String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(${MONTH_NAMES})\s*(\d{4})?\s*(?:to|-|–|until)\s*\d{1,2}(?:st|nd|rd|th)?\s+(${MONTH_NAMES})\s+(\d{4})`,
    "i",
  ).exec(text);
  if (range) {
    if (range[2]) return +range[2];
    const startM = monthIndex(range[1]!);
    const endM = monthIndex(range[3]!);
    return startM > endM ? +range[4]! - 1 : +range[4]!;
  }
  const counts = new Map<number, number>();
  const re = new RegExp(String.raw`(?:(?:${MONTH_NAMES})\s+|\d{1,2}[/.\-]\d{1,2}[/.\-])(20\d{2})\b`, "gi");
  for (const m of text.matchAll(re)) counts.set(+m[1]!, (counts.get(+m[1]!) ?? 0) + 1);
  if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  return new Date().getUTCFullYear();
}

function monthIndex(name: string): number {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function findMaskedAccount(text: string): string | undefined {
  const m = text.match(/account\s*(?:no\.?|number)\s*:?\s*(?:\d{2}-\d{2}-\d{2}\s+)?[*\dX ]*?(\d{4})\b/i);
  return m?.[1];
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const t of arr) {
    const k = key(t);
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  }
  return m;
}
