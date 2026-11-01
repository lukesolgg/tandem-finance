/**
 * Dev tool: run a real statement through the parser locally, print a summary.
 * Nothing leaves your machine.   npx tsx scripts/parse-file.ts <file> [credit_card]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseStatement } from "../src/domain/ingestion/pipeline";

async function main() {
  const [file, type] = process.argv.slice(2);
  if (!file) throw new Error("usage: tsx scripts/parse-file.ts <file> [credit_card|current|savings]");
  const r = await parseStatement({
    bytes: new Uint8Array(readFileSync(file)),
    filename: basename(file),
    hint: type ? { accountType: type as "credit_card" } : undefined,
  });
  console.log({ ...r.meta, reconciled: r.reconciled, confidence: r.confidence, warnings: r.warnings, rows: r.rows.length });
  for (const x of r.rows) console.log(x.date, String(x.amount / 100).padStart(10), x.confidence.toFixed(2), x.description, x.warnings.join(","));
}
main();
