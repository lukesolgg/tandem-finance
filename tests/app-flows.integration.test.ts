import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestDb, TEST_DB } from "./helpers/db";
import { acceptInvite, changePin, createInvite, findInvite, loginPeople, loginWithPin, signUp, signupAllowed } from "@/domain/household/service";
import { commitStatement, stageStatement } from "@/domain/ingestion/service";
import { listTransactions, setCategory, splitTransaction, setPrivate, createMerchantRule } from "@/domain/transactions/service";
import { budgetView, setBudgetLine } from "@/domain/budgets/service";
import { contribute, createGoal, listGoals } from "@/domain/goals/service";
import { netWorth, periodTotals } from "@/domain/insights/service";
import { periodForKey } from "@/domain/periods";
import type { Viewer } from "@/domain/access/visibility";

let db: PrismaClient;
let drop: () => Promise<void>;
const fx = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, "fixtures", n)));
let a: Viewer;
let b: Viewer;
let joint: string;
let cat: (key: string) => Promise<string>;

beforeAll(async () => {
  process.env.STATEMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  if (!TEST_DB) return;
  ({ db, drop } = await createTestDb());
  cat = async (key) => (await db.category.findFirstOrThrow({ where: { householdId: a.householdId, key } })).id;
}, 60_000);
afterAll(async () => {
  await drop?.();
});

describe.runIf(TEST_DB)("household onboarding", () => {
  it("first user signs up with a PIN, then sign-up closes; partner joins by invite link", async () => {
    expect(await signupAllowed(db)).toBe(true);
    await expect(signUp(db, { name: "Luke", pin: "12345678" })).rejects.toThrow(/sequence/);
    await expect(signUp(db, { name: "Luke", pin: "15041990" })).rejects.toThrow(/date/);
    await expect(signUp(db, { name: "Luke", pin: "1234" })).rejects.toThrow(/8 digits/);
    const u = await signUp(db, { name: "Luke", pin: "27183141", householdName: "Us" });
    expect(await signupAllowed(db)).toBe(false);
    await expect(signUp(db, { name: "X", pin: "27183141" })).rejects.toThrow(/already set up/);
    const m = await db.householdMember.findUniqueOrThrow({ where: { userId: u.id } });
    a = { userId: u.id, householdId: m.householdId };

    const { token } = await createInvite(db, a);
    expect(await findInvite(db, token)).not.toBeNull();
    await expect(acceptInvite(db, token, { name: "luke", pin: "31415926" })).rejects.toThrow(/already in this household/);
    const p = await acceptInvite(db, token, { name: "Sam", pin: "31415926" });
    b = { userId: p.id, householdId: a.householdId };
    expect(await findInvite(db, token)).toBeNull(); // single use
    await expect(createInvite(db, a)).rejects.toThrow(/two people/);
    expect(await db.category.count({ where: { householdId: a.householdId } })).toBeGreaterThan(25);
    expect((await loginPeople(db)).map((x) => x.name)).toEqual(["Luke", "Sam"]);
  });

  it("PIN sign-in locks after 5 wrong tries, survives the right PIN while locked, then resets", async () => {
    expect((await loginWithPin(db, a.userId, "27183141")).id).toBe(a.userId);
    for (let i = 0; i < 4; i++) await expect(loginWithPin(db, a.userId, "00000001")).rejects.toThrow(/(try|tries) left/);
    await expect(loginWithPin(db, a.userId, "00000001")).rejects.toThrow(/Locked for 15 minutes/);
    await expect(loginWithPin(db, a.userId, "27183141")).rejects.toThrow(/Try again in/); // right PIN still refused while locked
    await db.user.update({ where: { id: a.userId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await loginWithPin(db, a.userId, "27183141")).id).toBe(a.userId);
    // Sam's PIN doesn't open Luke's account
    await expect(loginWithPin(db, a.userId, "31415926")).rejects.toThrow(/isn't right/);
    await changePin(db, a, "27183141", "16180339");
    expect((await loginWithPin(db, a.userId, "16180339")).id).toBe(a.userId);
  });
});

describe.runIf(TEST_DB)("everyday use", () => {
  it("joint account import → categorise with learning → rule → split → private", async () => {
    joint = (await db.account.create({ data: { householdId: a.householdId, ownerId: null, name: "Joint", type: "current", institution: "starling" } })).id;
    const staged = await stageStatement(db, a, { bytes: fx("starling.csv"), filename: "s.csv", mimeType: "text/csv", accountId: joint, retainOriginal: false });
    const res = await commitStatement(db, a, staged.statementId);
    expect(res.created).toBe(5);

    const { rows } = await listTransactions(db, b, { accountId: joint });
    expect(rows).toHaveLength(5);
    const costa = rows.find((r) => r.amount === -320)!;
    expect(costa.category?.name).toMatch(/Eating out/);

    // B recategorises Costa twice → rule suggested
    const groceries = await cat("groceries");
    const r1 = await setCategory(db, b, costa.id, groceries);
    expect(r1.suggestRule).toBe(false);
    const other = rows.filter((r) => r.amount === -320)[1]!;
    const r2 = await setCategory(db, b, other.id, groceries);
    expect(r2.suggestRule).toBe(true);
    const rule = await createMerchantRule(db, b, { merchantKey: "costa", categoryId: groceries, applyToExisting: true });
    expect(rule.updated).toBe(2);

    // Split the Sainsbury's shop: groceries + household
    const shop = rows.find((r) => r.amount === -3150)!;
    await splitTransaction(db, a, shop.id, [
      { categoryId: groceries, amount: -2500 },
      { categoryId: await cat("household"), amount: -650 },
    ]);
    await expect(splitTransaction(db, a, shop.id, [{ categoryId: groceries, amount: -1 }, { categoryId: groceries, amount: -2 }])).rejects.toThrow(/add up/);

    // B hides the water bill from A (joint account)
    const water = rows.find((r) => r.amount === -4200)!;
    await setPrivate(db, b, water.id, true);
    expect((await listTransactions(db, a, { accountId: joint })).rows).toHaveLength(4);
    await expect(setPrivate(db, a, water.id, false)).rejects.toThrow("Not found");
  });

  it("budgets count splits, not parents; private items don't leak into partner totals", async () => {
    const key = "2026-10";
    const groceries = await cat("groceries");
    await setBudgetLine(db, a, "household", key, 1, groceries, 40000, "positive");
    const viewA = await budgetView(db, a, "household", key, 1);
    const line = viewA.lines.find((l) => l.categoryId === groceries)!;
    expect(line.spent).toBe(2500 + 320 + 320); // split part + 2 recategorised coffees
    expect(line.remaining).toBe(40000 - 3140);

    const p = periodForKey(key, 1);
    const tA = await periodTotals(db, a, p);
    const tB = await periodTotals(db, b, p);
    expect(tB.spend - tA.spend).toBe(4200); // only B counts the hidden water bill
    expect(tA.income).toBe(60000);
  });

  it("goals: shared goal, contributions from both, monthly suggestion", async () => {
    const g = await createGoal(db, a, { name: "Kraków trip", targetAmount: 200000, targetDate: "2027-05-01", shared: true });
    await contribute(db, a, g.id, 30000, "2026-10-28");
    await contribute(db, b, g.id, 20000, "2026-10-29");
    const [goal] = await listGoals(db, b);
    expect(goal!.saved).toBe(50000);
    expect(goal!.byPerson).toEqual({ [a.userId]: 30000, [b.userId]: 20000 });
    expect(goal!.plan.monthlyNeeded).toBeGreaterThan(0);
    // A's private personal goal is invisible to B
    await createGoal(db, a, { name: "Ring", targetAmount: 150000, shared: false, isPrivate: true });
    expect((await listGoals(db, b)).map((x) => x.name)).toEqual(["Kraków trip"]);
    expect((await listGoals(db, a)).length).toBe(2);
  });

  it("net worth rolls statement balance forward", async () => {
    const nw = await netWorth(db, a);
    const j = nw.accounts.find((x) => x.id === joint)!;
    // Starling closing 1020.10; A can't count B's hidden −42.00 but balances come from the statement.
    expect(j.balance).toBe(102010);
  });
});
