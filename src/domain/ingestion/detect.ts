import type { StatementFormat } from "./types";

/**
 * Format detection by CONTENT first, extension second. Users rename files,
 * banks export `.csv` that are really tab-separated, and OFX arrives as
 * `.qfx`, `.ofx`, `.xml` or even `.txt`.
 */
export function detectFormat(bytes: Uint8Array, filename: string): StatementFormat | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf"; // %PDF
  }
  const head = decodeText(bytes.subarray(0, 4096)).trimStart().toUpperCase();
  if (head.startsWith("OFXHEADER") || head.includes("<OFX>") || head.includes("<?OFX")) {
    return filename.toLowerCase().endsWith(".qfx") ? "qfx" : "ofx";
  }
  // Santander's "Text (TXT)" download: key/value blocks, not CSV, even though descriptions contain commas.
  if (/^FROM:\s*\d{2}\/\d{2}\/\d{4}\s+TO\s+\d{2}\/\d{2}\/\d{4}/.test(head.replace(/\u00A0/g, " ")) && head.includes("DATE:") && head.includes("AMOUNT:")) {
    return "txt";
  }
  const ext = filename.toLowerCase().split(".").pop();
  // A ".pdf" without the %PDF magic isn't a PDF, whatever it's called.
  if (ext === "pdf") return null;
  if (ext === "ofx" || ext === "qfx") return ext;
  // Anything texty with separators we treat as CSV; the CSV parser sniffs the delimiter.
  if (/[,;\t]/.test(head) && !head.includes("\u0000")) return "csv";
  return null;
}

/**
 * Decode bytes to text. UK bank exports are a mix of UTF-8 (with/without BOM),
 * UTF-16 (some Excel saves) and Windows-1252 (Nationwide's "£" is 0xA3).
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return new TextDecoder("windows-1252").decode(bytes.subarray(start));
  }
}
