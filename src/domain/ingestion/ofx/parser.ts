import { decodeText } from "../detect";
import { parseDate } from "../dates";
import { parseAmount } from "../money";
import { cleanDescription } from "../normalise";
import { applyReconciliation } from "../reconcile";
import { scoreRows, statementConfidence } from "../confidence";
import { StatementParseError, type BankId, type ParseInput, type ParseResult, type ParsedRow, type StatementFormat } from "../types";

/**
 * OFX / QFX parser — handles both flavours UK banks emit:
 *   • OFX 1.x SGML: leaf tags are NOT closed (`<TRNAMT>-12.34` then newline)
 *   • OFX 2.x XML:  every tag closed
 * We avoid a full SGML parser: OFX statements are shallow and the regexes below
 * read a leaf value up to the next `<` or end-of-line, which is correct for both.
 *
 * OFX is our most trustworthy format: amounts are signed per spec, dates are
 * unambiguous, and FITID gives a bank-issued unique id for perfect dedupe.
 */
export function parseOfx(input: ParseInput, format: StatementFormat): ParseResult {
  const text = decodeText(input.bytes);
  const body = text.slice(Math.max(0, text.toUpperCase().indexOf("<OFX>")));
  if (!body) throw new StatementParseError("malformed", "No <OFX> block found.");

  const leaf = (src: string, tag: string): string | undefined => {
    const m = src.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
    return m?.[1]?.trim() || undefined;
  };

  const isCard = /<CCSTMTRS>/i.test(body);
  const currency = leaf(body, "CURDEF") ?? "GBP";
  const acct = leaf(body, "ACCTID");
  const org = (leaf(body, "ORG") ?? "").toLowerCase();

  const blocks = body.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]!);
  const rows: ParsedRow[] = [];
  for (const b of blocks) {
    const date = parseDate(leaf(b, "DTPOSTED") ?? leaf(b, "DTUSER") ?? "");
    const amt = parseAmount(leaf(b, "TRNAMT"));
    if (!date || !amt) continue;
    const name = leaf(b, "NAME") ?? "";
    const memo = leaf(b, "MEMO") ?? "";
    // Some banks (Barclays, HSBC) truncate NAME at 32 chars and put the rest in MEMO.
    const rawDescription = [name, memo].filter((s, i, a) => s && a.indexOf(s) === i).join(" | ");
    const amount = (amt.explicitSign ?? 1) * amt.minor;
    rows.push({
      index: rows.length,
      date: date.iso,
      amount,
      description: cleanDescription(decodeEntities(name || memo || "Unknown")),
      rawDescription: decodeEntities(rawDescription),
      externalId: leaf(b, "FITID"),
      warnings: amount === 0 ? ["zero_amount"] : [],
      confidence: 1,
    });
  }
  if (rows.length === 0) throw new StatementParseError("no_transactions_found", "No transactions in this OFX file.");

  const ledgerBalBlock = body.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i)?.[1] ?? "";
  const closingParsed = parseAmount(leaf(ledgerBalBlock, "BALAMT"));
  const closing = closingParsed ? (closingParsed.explicitSign ?? 1) * closingParsed.minor : undefined;
  // OFX gives a closing (ledger) balance only. Opening = closing − Σ amounts, which
  // makes totals trivially reconcile — so we deliberately DON'T claim reconciliation
  // from that; OFX trust comes from the format itself.
  const rec = applyReconciliation(rows, {});
  scoreRows(rows);

  const start = parseDate(leaf(body, "DTSTART") ?? "")?.iso;
  const end = parseDate(leaf(body, "DTEND") ?? "")?.iso;
  const dates = rows.map((r) => r.date).sort();
  return {
    meta: {
      format,
      bankId: guessBankFromOrg(org) ?? input.hint?.bankId ?? "generic",
      parserId: `ofx:standard@1`,
      currency,
      periodStart: start ?? dates[0],
      periodEnd: end ?? dates[dates.length - 1],
      closingBalance: closing,
      openingBalance: closing !== undefined ? closing - rows.reduce((s, r) => s + r.amount, 0) : undefined,
      maskedAccountNumber: acct ? acct.slice(-4) : undefined,
      accountTypeHint: isCard ? "credit_card" : input.hint?.accountType,
    },
    rows,
    warnings: [],
    reconciled: rec.reconciled,
    // Structured, signed, unambiguous: floor at 0.97 unless rows carry warnings.
    confidence: Math.max(statementConfidence(rows, rec.reconciled, []), rows.every((r) => r.warnings.length === 0) ? 0.97 : 0),
  };
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

function guessBankFromOrg(org: string): BankId | undefined {
  const map: [RegExp, BankId][] = [
    [/barclays/, "barclays"],
    [/first ?direct/, "first_direct"],
    [/hsbc/, "hsbc"],
    [/natwest/, "natwest"],
    [/ulster/, "ulster"],
    [/royal bank of scotland|rbs/, "rbs"],
    [/lloyds/, "lloyds"],
    [/halifax/, "halifax"],
    [/nationwide/, "nationwide"],
    [/santander/, "santander"],
    [/bank of ireland|boi/, "bank_of_ireland"],
    [/allied irish|aib/, "aib"],
    [/american express|amex/, "amex"],
    [/vanquis/, "vanquis"],
    [/capital one/, "capital_one"],
    [/zable|lendable/, "zable"],
  ];
  return map.find(([re]) => re.test(org))?.[1];
}
