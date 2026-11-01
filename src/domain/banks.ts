import type { BankId } from "./ingestion/types";

/**
 * Banks offered when adding an account, with the best export to download.
 * The household's own banks are listed first.
 */
export interface BankInfo {
  id: BankId;
  name: string;
  defaultType: "current" | "savings" | "credit_card";
  /** What to download, shown on the import screen. */
  exportTip: string;
}

export const BANKS: BankInfo[] = [
  { id: "monzo", name: "Monzo", defaultType: "current", exportTip: "App → account → Statements → Export as CSV (best), or PDF." },
  { id: "starling", name: "Starling", defaultType: "current", exportTip: "App → Account → Statements → CSV for any date range." },
  { id: "santander", name: "Santander", defaultType: "current", exportTip: "Online banking → Download transactions → Text (TXT) or Microsoft Money (OFX). PDF statements also work." },
  { id: "barclays", name: "Barclays", defaultType: "current", exportTip: "Online banking → Export → CSV or OFX (Money/Quicken). App: PDF statements." },
  { id: "natwest", name: "NatWest", defaultType: "current", exportTip: "Online banking → Statements → Download transactions → CSV (Excel) or OFX." },
  { id: "vanquis", name: "Vanquis", defaultType: "credit_card", exportTip: "Online account → Statements → download the PDF. Payments in are detected automatically." },
  { id: "capital_one", name: "Capital One", defaultType: "credit_card", exportTip: "Web → Transactions → Download → CSV, or the monthly PDF statement." },
  { id: "zable", name: "Zable", defaultType: "credit_card", exportTip: "App → Statements → download/share the PDF." },
  { id: "revolut", name: "Revolut", defaultType: "current", exportTip: "App → Statement → Excel/CSV." },
  { id: "lloyds", name: "Lloyds / Halifax", defaultType: "current", exportTip: "Online banking → Export → CSV." },
  { id: "hsbc", name: "HSBC / first direct", defaultType: "current", exportTip: "Online banking → Download → CSV or OFX." },
  { id: "nationwide", name: "Nationwide", defaultType: "current", exportTip: "Online banking → Statements → Download CSV." },
  { id: "amex", name: "American Express", defaultType: "credit_card", exportTip: "Statements & activity → Download → CSV." },
  { id: "ulster", name: "Ulster Bank", defaultType: "current", exportTip: "Online banking → Download transactions → CSV or OFX." },
  { id: "bank_of_ireland", name: "Bank of Ireland", defaultType: "current", exportTip: "365 online → Statements → Export CSV." },
  { id: "aib", name: "AIB", defaultType: "current", exportTip: "Online → Export transactions → CSV." },
  { id: "generic", name: "Other", defaultType: "current", exportTip: "Any CSV, OFX/QFX or PDF statement — we'll work it out." },
];

export const bankName = (id: string | null | undefined) => BANKS.find((b) => b.id === id)?.name ?? "Other";

export const ACCOUNT_TYPES = [
  { id: "current", label: "Current account" },
  { id: "savings", label: "Savings" },
  { id: "credit_card", label: "Credit card" },
  { id: "loan", label: "Loan" },
  { id: "mortgage", label: "Mortgage" },
  { id: "investment", label: "Investments" },
  { id: "cash", label: "Cash" },
] as const;

export const VISIBILITY = [
  { id: "shared", label: "Shared", help: "Your partner sees every transaction." },
  { id: "summary_only", label: "Totals only", help: "Counts toward household totals and budgets; transactions stay hidden." },
  { id: "private", label: "Private", help: "Your partner doesn't see this account at all." },
] as const;
