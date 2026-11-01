/**
 * Amount parsing. Floats never touch money: we parse the decimal string
 * directly into integer minor units.
 *
 * UK statements express sign in many ways:
 *   "-12.34"  "12.34-"  "(12.34)"  "12.34 DR"  "12.34CR"  "£1,234.56"  "−12.34" (U+2212)
 * We also see "1.234,56" from EU-locale exports (Revolut in some regions), so we
 * detect the decimal separator by its position rather than assuming ".".
 */

export interface ParsedAmount {
  /** Absolute value in minor units. */
  minor: number;
  /** -1 / +1 when the text itself carried a sign marker; null when unsigned. */
  explicitSign: -1 | 1 | null;
}

const CURRENCY_CHARS = /[£€$¥]|GBP|EUR|USD/gi;

export function parseAmount(input: string | number | null | undefined): ParsedAmount | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // Numbers only arrive from structured sources; round to minor units once.
    const minor = Math.round(Math.abs(input) * 100);
    return { minor, explicitSign: input < 0 ? -1 : input > 0 ? 1 : null };
  }

  let s = input.trim();
  if (!s || s === "-" || s === "—") return null;

  let sign: -1 | 1 | null = null;

  // Credit/debit suffixes. "CR" = money in, "DR"/"D" = money out.
  const crdr = s.match(/\s*(CR|DR|D|C)\.?$/i);
  if (crdr && /\d/.test(s.slice(0, crdr.index))) {
    const tag = crdr[1]!.toUpperCase();
    sign = tag.startsWith("C") ? 1 : -1;
    s = s.slice(0, crdr.index);
  }

  s = s.replace(CURRENCY_CHARS, "").replace(/\s/g, "").replace(/−/g, "-");

  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    sign = -1;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) {
    sign = 1;
    s = s.slice(1);
  }
  // Currency may sit between sign and digits: "-£12.00" handled above; "£-12.00" here.
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }

  if (!/^[\d.,']+$/.test(s)) return null;

  // Decide decimal separator: the LAST of "." or "," followed by exactly 1–2 digits.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart: string;
  let fracPart = "";
  const decIdx = Math.max(lastDot, lastComma);
  if (decIdx >= 0 && s.length - decIdx - 1 <= 2 && s.length - decIdx - 1 > 0) {
    intPart = s.slice(0, decIdx);
    fracPart = s.slice(decIdx + 1);
  } else {
    intPart = s;
  }
  intPart = intPart.replace(/[.,']/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === "" && fracPart === "") return null;

  const minor = Number(intPart || "0") * 100 + Number(fracPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return { minor, explicitSign: sign };
}

/** True when the string looks like a money amount (used by PDF column detection). */
export function looksLikeAmount(s: string): boolean {
  const t = s.trim();
  if (!/\d/.test(t)) return false;
  // Require a 2-digit fractional part: rejects dates, sort codes, ref numbers.
  return /^[(\-−+]?\s*[£€$]?\s*-?\d{1,3}(?:[,']?\d{3})*[.,]\d{2}\s*\)?\s*-?(?:\s*(?:CR|DR|D|C)\.?)?$/i.test(t);
}

/** Display helper — never used for parsing. */
export function formatMinor(minor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}
