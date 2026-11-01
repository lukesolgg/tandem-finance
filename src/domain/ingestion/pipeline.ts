import { createHash } from "node:crypto";
import { detectFormat } from "./detect";
import { parseCsv } from "./csv/parser";
import { parseOfx } from "./ofx/parser";
import { parsePdf } from "./pdf/parser";
import { parseSantanderTxt } from "./santander/parser";
import { classifyAgainstLedger, type LedgerTxn, type StagedRow } from "./dedupe";
import { REVIEW_THRESHOLD, rowConfidence, statementConfidence } from "./confidence";
import { StatementParseError, type ParseInput, type ParseResult } from "./types";

export const MAX_STATEMENT_BYTES = 15 * 1024 * 1024;

/**
 * Entry point: bytes → ParseResult. Pure; safe to run in a worker/queue.
 *
 * Format priority is implicit: we parse what we're given, but the UI nudges
 * users toward CSV/OFX for their bank (structured > PDF), and `confidence`
 * makes the difference visible.
 */
export async function parseStatement(input: ParseInput): Promise<ParseResult> {
  if (input.bytes.length === 0) throw new StatementParseError("empty_file", "The file is empty.");
  if (input.bytes.length > MAX_STATEMENT_BYTES) throw new StatementParseError("malformed", "File is larger than 15 MB.");
  const format = detectFormat(input.bytes, input.filename);
  switch (format) {
    case "csv":
      return parseCsv(input);
    case "ofx":
    case "qfx":
      return parseOfx(input, format);
    case "pdf":
      return parsePdf(input);
    case "txt":
      return parseSantanderTxt(input);
    default:
      throw new StatementParseError("unsupported_format", "Upload a PDF, CSV, OFX or QFX statement.");
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ReviewModel {
  result: ParseResult;
  rows: StagedRow[];
  summary: {
    total: number;
    new: number;
    duplicates: number;
    possibleDuplicates: number;
    needsAttention: number; // rows below REVIEW_THRESHOLD
    moneyIn: number;
    moneyOut: number;
  };
  /** True when we're confident enough to offer one-click "Import all". */
  canQuickCommit: boolean;
}

/**
 * Stage a parse for the review screen: dedupe against the account's ledger,
 * re-score (duplicate flags lower confidence), and summarise.
 */
export function buildReview(accountId: string, result: ParseResult, ledger: LedgerTxn[]): ReviewModel {
  const rows = classifyAgainstLedger(accountId, result.rows, ledger).map((r) => ({
    ...r,
    confidence: rowConfidence(r.warnings),
  }));
  const fresh = rows.filter((r) => r.disposition.kind === "new");
  const summary = {
    total: rows.length,
    new: fresh.length,
    duplicates: rows.filter((r) => r.disposition.kind === "duplicate").length,
    possibleDuplicates: rows.filter((r) => r.disposition.kind === "possible_duplicate").length,
    needsAttention: rows.filter((r) => r.confidence < REVIEW_THRESHOLD).length,
    moneyIn: fresh.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0),
    moneyOut: fresh.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0),
  };
  const confidence = statementConfidence(rows, result.reconciled, result.warnings);
  return {
    result: { ...result, confidence },
    rows,
    summary,
    canQuickCommit: summary.needsAttention === 0 && confidence >= 0.9,
  };
}
