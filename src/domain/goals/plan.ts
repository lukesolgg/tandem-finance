/**
 * Goal planning — pure.
 *
 * "To hit £5,000 by June you need £625/month" — split between partners either
 * evenly or by a chosen share (e.g. proportional to income).
 */
export interface GoalPlanInput {
  target: number;
  saved: number;
  targetDate?: string | null; // ISO
  today: string; // ISO
  /** Contributions in the last 90 days, for the pace projection. */
  recentContributions?: { date: string; amount: number }[];
}

export interface GoalPlan {
  remaining: number;
  progress: number; // 0..1
  monthsLeft: number | null;
  monthlyNeeded: number | null;
  /** At the recent pace, the month the goal completes. */
  projectedDate: string | null;
  onTrack: boolean | null;
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

export function planGoal(g: GoalPlanInput): GoalPlan {
  const remaining = Math.max(0, g.target - g.saved);
  const progress = g.target > 0 ? Math.min(1, g.saved / g.target) : 0;
  let monthsLeft: number | null = null;
  let monthlyNeeded: number | null = null;
  if (g.targetDate) {
    // Count the current month as a contribution month.
    monthsLeft = Math.max(0, monthsBetween(g.today, g.targetDate)) + 1;
    monthlyNeeded = remaining === 0 ? 0 : Math.ceil(remaining / monthsLeft);
  }
  let projectedDate: string | null = null;
  const recent = (g.recentContributions ?? []).filter((c) => monthsBetween(c.date, g.today) < 3);
  const perMonth = recent.reduce((s, c) => s + c.amount, 0) / 3;
  if (remaining === 0) projectedDate = g.today;
  else if (perMonth > 0) {
    const months = Math.ceil(remaining / perMonth);
    const d = new Date(g.today + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + months);
    projectedDate = d.toISOString().slice(0, 10);
  }
  const onTrack = g.targetDate ? (remaining === 0 ? true : projectedDate ? projectedDate <= g.targetDate : false) : null;
  return { remaining, progress, monthsLeft, monthlyNeeded, projectedDate, onTrack };
}

/** Split a monthly amount between two people by share (0..1 for person A). Pennies go to A. */
export function splitContribution(monthly: number, shareA = 0.5): [number, number] {
  const b = Math.floor(monthly * (1 - shareA));
  return [monthly - b, b];
}
