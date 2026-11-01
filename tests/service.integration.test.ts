import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestDb, TEST_DB } from "./helpers/db";
import { hashPassword } from "@/domain/auth/password";
import { createHousehold } from "@/domain/household/seed-household";
import { commitStatement, stageStatement } from "@/domain/ingestion/service";
import { aggregateTransactionWhere, transactionWhere, accountWhere, type Viewer } from "@/domain/access/visibility";
import { decrypt } from "@/lib/crypto";

/**
 * End-to-end over a real Postgres DB: upload → stage → commit → re-upload
 * overlap → privacy between partners.
 */
let db: PrismaClient;
let drop: () => Promise<void>;
const fx = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, "fixtures", n)));

let luke: Viewer;
let partner: Viewer;
let lukeCurrent: string;
let lukeSecret: string;
let joint: string;

beforeAll(async () => {
  if (!TEST_DB) return;
  process.env.STATEMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  ({ db, drop } = await createTestDb());
  const pinHash = await hashPassword("27183141");
  const a = await db.user.create({ data: { name: "A", pinHash } });
  const b = await db.user.create({ data: { name: "B", pinHash } });
  const hh = await createHousehold(db, a.id, "Us");
  await db.householdMember.create({ data: { householdId: hh.id, userId: b.id } });
  luke = { userId: a.id, householdId: hh.id };
  partner = { userId: b.id, householdId: hh.id };
  lukeCurrent = (await db.account.create({ data: { householdId: hh.id, ownerId: a.id, name: "Monzo", type: "current", institution: "monzo" } })).id;
  lukeSecret = (await db.account.create({ data: { householdId: hh.id, ownerId: a.id, name: "Rainy day", type: "savings", visibility: "private" } })).id;
  joint = (await db.account.create({ data: { householdId: hh.id, ownerId: null, name: "Joint", type: "current", institution: "starling" } })).id;
}, 60_000);

afterAll(async () => {
  await drop?.();
});

describe.runIf(TEST_DB)("ingestion service", () => {
  it("stages, encrypts the original, and commits with categories", async () => {
    const staged = await stageStatement(db, luke, { bytes: fx("monzo.csv"), filename: "monzo.csv", mimeType: "text/csv", accountId: lukeCurrent, retainOriginal: true });
    if (!staged.review) throw new Error("expected review");
    expect(staged.review.summary.new).toBe(5);

    const stmt = await db.statement.findUniqueOrThrow({ where: { id: staged.statementId }, include: { blob: true } });
    const enc = { ciphertext: Buffer.from(stmt.blob!.ciphertext), iv: stmt.encryptionIv!, tag: stmt.encryptionTag! };
    expect(enc.ciphertext.includes(Buffer.from("Pret A Manger"))).toBe(false); // stored encrypted
    expect(decrypt(enc, stmt.id).equals(Buffer.from(fx("monzo.csv")))).toBe(true);
    // AAD binding: the blob can't be decrypted as a different statement.
    expect(() => decrypt(enc, "other")).toThrow();

    const { created } = await commitStatement(db, luke, staged.statementId);
    expect(created).toBe(5);
    const tesco = await db.transaction.findFirstOrThrow({ where: { accountId: lukeCurrent, amount: -2318 }, include: { category: true, merchant: true } });
    expect(tesco.category?.key).toBe("groceries");
    expect(tesco.merchant?.normalisedKey).toBe("tesco");
  });

  it("refuses the identical file twice", async () => {
    await expect(stageStatement(db, luke, { bytes: fx("monzo.csv"), filename: "again.csv", mimeType: "text/csv", accountId: lukeCurrent, retainOriginal: false })).rejects.toThrow(/already been imported/);
  });

  it("an overlapping export in a different format imports nothing twice", async () => {
    const { monzoStylePdf } = await import("./helpers/pdf-fixtures");
    const staged = await stageStatement(db, luke, { bytes: await monzoStylePdf(), filename: "oct.pdf", mimeType: "application/pdf", accountId: lukeCurrent, retainOriginal: false });
    if (!staged.review) throw new Error("expected review");
    expect(staged.review.summary).toMatchObject({ new: 0, duplicates: 3 });
    const { created } = await commitStatement(db, luke, staged.statementId);
    expect(created).toBe(0);
    expect(await db.transaction.count({ where: { accountId: lukeCurrent } })).toBe(5);
  });

  it("partner cannot stage into someone else's personal account", async () => {
    await expect(stageStatement(db, partner, { bytes: fx("starling.csv"), filename: "s.csv", mimeType: "text/csv", accountId: lukeCurrent, retainOriginal: false })).rejects.toThrow("Not found");
  });

  it("either partner can import into the joint account; parse failures are recorded, not thrown", async () => {
    const ok = await stageStatement(db, partner, { bytes: fx("starling.csv"), filename: "s.csv", mimeType: "text/csv", accountId: joint, retainOriginal: false });
    if (!ok.review) throw new Error("expected review");
    await commitStatement(db, partner, ok.statementId);
    const bad = await stageStatement(db, partner, { bytes: new TextEncoder().encode("hello"), filename: "x.pdf", mimeType: "application/pdf", accountId: joint, retainOriginal: false });
    expect(bad).toMatchObject({ error: { code: "unsupported_format" } });
  });
});

describe.runIf(TEST_DB)("privacy between partners", () => {
  it("private accounts, summary-only accounts and private transactions", async () => {
    await db.transaction.create({ data: { accountId: lukeSecret, date: new Date("2026-10-20"), amount: 99900, description: "Secret stash", rawDescription: "x", fingerprint: "s1" } });
    const joinedCoffee = await db.transaction.findFirstOrThrow({ where: { accountId: joint, amount: -320 } });
    await db.transaction.update({ where: { id: joinedCoffee.id }, data: { isPrivate: true, privateOwnerId: partner.userId } });

    const sum = async (v: Viewer) => (await db.transaction.aggregate({ where: aggregateTransactionWhere(v), _sum: { amount: true } }))._sum.amount ?? 0;
    const rows = (v: Viewer) => db.transaction.count({ where: transactionWhere(v) });
    const accts = async (v: Viewer) => (await db.account.findMany({ where: accountWhere(v) })).map((a) => a.name).sort();

    // Partner can't see Luke's private account at all…
    expect(await accts(partner)).toEqual(["Joint", "Monzo"]);
    expect(await accts(luke)).toEqual(["Joint", "Monzo", "Rainy day"]);
    // …and Luke can't see the coffee the partner hid in the joint account.
    expect(await rows(luke)).toBe(5 + 1 + 4); // Monzo 5 + secret 1 + joint 5 − 1 hidden
    expect(await rows(partner)).toBe(5 + 5);

    // Switch Monzo to summary_only: partner loses rows but keeps totals.
    const before = await sum(partner);
    await db.account.update({ where: { id: lukeCurrent }, data: { visibility: "summary_only" } });
    expect(await rows(partner)).toBe(5);
    expect(await sum(partner)).toBe(before);
    // The hidden £3.20 is in partner's totals but not Luke's; the stash only in Luke's.
    // Luke's total = everything − partner's hidden coffee; partner's = everything − Luke's stash.
    expect((await sum(luke)) - (await sum(partner))).toBe(99900 - -320);
  });
});
