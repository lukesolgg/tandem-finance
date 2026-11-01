import { describe, expect, it } from "vitest";
import { categorise, identifyMerchant, learnedConfidence, type CategoriseContext } from "@/domain/categorisation/engine";
import { applyCorrection } from "@/domain/categorisation/learning";
import { findTransferPairs } from "@/domain/categorisation/transfers";

const empty: CategoriseContext = { rules: [], learned: new Map() };
const out = (description: string, amount = -1000, extra = {}) => ({ description, amount, ...extra });

describe("merchant identity", () => {
  it.each([
    ["Tesco Stores 3021 Belfast", "tesco"],
    ["TESCO EXPRESS", "tesco"],
    ["Uber *Eats Help.uber.com", "uber_eats"],
    ["Uber *Trip", "uber"],
    ["Sainsburys S/mkts", "sainsburys"],
    ["Marks&Spencer plc Sacat Belfast", "marks_and_spencer"],
    ["Power NI Energy", "power_ni"],
    ["Joe's Cafe 1234 Lisburn", "joe cafe"],
  ])("%s → %s", (d, key) => expect(identifyMerchant(d).key).toBe(key));

  it("doesn't confuse Tesco Mobile (a phone bill) with Tesco groceries", () => {
    expect(identifyMerchant("Tesco Mobile").key).not.toBe("tesco");
  });
});

describe("categorise precedence", () => {
  it("seed knowledge", () => {
    expect(categorise(out("Tesco Stores 3021"), empty)).toMatchObject({ categoryKey: "groceries", source: "seed" });
    expect(categorise(out("Netflix.com"), empty)).toMatchObject({ categoryKey: "subscriptions" });
    expect(categorise(out("Translink Metro"), empty)).toMatchObject({ categoryKey: "transport" });
  });

  it("household learning beats seed", () => {
    const ctx: CategoriseContext = {
      rules: [],
      learned: new Map([["spar", { key: "spar", categoryKey: "eating_out", confirmations: 3, overrides: 0 }]]),
    };
    expect(categorise(out("Spar Lisburn Rd"), ctx)).toMatchObject({ categoryKey: "eating_out", source: "learned" });
  });

  it("explicit rules beat learning, with side effects", () => {
    const ctx: CategoriseContext = {
      rules: [{ id: "r1", categoryKey: "gifts", priority: 10, descriptionContains: "pandora", markPrivate: true, renameTo: "Present 🤫" }],
      learned: new Map([["pandora", { key: "pandora", categoryKey: "shopping", confirmations: 5, overrides: 0 }]]),
    };
    expect(categorise(out("PANDORA JEWELLERY"), ctx)).toMatchObject({ categoryKey: "gifts", source: "rule", markPrivate: true, renameTo: "Present 🤫" });
  });

  it("rules respect direction and amount bounds; an empty rule never matches", () => {
    const ctx: CategoriseContext = {
      rules: [
        { id: "empty", categoryKey: "fees", priority: 1 },
        { id: "rent", categoryKey: "housing", priority: 5, descriptionContains: "j smith", direction: "out", amountMin: 50000 },
      ],
      learned: new Map(),
    };
    expect(categorise(out("J Smith", -65000), ctx).ruleId).toBe("rent");
    expect(categorise(out("J Smith", -2000), ctx).ruleId).toBeUndefined();
    expect(categorise(out("J Smith", 65000), ctx).ruleId).toBeUndefined();
  });

  it("falls back to bank category, then heuristics, then nothing", () => {
    expect(categorise(out("Some Indie Shop", -500, { bankCategory: "Shopping" }), empty)).toMatchObject({ categoryKey: "shopping", source: "bank" });
    expect(categorise(out("ACME LTD SALARY", 210000), empty)).toMatchObject({ categoryKey: "salary", source: "heuristic" });
    expect(categorise(out("Link ATM Belfast", -2000), empty)).toMatchObject({ categoryKey: "cash" });
    expect(categorise(out("Mystery Vendor"), empty)).toMatchObject({ categoryKey: null, source: null });
  });
});

describe("learning", () => {
  it("first correction learns; second identical suggests a rule; change of mind flips and resets", () => {
    let r = applyCorrection(undefined, "spar", "groceries");
    expect(r.next).toMatchObject({ categoryKey: "groceries", confirmations: 1 });
    r = applyCorrection(r.next, "spar", "groceries");
    expect(r.suggestRule).toBe(true);
    r = applyCorrection(r.next, "spar", "eating_out");
    expect(r.next).toMatchObject({ categoryKey: "eating_out", confirmations: 1, overrides: 1 });
  });
  it("confidence grows with agreement and decays with overrides", () => {
    expect(learnedConfidence({ confirmations: 1, overrides: 0 })).toBeCloseTo(0.83, 2);
    expect(learnedConfidence({ confirmations: 6, overrides: 0 })).toBeGreaterThan(0.9);
    expect(learnedConfidence({ confirmations: 1, overrides: 3 })).toBeLessThan(0.8);
  });
});

describe("transfer detection", () => {
  it("pairs opposite amounts across accounts within 3 days", () => {
    const pairs = findTransferPairs([
      { id: "a", accountId: "cur", date: "2026-10-01", amount: -50000, description: "Transfer to savings" },
      { id: "b", accountId: "sav", date: "2026-10-02", amount: 50000, description: "From current" },
      { id: "c", accountId: "cur", date: "2026-10-03", amount: -500, description: "Costa" },
      { id: "d", accountId: "partner", date: "2026-10-03", amount: 500, description: "Costa refund" },
      { id: "e", accountId: "cur", date: "2026-10-01", amount: -50000, description: "Rent" },
    ]);
    expect(pairs).toEqual([{ outId: "a", inId: "b" }]);
  });
});
