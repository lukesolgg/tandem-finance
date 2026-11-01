import { descriptionKey } from "../ingestion/normalise";
import { BANK_CATEGORY_MAP, SEED_MERCHANTS } from "./seed";
import { looksLikeCardPayment } from "../ingestion/cards";

/**
 * Categorisation engine — pure, synchronous, deterministic.
 *
 * Precedence (first hit wins), each with a confidence the UI can show:
 *   1. User rules            "Always categorise X as Y"           1.00
 *   2. Learned merchant      household's corrections for this     0.50–0.99
 *                            merchant (shared by both partners)
 *   3. Seed merchant         built-in UK/IE knowledge             0.85
 *   4. Bank's own category   Monzo/Starling hint                  0.60
 *   5. Heuristics            "salary" on a credit, interest…      0.50
 *   → otherwise uncategorised (null)
 *
 * Why rules before learning: an explicit rule is a statement of intent;
 * learning is a guess from history. Why learning before seed: the household
 * knows that "Spar" near their house is their corner shop for groceries, not
 * whatever we assumed.
 *
 * Categories are referenced by KEY here (stable across renames); the commit
 * step resolves keys to the household's category ids.
 */

export type CategorySource = "rule" | "learned" | "seed" | "bank" | "heuristic";

export interface Categorisable {
  description: string;
  rawDescription?: string;
  amount: number;
  accountId?: string;
  bankCategory?: string;
}

export interface RuleLike {
  id: string;
  categoryKey: string;
  priority: number;
  descriptionContains?: string | null;
  descriptionRegex?: string | null;
  merchantKey?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  direction?: "in" | "out" | string | null;
  accountId?: string | null;
  markPrivate?: boolean;
  renameTo?: string | null;
}

export interface LearnedMerchant {
  key: string;
  categoryKey: string;
  confirmations: number;
  overrides: number;
}

export interface CategoriseContext {
  rules: RuleLike[];
  learned: Map<string, LearnedMerchant>;
  /** Household-specific merchant aliases (key → display name). Optional. */
}

export interface Categorisation {
  categoryKey: string | null;
  source: CategorySource | null;
  confidence: number;
  merchantKey: string;
  merchantName: string;
  ruleId?: string;
  markPrivate?: boolean;
  renameTo?: string;
}

/**
 * Canonical merchant identity for a description. Known brands collapse to a
 * fixed key ("TESCO STORES 3021 BELFAST" & "TESCO EXPRESS" → "tesco"); unknown
 * merchants fall back to their first two meaningful words, which is stable
 * enough for learning ("JOE'S CAFE 123 LISBURN" → "joe s").
 */
export function identifyMerchant(description: string): { key: string; name: string; seedCategory?: string } {
  const lower = description.toLowerCase();
  const seed = SEED_MERCHANTS.find((s) => s.pattern.test(lower));
  if (seed) return { key: seed.key, name: seed.name, seedCategory: seed.category };
  const words = descriptionKey(description)
    .split(" ")
    .filter((w) => w.length > 1 && !NOISE_WORDS.has(w));
  const key = words.slice(0, 2).join(" ") || descriptionKey(description) || "unknown";
  return { key, name: description.trim() };
}

const NOISE_WORDS = new Set(["ltd", "limited", "plc", "uk", "gb", "the", "www", "com", "co", "payment", "card", "contactless"]);

export function categorise(txn: Categorisable, ctx: CategoriseContext): Categorisation {
  const merchant = identifyMerchant(txn.description);
  const base = { merchantKey: merchant.key, merchantName: merchant.name };

  // 1. Explicit rules
  const rules = [...ctx.rules].sort((a, b) => a.priority - b.priority);
  for (const r of rules) {
    if (ruleMatches(r, txn, merchant.key)) {
      return {
        ...base,
        categoryKey: r.categoryKey,
        source: "rule",
        confidence: 1,
        ruleId: r.id,
        markPrivate: r.markPrivate || undefined,
        renameTo: r.renameTo ?? undefined,
      };
    }
  }

  // 2. Learned from this household's corrections
  const learned = ctx.learned.get(merchant.key);
  if (learned) {
    return { ...base, categoryKey: learned.categoryKey, source: "learned", confidence: learnedConfidence(learned) };
  }

  // 3. Built-in merchant knowledge — but never categorise a CREDIT as spending.
  // A Tesco refund is a refund, not negative groceries spending... except that
  // budget-wise users usually DO want it netted against groceries. So: keep the
  // category, slightly lower confidence; the UI shows "refund" from the sign.
  if (merchant.seedCategory) {
    return { ...base, categoryKey: merchant.seedCategory, source: "seed", confidence: txn.amount < 0 ? 0.85 : 0.7 };
  }

  // 4. Bank-provided category
  const bank = txn.bankCategory ? BANK_CATEGORY_MAP[txn.bankCategory.toLowerCase()] : undefined;
  if (bank) return { ...base, categoryKey: bank, source: "bank", confidence: 0.6 };

  // 5. Heuristics on the text + direction
  const h = heuristic(txn);
  if (h) return { ...base, categoryKey: h, source: "heuristic", confidence: 0.5 };

  return { ...base, categoryKey: null, source: null, confidence: 0 };
}

export function ruleMatches(r: RuleLike, t: Categorisable, merchantKey: string): boolean {
  const text = `${t.description} ${t.rawDescription ?? ""}`.toLowerCase();
  if (r.descriptionContains && !text.includes(r.descriptionContains.toLowerCase())) return false;
  if (r.descriptionRegex) {
    try {
      if (!new RegExp(r.descriptionRegex, "i").test(text)) return false;
    } catch {
      return false; // invalid user regex never matches (validated on save anyway)
    }
  }
  if (r.merchantKey && r.merchantKey !== merchantKey) return false;
  const abs = Math.abs(t.amount);
  if (r.amountMin != null && abs < r.amountMin) return false;
  if (r.amountMax != null && abs > r.amountMax) return false;
  if (r.direction === "in" && t.amount <= 0) return false;
  if (r.direction === "out" && t.amount >= 0) return false;
  if (r.accountId && r.accountId !== t.accountId) return false;
  // A rule with no conditions would match everything — refuse.
  return Boolean(r.descriptionContains || r.descriptionRegex || r.merchantKey || r.accountId || r.amountMin != null || r.amountMax != null);
}

/**
 * Laplace-smoothed agreement rate, mapped into 0.50–0.99. One correction gives
 * 0.83 (above the 0.8 review line); six unopposed ~0.93; once overrides outweigh
 * confirmations it drops below 0.8 and the UI starts asking again.
 */
export function learnedConfidence(l: Pick<LearnedMerchant, "confirmations" | "overrides">): number {
  const p = (l.confirmations + 1) / (l.confirmations + l.overrides + 2);
  return Math.round((0.5 + 0.49 * p) * 100) / 100;
}

function heuristic(t: Categorisable): string | null {
  const s = `${t.description} ${t.rawDescription ?? ""}`.toLowerCase();
  if (t.amount > 0) {
    // "PAYMENT RECEIVED - THANK YOU" on a card = money moved from a current
    // account, not income. Paired with its outgoing side by transfer detection.
    if (looksLikeCardPayment(s) && !/\brefund\b/.test(s)) return "transfer";
    if (/\b(?:salary|wages|payroll|pay\s?slip|bacs.*pay)\b/.test(s)) return "salary";
    if (/\binterest\b/.test(s)) return "interest";
    if (/\b(?:refund|reversal|returned)\b/.test(s)) return "refunds";
    return null;
  }
  if (/\b(?:interest|overdraft fee|arranged overdraft|monthly fee|account fee|non-sterling)\b/.test(s)) return "fees";
  if (/\b(?:atm|cash withdrawal|cashpoint|link\s+atm)\b/.test(s)) return "cash";
  if (/\b(?:mortgage|rent)\b/.test(s)) return "housing";
  if (/\binsurance|insure\b/.test(s)) return "insurance";
  if (/\b(?:pharmacy|chemist|dental|dentist|optician)\b/.test(s)) return "health";
  if (/\b(?:vets?|veterinary|pets at home)\b/.test(s)) return "pets";
  return null;
}
