/**
 * Budget periods aligned to payday.
 *
 * A household with monthStartDay=25 budgets "25 Oct → 24 Nov" and calls it
 * November (the month most of the period falls in, and the month the money
 * is for). monthStartDay=1 gives plain calendar months.
 *
 * Periods are identified by `YYYY-MM` keys and stored as the period's start
 * date at UTC midnight.
 */
export interface Period {
  key: string; // "2026-11"
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
  label: string; // "November 2026"
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
/** Clamp day to month length (payday 31 in February → 28/29). */
const dayIn = (y: number, m: number, d: number) => Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());

export function periodForKey(key: string, startDay: number): Period {
  const [y, m] = key.split("-").map(Number) as [number, number];
  if (startDay <= 1) {
    return { key, start: iso(y, m, 1), end: iso(y, m + 1, 0), label: labelFor(y, m) };
  }
  // Period "named" m starts on startDay of the previous month.
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const start = iso(py, pm, dayIn(py, pm, startDay));
  const endDate = new Date(Date.parse(iso(y, m, dayIn(y, m, startDay)) + "T00:00:00Z") - 86_400_000);
  return { key, start, end: endDate.toISOString().slice(0, 10), label: labelFor(y, m) };
}

export function periodContaining(date: string, startDay: number): Period {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  if (startDay <= 1 || d < dayIn(y, m, startDay)) return periodForKey(`${y}-${pad(m)}`, startDay);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return periodForKey(`${ny}-${pad(nm)}`, startDay);
}

export function shiftPeriod(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function labelFor(y: number, m: number): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Fraction of the period elapsed (0..1) — for "on pace" indicators. */
export function elapsedFraction(p: Period, today = todayIso()): number {
  const s = Date.parse(p.start);
  const e = Date.parse(p.end) + 86_400_000;
  const t = Date.parse(today) + 86_400_000 / 2;
  return Math.max(0, Math.min(1, (t - s) / (e - s)));
}
