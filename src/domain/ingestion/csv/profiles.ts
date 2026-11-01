import type { BankId } from "../types";

/**
 * Declarative CSV layouts for UK/IE banks.
 *
 * Adding a bank = adding an object here + a fixture test. No parser code.
 * Header names are compared after `normHeader()` (lower-case, collapsed spaces,
 * quotes stripped). `signature` headers must ALL be present for a match; the
 * profile with the longest matching signature wins, so specific beats generic.
 *
 * Sources: each bank's current web-banking CSV export (2025–26). Banks change
 * these without notice — when they do, the generic resolver below still gets a
 * usable parse at lower confidence, and the parserId tells us which to fix.
 */
export interface CsvProfile {
  id: string; // stable, part of parserId
  version: number;
  bankId: BankId;
  signature: string[];
  columns: {
    date: string[]; // first non-empty wins (Revolut: Completed Date, then Started Date)
    description: string[]; // non-empty values joined with " " (Starling: counterparty + reference)
    amount?: string;
    out?: string;
    in?: string;
    fee?: string; // subtracted from amount (Revolut)
    balance?: string;
    externalId?: string;
    bankCategory?: string;
    status?: string;
  };
  /** "inverted": positive = money out (Amex and some card exports). */
  amountConvention?: "signed" | "inverted";
  /** Row is kept only if status (upper-cased) is in this set. */
  keepStatuses?: string[];
  accountTypeHint?: "current" | "savings" | "credit_card";
}

export const CSV_PROFILES: CsvProfile[] = [
  {
    id: "monzo",
    version: 1,
    bankId: "monzo",
    signature: ["transaction id", "date", "name", "amount", "category", "local amount"],
    columns: {
      date: ["date"],
      description: ["name", "description"],
      amount: "amount",
      externalId: "transaction id",
      bankCategory: "category",
    },
  },
  {
    id: "starling",
    version: 1,
    bankId: "starling",
    signature: ["date", "counter party", "reference", "amount (gbp)", "balance (gbp)"],
    columns: {
      date: ["date"],
      description: ["counter party", "reference"],
      amount: "amount (gbp)",
      balance: "balance (gbp)",
      bankCategory: "spending category",
    },
  },
  {
    id: "revolut",
    version: 1,
    bankId: "revolut",
    signature: ["type", "product", "started date", "completed date", "description", "amount", "fee", "state"],
    columns: {
      date: ["completed date", "started date"],
      description: ["description"],
      amount: "amount",
      fee: "fee",
      balance: "balance",
      status: "state",
    },
    keepStatuses: ["COMPLETED"],
  },
  {
    id: "barclays",
    version: 1,
    bankId: "barclays",
    signature: ["number", "date", "account", "amount", "subcategory", "memo"],
    columns: { date: ["date"], description: ["memo"], amount: "amount" },
  },
  {
    // NatWest, RBS and Ulster Bank share NatWest Group's export.
    id: "natwest_group",
    version: 1,
    bankId: "natwest",
    signature: ["date", "type", "description", "value", "balance", "account name"],
    columns: { date: ["date"], description: ["description"], amount: "value", balance: "balance" },
  },
  {
    // Lloyds, Halifax and Bank of Scotland share Lloyds Banking Group's export.
    id: "lloyds_group",
    version: 1,
    bankId: "lloyds",
    signature: ["transaction date", "transaction type", "transaction description", "debit amount", "credit amount", "balance"],
    columns: {
      date: ["transaction date"],
      description: ["transaction description"],
      out: "debit amount",
      in: "credit amount",
      balance: "balance",
    },
  },
  {
    id: "nationwide",
    version: 1,
    bankId: "nationwide",
    signature: ["date", "transaction type", "description", "paid out", "paid in", "balance"],
    columns: { date: ["date"], description: ["description"], out: "paid out", in: "paid in", balance: "balance" },
  },
  {
    id: "bank_of_ireland",
    version: 1,
    bankId: "bank_of_ireland",
    signature: ["date", "details", "debit", "credit", "balance"],
    columns: { date: ["date"], description: ["details"], out: "debit", in: "credit", balance: "balance" },
  },
  {
    id: "aib",
    version: 1,
    bankId: "aib",
    signature: ["posted account", "posted transactions date", "description1", "debit amount", "credit amount"],
    columns: {
      date: ["posted transactions date"],
      description: ["description1", "description2", "description3"],
      out: "debit amount",
      in: "credit amount",
      balance: "balance",
    },
  },
  {
    // Capital One card export (web: Transactions → Download → CSV).
    id: "capital_one",
    version: 1,
    bankId: "capital_one",
    signature: ["transaction date", "posted date", "card no.", "description", "debit", "credit"],
    columns: { date: ["transaction date", "posted date"], description: ["description"], out: "debit", in: "credit", bankCategory: "category" },
    accountTypeHint: "credit_card",
  },
  {
    id: "amex_uk",
    version: 1,
    bankId: "amex",
    signature: ["date", "description", "amount", "appears on your statement as"],
    columns: {
      date: ["date"],
      description: ["description"],
      amount: "amount",
      externalId: "reference",
      bankCategory: "category",
    },
    amountConvention: "inverted",
    accountTypeHint: "credit_card",
  },
];

/** Synonyms for the heuristic resolver used when no profile matches. */
export const GENERIC_SYNONYMS = {
  date: ["date", "transaction date", "posted date", "posting date", "completed date", "value date", "booking date", "trans date", "posted transactions date", "date posted"],
  description: ["description", "transaction description", "details", "narrative", "name", "payee", "counter party", "counterparty", "merchant", "memo", "particulars", "transaction details", "reference"],
  amount: ["amount", "value", "transaction amount", "amount (gbp)", "amount (eur)", "amount gbp", "net amount", "amount(gbp)"],
  out: ["paid out", "money out", "debit", "debit amount", "debits", "withdrawals", "withdrawal", "out", "payments", "spent"],
  in: ["paid in", "money in", "credit", "credit amount", "credits", "deposits", "deposit", "in", "receipts", "received"],
  balance: ["balance", "running balance", "balance (gbp)", "balance (eur)", "account balance"],
} as const;

export function normHeader(h: string): string {
  return h.replace(/^﻿/, "").replace(/["']/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
