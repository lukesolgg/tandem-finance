import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseStatement, buildReview } from "@/domain/ingestion/pipeline";
import { parseAmount, looksLikeAmount } from "@/domain/ingestion/money";
import { parseDate, detectDateOrder } from "@/domain/ingestion/dates";
import { cleanDescription } from "@/domain/ingestion/normalise";
import { fingerprintRows, type LedgerTxn } from "@/domain/ingestion/dedupe";
import { findStatementYear } from "@/domain/ingestion/pdf/parser";
import { cardStatementPdf, hsbcStylePdf, monzoStylePdf, unsignedAmountPdf } from "./helpers/pdf-fixtures";

const fx = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, "fixtures", name)));
const parse = (name: string, hint?: Parameters<typeof parseStatement>[0]["hint"]) =>
  parseStatement({ bytes: fx(name), filename: name, hint });
const simple = (rows: { date: string; amount: number; description: string }[]) =>
  rows.map(({ date, amount, description }) => ({ date, amount, description }));

describe("money", () => {
  it.each([
    ["-12.34", -1234],
    ["12.34-", -1234],
    ["(12.34)", -1234],
    ["12.34 DR", -1234],
    ["12.34CR", 1234],
    ["£1,234.56", 123456],
    ["−5.00", -500], // unicode minus
    ["1.234,56", 123456], // EU locale
    ["-£3.20", -320],
    ["£-3.20", -320],
    ["0.1", 10],
  ])("parses %s", (input, expected) => {
    const a = parseAmount(input)!;
    expect((a.explicitSign ?? 1) * a.minor).toBe(expected);
  });
  it("rejects non-amounts", () => {
    expect(parseAmount("TESCO")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(looksLikeAmount("05/01/2026")).toBe(false);
    expect(looksLikeAmount("40-11-22")).toBe(false);
    expect(looksLikeAmount("2,996.55")).toBe(true);
  });
  it("never uses floating point", () => {
    expect(parseAmount("0.29")!.minor).toBe(29); // 0.29*100 = 28.999999… in float
    expect(parseAmount("1,000,000.07")!.minor).toBe(100000007);
  });
});

describe("dates", () => {
  it("parses UK formats", () => {
    expect(parseDate("05/01/2026")!.iso).toBe("2026-01-05");
    expect(parseDate("5-1-26")!.iso).toBe("2026-01-05");
    expect(parseDate("05 Jan 2026")!.iso).toBe("2026-01-05");
    expect(parseDate("05-Jan-26")!.iso).toBe("2026-01-05");
    expect(parseDate("2026-01-05 10:22:11")!.iso).toBe("2026-01-05");
    expect(parseDate("20260105120000[0:GMT]")!.iso).toBe("2026-01-05");
    expect(parseDate("05 Jan", { fallbackYear: 2026 })).toEqual({ iso: "2026-01-05", yearInferred: true });
  });
  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseDate("31/02/2026")).toBeNull();
  });
  it("detects date order across a column", () => {
    expect(detectDateOrder(["01/02/2026", "13/02/2026"])).toEqual({ order: "DMY", ambiguous: false });
    expect(detectDateOrder(["02/13/2026", "02/01/2026"])).toEqual({ order: "MDY", ambiguous: false });
    expect(detectDateOrder(["01/02/2026", "03/04/2026"])).toEqual({ order: "DMY", ambiguous: true });
  });
});

describe("description cleaning", () => {
  it.each([
    ["CARD PAYMENT TO TESCO STORES 3021 ON 04 JAN", "Tesco Stores 3021"],
    [")))  TESCO STORES 3021     BELFAST GB", "Tesco Stores 3021 Belfast"],
    ["SPOTIFY UK          \tON 06 OCT BCC", "Spotify UK"],
    ["DD  THAMES WATER", "Thames Water"],
    ["Pret A Manger", "Pret A Manger"],
  ])("%s → %s", (raw, clean) => expect(cleanDescription(raw)).toBe(clean));
});

describe("CSV bank profiles", () => {
  it("Monzo: signed amounts, tx ids, bank categories, thousands separators", async () => {
    const r = await parse("monzo.csv");
    expect(r.meta.parserId).toBe("csv:monzo@1");
    expect(simple(r.rows)).toEqual([
      { date: "2026-10-02", amount: -435, description: "Pret A Manger" },
      { date: "2026-10-02", amount: -2318, description: "Tesco" },
      { date: "2026-10-13", amount: 215000, description: "Acme Ltd" },
      { date: "2026-10-15", amount: -1099, description: "Netflix" },
      { date: "2026-10-15", amount: -101240, description: "Uber" },
    ]);
    expect(r.rows[0]!.externalId).toBe("tx_0000AaA1");
    expect(r.rows[1]!.bankCategory).toBe("Groceries");
  });

  it("Starling: skips synthetic opening row, reconciles running balance, keeps duplicate coffees", async () => {
    const r = await parse("starling.csv");
    expect(r.rows).toHaveLength(5);
    expect(r.reconciled).toBe(true);
    expect(r.meta.openingBalance).toBe(50000);
    expect(r.meta.closingBalance).toBe(102010);
    expect(r.rows.filter((x) => x.amount === -320)).toHaveLength(2);
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("Revolut: completed only, fee deducted, ISO datetimes", async () => {
    const r = await parse("revolut.csv");
    expect(r.warnings).toContain("pending_or_reverted_skipped");
    expect(simple(r.rows).map((x) => [x.date, x.amount])).toEqual([
      ["2026-10-02", -1599],
      ["2026-10-03", 10000],
      ["2026-10-05", -5025],
    ]);
    expect(r.reconciled).toBe(true);
  });

  it("Barclays: tab-separated memo noise is stripped", async () => {
    const r = await parse("barclays.csv");
    expect(r.rows.map((x) => x.description)).toEqual(["Spotify UK", "Shell Belfast", "HMRC Tax Refund"]);
  });

  it("Nationwide: preamble lines, Windows-1252 £, split paid in/out", async () => {
    const r = await parse("nationwide.csv");
    expect(r.meta.bankId).toBe("nationwide");
    expect(r.rows.map((x) => x.amount)).toEqual([-1420, -2500, 25956]);
    expect(r.reconciled).toBe(true);
  });

  it("Lloyds: newest-first ordering still reconciles", async () => {
    const r = await parse("lloyds.csv");
    expect(r.rows.map((x) => x.amount)).toEqual([-4567, -3500, 53500]);
    expect(r.reconciled).toBe(true);
    expect(r.meta.openingBalance).toBe(50000);
    expect(r.meta.closingBalance).toBe(95433);
  });

  it("HSBC headerless export", async () => {
    const r = await parse("hsbc_headerless.csv");
    expect(r.meta.bankId).toBe("hsbc");
    expect(r.rows.map((x) => x.description)).toEqual(["Marks&Spencer plc Sacat Belfast", "British Gas", "Salary Acme"]);
  });

  it("Amex: inverts card sign convention", async () => {
    const r = await parse("amex.csv");
    expect(r.meta.accountTypeHint).toBe("credit_card");
    expect(r.rows.map((x) => x.amount)).toEqual([-24500, 50000]);
  });

  it("Unknown layout: generic resolver, proves MDY from the data", async () => {
    const r = await parse("generic_us_dates.csv");
    expect(r.warnings).toContain("unrecognised_layout");
    expect(r.rows.map((x) => x.date)).toEqual(["2026-10-14", "2026-10-02"]);
  });
});

describe("OFX", () => {
  it("parses SGML OFX with FITIDs, bank from ORG, masked account", async () => {
    const r = await parse("barclays.ofx");
    expect(r.meta.format).toBe("ofx");
    expect(r.meta.bankId).toBe("barclays");
    expect(r.meta.maskedAccountNumber).toBe("5678");
    expect(r.meta.closingBalance).toBe(273181);
    expect(r.rows.map((x) => [x.date, x.amount, x.externalId])).toEqual([
      ["2026-10-07", -1299, "2026100701"],
      ["2026-10-08", -5620, "2026100801"],
      ["2026-10-09", 180000, "2026100901"],
    ]);
    expect(r.confidence).toBeGreaterThanOrEqual(0.97);
  });
});

describe("PDF table parser", () => {
  it("HSBC-style: multi-line, date-once-per-day, page break, Dec→Jan rollover, daily balances", async () => {
    const r = await parseStatement({ bytes: await hsbcStylePdf(), filename: "hsbc.pdf" });
    expect(r.meta.bankId).toBe("hsbc");
    expect(r.meta.openingBalance).toBe(100000);
    expect(r.meta.closingBalance).toBe(232416);
    expect(simple(r.rows)).toEqual([
      { date: "2025-12-16", amount: -2345, description: "Tesco Stores 3021 Belfast" },
      { date: "2025-12-16", amount: -8000, description: "NIE Energy" },
      { date: "2025-12-31", amount: 210000, description: "Acme Ltd Salary" },
      { date: "2026-01-02", amount: -1599, description: "Amazon.co.uk*ab12c Amazon.co.uk Luxembourg" },
      { date: "2026-01-02", amount: -65000, description: "J Smith Rent" },
      { date: "2026-01-05", amount: -320, description: "Costa Coffee" },
      { date: "2026-01-05", amount: -320, description: "Costa Coffee" },
    ]);
    expect(r.reconciled).toBe(true);
    expect(r.rows[0]!.warnings).toEqual(expect.arrayContaining(["year_inferred", "multiline_merged"]));
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("Monzo-style: amount on first line, reference lines after, minus-marks-debit", async () => {
    const r = await parseStatement({ bytes: await monzoStylePdf(), filename: "monzo.pdf" });
    expect(r.meta.bankId).toBe("monzo");
    expect(simple(r.rows)).toEqual([
      { date: "2026-10-02", amount: -435, description: "Pret A Manger PRET A MANGER LONDON" },
      { date: "2026-10-13", amount: 215000, description: "ACME LTD Reference: SALARY OCT" },
      { date: "2026-10-15", amount: -1099, description: "Netflix" },
    ]);
    expect(r.reconciled).toBe(true);
  });

  it("No sign markers anywhere: recovers signs from balance deltas", async () => {
    const r = await parseStatement({ bytes: await unsignedAmountPdf(), filename: "cu.pdf" });
    expect(r.rows.map((x) => x.amount)).toEqual([-2000, 50000, -6000]);
    expect(r.rows.every((x) => x.warnings.includes("sign_inferred_from_balance"))).toBe(true);
    expect(r.reconciled).toBe(true);
    expect(r.warnings).toContain("unrecognised_layout");
  });

  it("finds statement start year from a period that spans new year", () => {
    expect(findStatementYear("Your Statement 15 December to 14 January 2026")).toBe(2025);
    expect(findStatementYear("1 March 2026 to 31 March 2026")).toBe(2026);
  });
});

describe("dedupe & review", () => {
  const acct = "acc_1";
  it("fingerprints are independent of statement order and description wording", () => {
    const rows = [
      { index: 0, date: "2026-10-05", amount: -320, description: "Costa", rawDescription: "", warnings: [], confidence: 1 },
      { index: 1, date: "2026-10-05", amount: -320, description: "Costa", rawDescription: "", warnings: [], confidence: 1 },
    ];
    const a = fingerprintRows(acct, rows).map((r) => r.fingerprint);
    const b = fingerprintRows(acct, [...rows].reverse().map((r, i) => ({ ...r, index: i, description: "COSTA COFFEE 123" }))).map((r) => r.fingerprint);
    expect(new Set(a).size).toBe(2);
    expect(new Set(b)).toEqual(new Set(a));
  });

  it("overlapping CSV then PDF of the same period → all duplicates, nothing imported twice", async () => {
    const csv = await parse("monzo.csv");
    const ledger: LedgerTxn[] = fingerprintRows(acct, csv.rows).map((r, i) => ({ id: `t${i}`, ...r }));
    const pdf = await parseStatement({ bytes: await monzoStylePdf(), filename: "m.pdf" });
    const review = buildReview(acct, pdf, ledger);
    expect(review.summary.new).toBe(0);
    expect(review.summary.duplicates).toBe(3);
  });

  it("date drift between formats → possible duplicate, flagged not dropped", async () => {
    const ledger: LedgerTxn[] = [
      { id: "x", date: "2026-10-06", amount: -1299, description: "Spotify", fingerprint: "nope" },
    ];
    const review = buildReview(acct, await parse("barclays.csv"), ledger);
    const spotify = review.rows.find((r) => r.amount === -1299)!;
    expect(spotify.disposition).toMatchObject({ kind: "possible_duplicate", of: "x" });
    expect(spotify.confidence).toBeLessThan(0.8);
    expect(review.canQuickCommit).toBe(false);
  });

  it("clean reconciled statement with no conflicts allows one-click import", async () => {
    const review = buildReview(acct, await parse("starling.csv"), []);
    expect(review.canQuickCommit).toBe(true);
    expect(review.summary).toMatchObject({ total: 5, new: 5, moneyIn: 60000, moneyOut: 7990 });
  });
});

describe("your banks: Santander, Capital One, Vanquis/Zable-style cards", () => {
  it("Santander TXT: nbsp padding, Windows-1252, FX suffix stripped, reconciles", async () => {
    const r = await parse("santander.txt");
    expect(r.meta).toMatchObject({ format: "txt", bankId: "santander", maskedAccountNumber: "4321", periodStart: "2026-10-01", periodEnd: "2026-10-31" });
    expect(simple(r.rows)).toEqual([
      { date: "2026-10-02", amount: -2318, description: "Tesco Stores 3021" },
      { date: "2026-10-03", amount: -2500, description: "EE Limited" },
      { date: "2026-10-04", amount: 150000, description: "Acme Ltd" },
    ]);
    expect(r.reconciled).toBe(true);
  });

  it("Capital One CSV: debit/credit columns", async () => {
    const r = await parse("capital_one.csv");
    expect(r.meta.bankId).toBe("capital_one");
    expect(r.rows.map((x) => x.amount)).toEqual([-1999, 15000]);
  });

  it("card CSV printing spend as positive is inverted when the account is a card", async () => {
    const asCard = await parse("card_positive_spend.csv", { accountType: "credit_card" });
    expect(asCard.rows.map((x) => x.amount)).toEqual([-1840, -999, 7500]);
    const asCurrent = await parse("card_positive_spend.csv");
    expect(asCurrent.rows.map((x) => x.amount)).toEqual([1840, 999, -7500]);
  });

  it("card PDF with no balance and no sign markers: payments are credits, rest is spend", async () => {
    const r = await parseStatement({ bytes: await cardStatementPdf(), filename: "vanquis.pdf" });
    expect(r.meta).toMatchObject({ bankId: "vanquis", accountTypeHint: "credit_card" });
    expect(simple(r.rows)).toEqual([
      { date: "2026-10-03", amount: -4500, description: "Argos Ltd" },
      { date: "2026-10-09", amount: 10000, description: "Payment Received Thank You" },
      { date: "2026-10-15", amount: -1250, description: "Odeon Cinemas" },
    ]);
    expect(r.rows.every((x) => x.warnings.includes("sign_convention_inferred"))).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
