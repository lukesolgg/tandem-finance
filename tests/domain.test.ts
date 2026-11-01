import { describe, expect, it } from "vitest";
import { elapsedFraction, periodContaining, periodForKey, shiftPeriod } from "@/domain/periods";
import { carryForward, lineStatus, summarise } from "@/domain/budgets/compute";
import { planGoal, splitContribution } from "@/domain/goals/plan";
import { detectRecurring } from "@/domain/recurring/detect";
import { totals, type AggTxn } from "@/domain/insights/aggregate";
import { hashPassword, verifyPassword } from "@/domain/auth/password";

describe("payday-aligned periods", () => {
  it("calendar months when start day is 1", () => {
    expect(periodForKey("2026-02", 1)).toMatchObject({ start: "2026-02-01", end: "2026-02-28", label: "February 2026" });
  });
  it("payday 25: November = 25 Oct → 24 Nov; January wraps the year", () => {
    expect(periodForKey("2026-11", 25)).toMatchObject({ start: "2026-10-25", end: "2026-11-24" });
    expect(periodForKey("2026-01", 25)).toMatchObject({ start: "2025-12-25", end: "2026-01-24" });
    expect(periodContaining("2026-11-25", 25).key).toBe("2026-12");
    expect(periodContaining("2026-11-24", 25).key).toBe("2026-11");
  });
  it("payday 31 clamps to short months", () => {
    expect(periodForKey("2026-03", 31)).toMatchObject({ start: "2026-02-28", end: "2026-03-30" });
  });
  it("shifts and measures", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(elapsedFraction(periodForKey("2026-11", 1), "2026-11-15")).toBeCloseTo(0.48, 1);
  });
});

describe("budget maths", () => {
  it("status, pace and overspend", () => {
    const l = lineStatus({ categoryId: "g", allocated: 40000, carriedIn: 0, spent: 30000 }, 0.5);
    expect(l).toMatchObject({ available: 40000, remaining: 10000, state: "ok", aheadOfPace: true });
    expect(lineStatus({ categoryId: "g", allocated: 10000, carriedIn: 0, spent: 12000 }, 0.9).state).toBe("over");
  });
  it("rollover policies", () => {
    const prev = { allocated: 10000, carriedIn: 0, spent: 12500 };
    expect(carryForward(prev, "none")).toBe(0);
    expect(carryForward(prev, "positive")).toBe(0);
    expect(carryForward(prev, "both")).toBe(-2500);
    expect(carryForward({ ...prev, spent: 6000 }, "positive")).toBe(4000);
  });
  it("zero-based: income left to assign", () => {
    const lines = [lineStatus({ categoryId: "a", allocated: 150000, carriedIn: 0, spent: 0 }, 0)];
    expect(summarise(lines, 300000).toAssign).toBe(150000);
  });
});

describe("goals", () => {
  it("monthly amount needed and pace projection", () => {
    const p = planGoal({
      target: 500000,
      saved: 200000,
      targetDate: "2027-06-01",
      today: "2026-11-01",
      recentContributions: [
        { date: "2026-10-01", amount: 30000 },
        { date: "2026-09-01", amount: 30000 },
        { date: "2026-08-15", amount: 30000 },
      ],
    });
    expect(p.monthsLeft).toBe(8);
    expect(p.monthlyNeeded).toBe(37500);
    expect(p.onTrack).toBe(false); // £300/mo pace < £375 needed
    expect(p.progress).toBeCloseTo(0.4);
  });
  it("splits contributions without losing pennies", () => {
    expect(splitContribution(37501, 0.5)).toEqual([18751, 18750]);
    expect(splitContribution(10000, 0.6)).toEqual([6000, 4000]);
  });
});

describe("recurring detection", () => {
  it("finds a monthly DD with weekend drift, a four-weekly salary, ignores noise", () => {
    const mk = (key: string, dates: string[], amount: number) => dates.map((date, i) => ({ id: `${key}${i}`, merchantKey: key, date, amount }));
    const out = detectRecurring([
      ...mk("netflix", ["2026-07-15", "2026-08-17", "2026-09-15", "2026-10-15"], -1099),
      ...mk("acme", ["2026-07-03", "2026-07-31", "2026-08-28", "2026-09-25"], 210000),
      ...mk("tesco", ["2026-07-02", "2026-07-05", "2026-07-19", "2026-08-30"], -2300),
    ]);
    const by = Object.fromEntries(out.map((s) => [s.merchantKey, s]));
    expect(by.netflix).toMatchObject({ cadence: "monthly", typicalAmount: -1099, nextExpected: "2026-11-15" });
    expect(by.acme).toMatchObject({ cadence: "four_weekly", nextExpected: "2026-10-23" });
    expect(by.tesco).toBeUndefined();
  });
});

describe("cash-flow aggregation", () => {
  const t = (amount: number, groupKind: AggTxn["groupKind"], extra: Partial<AggTxn> = {}): AggTxn => ({
    date: "2026-10-01", amount, categoryId: groupKind ? "c" : null, groupKind, merchantKey: "m", merchantName: "M", isTransfer: false, ownerId: "u", ...extra,
  });
  it("ignores transfers, nets refunds against spend", () => {
    const r = totals([t(-5000, "expense"), t(1000, "expense"), t(200000, "income"), t(-50000, "transfer"), t(-700, null), t(-9999, null, { isTransfer: true })]);
    expect(r).toMatchObject({ income: 200000, spend: 4700, net: 195300 });
  });
});

describe("passwords", () => {
  it("hashes and verifies; rejects wrong and missing", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});
