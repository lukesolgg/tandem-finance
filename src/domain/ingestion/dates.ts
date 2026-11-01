/**
 * UK-first date parsing.
 *
 * All parsed dates are returned as ISO `YYYY-MM-DD` strings. We never build a
 * JS Date in local time while parsing — that's how BST turns 01/04 into 31/03.
 *
 * Ambiguity: "03/04/2026" is 3 April in the UK and 4 March in the US. Some
 * exports (Revolut, PayPal, some card issuers) use US order. `detectDateOrder`
 * looks across a whole column: any first field > 12 proves DMY, any second
 * field > 12 proves MDY. If nothing proves it we default to DMY and flag it.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export type DateOrder = "DMY" | "MDY";

export interface ParsedDate {
  iso: string;
  /** Year was absent and filled from context. */
  yearInferred: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  // Two-digit years: statements are recent; pivot at +10 years from now-ish.
  return y + (y <= 69 ? 2000 : 1900);
}

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toIso(y: number, m: number, d: number): string | null {
  return isValidYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * Parse a single date string.
 * @param fallbackYear used when the text has no year ("05 Jan", "05/01").
 */
export function parseDate(
  raw: string,
  opts: { order?: DateOrder; fallbackYear?: number } = {},
): ParsedDate | null {
  const order = opts.order ?? "DMY";
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  let m: RegExpMatchArray | null;

  // ISO-ish: 2026-01-05, 2026-01-05T10:22:11, 2026-01-05 10:22:11, 20260105 (OFX)
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) {
    const iso = toIso(+m[1]!, +m[2]!, +m[3]!);
    return iso ? { iso, yearInferred: false } : null;
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{0,6}(?:\.\d+)?)?(?:\[.*\])?$/))) {
    const iso = toIso(+m[1]!, +m[2]!, +m[3]!);
    return iso ? { iso, yearInferred: false } : null;
  }

  // Numeric with separators: 05/01/2026, 5-1-26, 05.01.2026, 05/01
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?(?:\s.*)?$/))) {
    const a = +m[1]!;
    const b = +m[2]!;
    const yearInferred = m[3] === undefined;
    const y = yearInferred ? opts.fallbackYear : expandYear(+m[3]!);
    if (y === undefined) return null;
    const [d, mo] = order === "DMY" ? [a, b] : [b, a];
    const iso = toIso(y, mo, d);
    return iso ? { iso, yearInferred } : null;
  }

  // Textual month: "05 Jan 2026", "5 January 26", "05-Jan-2026", "05Jan26", "Jan 05 2026", "05 Jan"
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]?([A-Za-z]{3,9})\.?(?:[\s\-/,]+(\d{2,4}))?$/))) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) return null;
    const yearInferred = m[3] === undefined;
    const y = yearInferred ? opts.fallbackYear : expandYear(+m[3]!);
    if (y === undefined) return null;
    const iso = toIso(y, mo, +m[1]!);
    return iso ? { iso, yearInferred } : null;
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s(\d{1,2})(?:st|nd|rd|th)?,?(?:\s(\d{2,4}))?$/))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (!mo) return null;
    const yearInferred = m[3] === undefined;
    const y = yearInferred ? opts.fallbackYear : expandYear(+m[3]!);
    if (y === undefined) return null;
    const iso = toIso(y, mo, +m[2]!);
    return iso ? { iso, yearInferred } : null;
  }
  return null;
}

/** Quick check used by PDF line classification. */
export function looksLikeDate(s: string): boolean {
  const t = s.trim();
  return (
    /^\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?$/.test(t) ||
    /^\d{1,2}(?:st|nd|rd|th)?[\s\-]?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:[\s\-]\d{2,4})?$/i.test(t) ||
    /^\d{4}-\d{2}-\d{2}/.test(t)
  );
}

/**
 * Look at every numeric date in a column and decide DMY vs MDY.
 * Returns `ambiguous: true` when no value proves either order.
 */
export function detectDateOrder(samples: string[]): { order: DateOrder; ambiguous: boolean } {
  let dmyProof = 0;
  let mdyProof = 0;
  let numeric = 0;
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-]\d{2,4})?/);
    if (!m) continue;
    numeric++;
    const a = +m[1]!;
    const b = +m[2]!;
    if (a > 12 && b <= 12) dmyProof++;
    if (b > 12 && a <= 12) mdyProof++;
  }
  if (numeric === 0) return { order: "DMY", ambiguous: false }; // textual months, no ambiguity
  if (mdyProof > 0 && dmyProof === 0) return { order: "MDY", ambiguous: false };
  if (dmyProof > 0) return { order: "DMY", ambiguous: false };
  return { order: "DMY", ambiguous: true };
}

/** Compare ISO dates (lexicographic works for YYYY-MM-DD). */
export function isoCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
