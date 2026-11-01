/**
 * Core types for the statement ingestion pipeline.
 *
 * The pipeline is deliberately pure: bytes in → `ParseResult` out. No database,
 * no network, no logging of row contents. Persistence (staging rows, committing
 * to the ledger) happens in `commit.ts` behind the access layer. This keeps the
 * hardest code in the app trivially unit-testable against fixture statements.
 */

export type StatementFormat = "csv" | "ofx" | "qfx" | "pdf" | "txt";

/** Known institutions. `generic` = heuristics only. */
export type BankId =
  | "monzo"
  | "starling"
  | "revolut"
  | "barclays"
  | "hsbc"
  | "first_direct"
  | "natwest"
  | "rbs"
  | "ulster"
  | "lloyds"
  | "halifax"
  | "nationwide"
  | "santander"
  | "bank_of_ireland"
  | "aib"
  | "amex"
  | "vanquis"
  | "capital_one"
  | "zable"
  | "generic";

/**
 * Machine-readable reasons a row (or statement) is less than certain.
 * The review UI maps these to human copy; they also feed the confidence score.
 */
export type ParseWarning =
  | "date_order_ambiguous" // couldn't prove DD/MM vs MM/DD from the data; assumed UK
  | "year_inferred" // statement printed "05 Jan" with no year
  | "sign_inferred_from_balance" // single amount column with no sign; used balance delta
  | "sign_assumed" // no sign info at all; assumed debit
  | "sign_convention_inferred" // credit card: decided "positive = spend" from payment rows / majority
  | "multiline_merged" // description stitched from several lines
  | "balance_mismatch" // running balance doesn't agree with prev + amount
  | "zero_amount"
  | "pending_or_reverted_skipped" // statement-level: e.g. Revolut PENDING rows dropped
  | "unrecognised_layout" // generic parser used
  | "possible_duplicate"; // fuzzy match against existing ledger, needs a human

/** One transaction as extracted from a statement, before ledger concerns. */
export interface ParsedRow {
  /** Order on the statement (0-based) — stable id within a parse. */
  index: number;
  /** Calendar date, ISO `YYYY-MM-DD`. Strings avoid timezone footguns. */
  date: string;
  /** Signed minor units. Negative = money out. */
  amount: number;
  /** Cleaned description used for display & categorisation. */
  description: string;
  /** Exactly as found (multi-line parts joined with " | "). */
  rawDescription: string;
  runningBalance?: number;
  /** FITID / bank txn id when the source gives one — the best dedupe key. */
  externalId?: string;
  /** Hints the bank provided itself (Monzo/Starling categories). Used as a weak prior. */
  bankCategory?: string;
  warnings: ParseWarning[];
  /** 0..1 */
  confidence: number;
}

export interface StatementMeta {
  format: StatementFormat;
  bankId: BankId;
  /** e.g. "csv:monzo@1" — persisted so we can re-parse when a parser improves. */
  parserId: string;
  currency: string;
  periodStart?: string;
  periodEnd?: string;
  openingBalance?: number;
  closingBalance?: number;
  /** Last 4 digits only, if found. */
  maskedAccountNumber?: string;
  /** Statement-level type hint (credit card statements need sign care). */
  accountTypeHint?: "current" | "savings" | "credit_card";
}

export interface ParseResult {
  meta: StatementMeta;
  rows: ParsedRow[];
  /** Statement-wide warnings (not tied to a row). */
  warnings: ParseWarning[];
  /**
   * Did the rows reconcile? `true` = opening + Σamounts == closing, or every
   * running balance chained. `null` = not enough info to tell.
   */
  reconciled: boolean | null;
  /** 0..1 aggregate — what the review screen shows as "We're 97% sure". */
  confidence: number;
}

export interface ParseInput {
  bytes: Uint8Array;
  filename: string;
  mimeType?: string;
  /** If the user already picked an account, its bank/type sharpen detection. */
  hint?: { bankId?: BankId; accountType?: StatementMeta["accountTypeHint"] };
}

export class StatementParseError extends Error {
  constructor(
    public readonly code:
      | "unsupported_format"
      | "empty_file"
      | "no_transactions_found"
      | "encrypted_pdf"
      | "scanned_pdf_no_text"
      | "malformed",
    message: string,
  ) {
    super(message);
    this.name = "StatementParseError";
  }
}
