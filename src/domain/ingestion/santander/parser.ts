import { decodeText } from "../detect";
import { parseDate } from "../dates";
import { parseAmount } from "../money";
import { cleanDescription } from "../normalise";
import { applyReconciliation } from "../reconcile";
import { scoreRows, statementConfidence } from "../confidence";
import { StatementParseError, type ParseInput, type ParseResult, type ParsedRow } from "../types";

/**
 * Santander UK "Text (TXT)" download. Santander doesn't offer CSV for current
 * accounts; its TXT is key/value blocks padded with non-breaking spaces:
 *
 *   From: 01/10/2026 to 31/10/2026
 *   Account: XXXX XXXX XXXX 1234
 *
 *   Date: 02/10/2026
 *   Description: CARD PAYMENT TO TESCO STORES 3021,23.18 GBP, RATE 1.00/GBP ON 30-09-2026
 *   Amount: -23.18
 *   Balance: 976.82
 *
 * (OFX from Santander goes through the OFX parser; PDF through the PDF parser.)
 */
export function parseSantanderTxt(input: ParseInput): ParseResult {
  const text = decodeText(input.bytes).replace(/ /g, " ").replace(/\r/g, "");
  const period = text.match(/From:\s*(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i);
  const acct = text.match(/Account:\s*([X\d ]+)/i)?.[1]?.replace(/\s/g, "");

  const blocks = text.split(/\n\s*(?=Date:)/i).filter((b) => /^\s*Date:/i.test(b));
  const rows: ParsedRow[] = [];
  for (const b of blocks) {
    const field = (k: string) => b.match(new RegExp(`^\\s*${k}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
    const date = parseDate(field("Date"));
    const amt = parseAmount(field("Amount").replace(/\s*GBP$/i, ""));
    if (!date || !amt) continue;
    // Santander appends FX detail after the first comma: ",23.18 GBP, RATE 1.00/GBP ON …"
    const rawDescription = field("Description");
    const main = rawDescription.split(/,\s*[\d.]+\s+[A-Z]{3}\b/)[0] ?? rawDescription;
    const bal = parseAmount(field("Balance").replace(/\s*GBP$/i, ""));
    rows.push({
      index: rows.length,
      date: date.iso,
      amount: (amt.explicitSign ?? 1) * amt.minor,
      description: cleanDescription(main),
      rawDescription,
      runningBalance: bal ? (bal.explicitSign ?? 1) * bal.minor : undefined,
      warnings: [],
      confidence: 1,
    });
  }
  if (rows.length === 0) throw new StatementParseError("no_transactions_found", "No transactions in this Santander file.");

  const rec = applyReconciliation(rows, {});
  scoreRows(rows);
  const dates = rows.map((r) => r.date).sort();
  return {
    meta: {
      format: "txt",
      bankId: "santander",
      parserId: "txt:santander@1",
      currency: "GBP",
      periodStart: period ? parseDate(period[1]!)?.iso : dates[0],
      periodEnd: period ? parseDate(period[2]!)?.iso : dates[dates.length - 1],
      openingBalance: rec.opening,
      closingBalance: rec.closing,
      maskedAccountNumber: acct ? acct.slice(-4) : undefined,
      accountTypeHint: input.hint?.accountType,
    },
    rows,
    warnings: [],
    reconciled: rec.reconciled,
    confidence: statementConfidence(rows, rec.reconciled, []),
  };
}
