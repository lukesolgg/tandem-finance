/**
 * Description cleaning. Turns bank noise into something a human (and the
 * categoriser) can read, WITHOUT losing information: the raw string is always
 * kept alongside.
 *
 *   "CARD PAYMENT TO TESCO STORES 3021 ON 04 JAN"   → "Tesco Stores 3021"
 *   ")))  TESCO STORES 3021     BELFAST GB"         → "Tesco Stores 3021 Belfast"
 *   "TESCO STORES 3021\tON 04 JAN BCC"  (Barclays)  → "Tesco Stores 3021"
 *   "DD  THAMES WATER"                              → "Thames Water"
 */

// Leading transaction-type codes used by HSBC / First Direct / NatWest / Lloyds.
const TYPE_PREFIXES = [
  ")))", "VIS", "DD", "SO", "BP", "CR", "DR", "TFR", "ATM", "CPT", "FPI", "FPO", "BGC", "DEB", "CHQ", "PAY", "DEP", "POS", "C/L",
];
const PREFIX_RE = new RegExp(
  `^(?:${TYPE_PREFIXES.map((p) => p.replace(/[)(/]/g, "\\$&")).join("|")})(?=\\s|$)\\s*`,
  "i",
);

const PHRASE_STRIP: RegExp[] = [
  /^card payment to\s+/i,
  /^card purchase\s+(?:at\s+)?/i,
  /^contactless payment to\s+/i,
  /^direct debit (?:payment )?to\s+/i,
  /^standing order (?:payment )?to\s+/i,
  /^faster payments? (?:receipt|payment)\s+(?:ref\s*\S+\s+)?(?:from|to)?\s*/i,
  /^bill payment to\s+/i,
  /^transfer (?:to|from)\s+/i,
  /^payment to\s+/i,
  /^apple pay\s+/i,
  /^google pay\s+/i,
  /\s+on\s+\d{1,2}\s+[a-z]{3}(?:\s+\d{2,4})?\b.*$/i, // "... ON 04 JAN BCC"
  /\s+\d{1,2}[A-Z]{3}\d{2}\b.*$/, // "... 04JAN26"
  /\s+(?:BCC|CLP|CPM)$/i, // Barclays channel codes
  /\s+(?:GB|GBR|IE|IRL)$/, // trailing ISO country codes ("UK" is often part of the name: "Spotify UK")
  /\s+\*{2,}\d{4}\b/, // masked card refs
  /\s+card\s*\d{4}\b.*$/i,
  /,?\s*mandate no\.?\s*\d+.*$/i, // Santander DDs
  /,?\s+ref\.?\s*[:.]?\s*[\w-]*\d[\w-]*.*$/i, // "REF 123456", "REF.AB12" — only when the ref contains a digit
];

const SMALL_WORDS = new Set(["and", "of", "the", "to", "at", "on", "for", "in"]);
// Kept upper-case when title-casing.
const ACRONYMS = new Set(["UK", "TV", "BP", "HMRC", "DVLA", "TFL", "NHS", "EE", "O2", "BT", "ATM", "KFC", "H&M", "M&S", "IKEA", "ASOS", "TK", "TJ", "JD", "AA", "RAC", "NI", "NIE", "SSE", "OVO", "HSBC", "AIB", "BOI", "PAYPAL", "LTD", "PLC"]);

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => {
      if (/^\s+$/.test(w)) return w;
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up === "PAYPAL" ? "PayPal" : up === "LTD" ? "Ltd" : up === "PLC" ? "plc" : up;
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      // Keep things like "mcdonald's" → "Mcdonald's" (good enough; merchant table has canonical names)
      // Capitalise after & and - too: "marks&spencer" → "Marks&Spencer", "co-op" → "Co-Op"
      return w.replace(/(^|[&-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
    })
    .join("");
}

export function cleanDescription(raw: string): string {
  // Barclays & others put location/meta after a tab; keep the first segment.
  let s = raw.split("\t")[0]!.replace(/\s+\|\s+/g, " ").replace(/\s{2,}/g, "  ").trim();
  s = s.replace(PREFIX_RE, "");
  for (const re of PHRASE_STRIP) s = s.replace(re, "");
  s = s
    .replace(/\s{2,}/g, " ")
    .replace(/[,*]+$/, "")
    .trim();
  if (!s) s = raw.trim();
  // Only title-case if the bank SHOUTED. Monzo/Starling already provide nice names.
  return s === s.toUpperCase() ? titleCase(s) : s;
}

/** Collapse to a comparison key for dedupe & merchant matching. */
export function descriptionKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b\d{3,}\b/g, " ") // store numbers, refs
    .replace(/\s+/g, " ")
    .trim();
}

/** Dice coefficient on bigrams — cheap fuzzy match for dedupe across formats. */
export function similarity(a: string, b: string): number {
  const ka = descriptionKey(a).replace(/\s/g, "");
  const kb = descriptionKey(b).replace(/\s/g, "");
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  if (ka.length < 2 || kb.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < ka.length - 1; i++) {
    const g = ka.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < kb.length - 1; i++) {
    const g = kb.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      overlap++;
      grams.set(g, n - 1);
    }
  }
  return (2 * overlap) / (ka.length - 1 + kb.length - 1);
}
