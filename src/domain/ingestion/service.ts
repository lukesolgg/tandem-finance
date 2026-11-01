import type { PrismaClient } from "@prisma/client";
import { buildReview, parseStatement, sha256Hex, type ReviewModel } from "./pipeline";
import { encrypt } from "@/lib/crypto";
import { canManageAccount, NotFoundError, type Viewer } from "../access/visibility";
import { categorise, type CategoriseContext, type LearnedMerchant } from "../categorisation/engine";
import { fingerprintRows, type LedgerTxn } from "./dedupe";
import { StatementParseError, type BankId } from "./types";
import { postImport } from "./post-import";

/**
 * Persistence side of ingestion: stage → (user reviews) → commit.
 *
 * Nothing here logs row contents. Errors carry codes, not data.
 */

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export interface StageInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  accountId: string;
  retainOriginal: boolean;
}

export class DuplicateFileError extends Error {
  constructor(public readonly statementId: string) {
    super("This exact file has already been imported.");
  }
}

export type StageResult =
  | { statementId: string; review: ReviewModel; error?: undefined }
  | { statementId: string; review?: undefined; error: { code: StatementParseError["code"]; message: string } };

export async function stageStatement(db: PrismaClient, viewer: Viewer, input: StageInput): Promise<StageResult> {
  const account = await db.account.findFirst({ where: { id: input.accountId, householdId: viewer.householdId } });
  if (!account || !canManageAccount(viewer, account)) throw new NotFoundError();

  const sha256 = sha256Hex(input.bytes);
  const existing = await db.statement.findFirst({
    where: { householdId: viewer.householdId, accountId: account.id, sha256, status: { in: ["committed", "needs_review", "parsed"] } },
    select: { id: true },
  });
  if (existing) throw new DuplicateFileError(existing.id);

  const base = {
    householdId: viewer.householdId,
    accountId: account.id,
    uploadedById: viewer.userId,
    originalFilename: input.filename.slice(0, 255),
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    sha256,
  };

  let parsed;
  try {
    parsed = await parseStatement({
      bytes: input.bytes,
      filename: input.filename,
      mimeType: input.mimeType,
      hint: { bankId: (account.institution as BankId | null) ?? undefined, accountType: asTypeHint(account.type) },
    });
  } catch (err) {
    const code = err instanceof StatementParseError ? err.code : "malformed";
    const failed = await db.statement.create({ data: { ...base, format: "unknown", status: "failed", errorCode: code } });
    return { statementId: failed.id, error: { code, message: err instanceof Error ? err.message : "Parse failed" } };
  }

  const ledger = await loadLedgerWindow(db, account.id, parsed.meta.periodStart, parsed.meta.periodEnd);
  const review = buildReview(account.id, parsed, ledger);

  // Encrypt the original AFTER we know the statement id (bound as AAD).
  const statement = await db.statement.create({
    data: {
      ...base,
      format: parsed.meta.format,
      bankId: parsed.meta.bankId,
      parserId: parsed.meta.parserId,
      status: review.canQuickCommit ? "parsed" : "needs_review",
      confidence: review.result.confidence,
      reconciled: parsed.reconciled,
      periodStart: parsed.meta.periodStart ? toDate(parsed.meta.periodStart) : null,
      periodEnd: parsed.meta.periodEnd ? toDate(parsed.meta.periodEnd) : null,
      openingBalance: parsed.meta.openingBalance ?? null,
      closingBalance: parsed.meta.closingBalance ?? null,
      rows: {
        create: review.rows.map((r) => ({
          rowIndex: r.index,
          date: toDate(r.date),
          amount: r.amount,
          description: r.description,
          rawDescription: r.rawDescription,
          runningBalance: r.runningBalance ?? null,
          externalId: r.externalId ?? null,
          confidence: r.confidence,
          warnings: JSON.stringify(r.warnings),
          disposition: r.disposition.kind === "new" ? "new" : "duplicate",
          duplicateOfId: r.disposition.kind === "new" ? null : r.disposition.of,
        })),
      },
    },
  });

  if (input.retainOriginal) {
    const enc = encrypt(input.bytes, statement.id);
    const blob = await db.statementBlob.create({ data: { statementId: statement.id, ciphertext: new Uint8Array(enc.ciphertext) } });
    await db.statement.update({
      where: { id: statement.id },
      data: { storageKey: blob.id, encryptionIv: enc.iv, encryptionTag: enc.tag },
    });
  }

  return { statementId: statement.id, review };
}

export interface CommitDecisions {
  /** Row indices to skip even though they're "new". */
  exclude?: number[];
  /** Row indices flagged duplicate/possible-duplicate that the user says ARE new. */
  forceInclude?: number[];
  /** Per-row overrides from the review table. */
  edits?: Record<number, { date?: string; amount?: number; description?: string }>;
}

/**
 * Commit staged rows into the ledger, atomically. Categorisation runs here (not
 * at stage time) so it uses the very latest rules/learning — including rules
 * the user created a minute ago while reviewing another statement.
 */
export async function commitStatement(db: PrismaClient, viewer: Viewer, statementId: string, decisions: CommitDecisions = {}) {
  const stmt = await db.statement.findFirst({
    where: { id: statementId, householdId: viewer.householdId, status: { in: ["parsed", "needs_review"] } },
    include: { rows: { orderBy: { rowIndex: "asc" } }, account: true },
  });
  if (!stmt?.account || !canManageAccount(viewer, stmt.account)) throw new NotFoundError();
  const account = stmt.account;

  const exclude = new Set(decisions.exclude ?? []);
  const force = new Set(decisions.forceInclude ?? []);
  const ctx = await loadCategoriseContext(db, viewer.householdId, account.id);
  const categories = new Map(
    (await db.category.findMany({ where: { householdId: viewer.householdId }, select: { id: true, key: true } }))
      .filter((c) => c.key)
      .map((c) => [c.key!, c.id]),
  );

  // Fingerprints are recomputed from final (possibly edited) values.
  const finalRows = stmt.rows.map((r) => {
    const e = decisions.edits?.[r.rowIndex] ?? {};
    return {
      row: r,
      parsed: {
        index: r.rowIndex,
        date: e.date ?? toIso(r.date),
        amount: e.amount ?? r.amount,
        description: e.description ?? r.description,
        rawDescription: r.rawDescription,
        warnings: [],
        confidence: r.confidence,
      },
    };
  });
  const withFp = fingerprintRows(account.id, finalRows.map((f) => f.parsed));

  const result = await db.$transaction(async (tx) => {
    let created = 0;
    const merchantIds = new Map<string, string>();
    for (const [i, { row, parsed }] of finalRows.entries()) {
      const include = row.disposition === "new" ? !exclude.has(row.rowIndex) : force.has(row.rowIndex);
      if (!include) {
        await tx.statementRow.update({ where: { id: row.id }, data: { disposition: row.disposition === "new" ? "user_excluded" : row.disposition } });
        continue;
      }
      const cat = categorise({ description: parsed.description, rawDescription: parsed.rawDescription, amount: parsed.amount, accountId: account.id }, ctx);

      let merchantId = merchantIds.get(cat.merchantKey);
      if (!merchantId) {
        const m = await tx.merchant.upsert({
          where: { householdId_normalisedKey: { householdId: viewer.householdId, normalisedKey: cat.merchantKey } },
          create: { householdId: viewer.householdId, normalisedKey: cat.merchantKey, name: cat.merchantName },
          update: {},
        });
        merchantId = m.id;
        merchantIds.set(cat.merchantKey, merchantId);
      }

      // Unique (accountId, fingerprint) is the last line of defence against double import:
      // upsert-skip rather than fail the whole commit on a race.
      const fp = withFp[i]!.fingerprint;
      const exists = await tx.transaction.findUnique({ where: { accountId_fingerprint: { accountId: account.id, fingerprint: fp } }, select: { id: true } });
      if (exists && !force.has(row.rowIndex)) {
        await tx.statementRow.update({ where: { id: row.id }, data: { disposition: "duplicate", duplicateOfId: exists.id } });
        continue;
      }
      await tx.transaction.create({
        data: {
          accountId: account.id,
          date: toDate(parsed.date),
          amount: parsed.amount,
          currency: account.currency,
          description: cat.renameTo ?? parsed.description,
          rawDescription: parsed.rawDescription,
          merchantId,
          categoryId: !cat.categoryKey ? null : cat.categoryKey.startsWith("id:") ? cat.categoryKey.slice(3) : (categories.get(cat.categoryKey) ?? null),
          categorySource: cat.source,
          categoryConfidence: cat.confidence,
          isPrivate: Boolean(cat.markPrivate),
          privateOwnerId: cat.markPrivate ? viewer.userId : null,
          // A forced-in "duplicate" needs a distinct fingerprint.
          fingerprint: exists ? `${fp}:${row.id}` : fp,
          externalId: row.externalId,
          source: "statement",
          statementId: stmt.id,
        },
      });
      await tx.statementRow.update({ where: { id: row.id }, data: { disposition: "committed" } });
      created++;
    }

    if (stmt.closingBalance !== null && stmt.periodEnd) {
      await tx.balanceSnapshot.upsert({
        where: { accountId_date_source: { accountId: account.id, date: stmt.periodEnd, source: "statement_closing" } },
        create: { accountId: account.id, date: stmt.periodEnd, balance: stmt.closingBalance, source: "statement_closing", statementId: stmt.id },
        update: { balance: stmt.closingBalance, statementId: stmt.id },
      });
    }
    await tx.statement.update({ where: { id: stmt.id }, data: { status: "committed", committedAt: new Date() } });
    await tx.activityLog.create({
      data: {
        householdId: viewer.householdId,
        actorId: viewer.userId,
        action: "statement.committed",
        entityType: "statement",
        entityId: stmt.id,
        // No amounts or descriptions in the log — the partner can read it.
        summary: `Imported ${created} transaction${created === 1 ? "" : "s"}`,
        visibleToPartner: account.ownerId === null || account.visibility === "shared",
      },
    });
    return { created };
  });
  // Cross-account passes run outside the commit transaction: they're idempotent
  // and a failure there must not roll back the import.
  const post = result.created > 0 ? await postImport(db, viewer.householdId).catch(() => ({ transfers: 0, recurring: 0 })) : { transfers: 0, recurring: 0 };
  return { ...result, ...post };
}

// ── helpers ────────────────────────────────────────────────────────────────

async function loadLedgerWindow(db: PrismaClient, accountId: string, start?: string, end?: string): Promise<LedgerTxn[]> {
  // ±7 days around the statement period covers posted-vs-transaction drift.
  const pad = 7 * 86_400_000;
  const where = {
    accountId,
    parentId: null,
    ...(start && end ? { date: { gte: new Date(toDate(start).getTime() - pad), lte: new Date(toDate(end).getTime() + pad) } } : {}),
  };
  const txns = await db.transaction.findMany({ where, select: { id: true, date: true, amount: true, description: true, externalId: true, fingerprint: true } });
  return txns.map((t) => ({ ...t, date: toIso(t.date) }));
}

export async function loadCategoriseContext(db: PrismaClient, householdId: string, accountId?: string): Promise<CategoriseContext> {
  const [rules, merchants] = await Promise.all([
    db.categorisationRule.findMany({ where: { householdId, OR: [{ accountId: null }, ...(accountId ? [{ accountId }] : [])] }, include: { category: { select: { key: true, id: true } } } }),
    db.merchant.findMany({ where: { householdId, defaultCategoryId: { not: null } }, include: { defaultCategory: { select: { key: true, id: true } } } }),
  ]);
  const learned = new Map<string, LearnedMerchant>();
  for (const m of merchants) {
    // Custom (user-created) categories have no key; reference them by id instead.
    const key = m.defaultCategory?.key ?? (m.defaultCategory ? `id:${m.defaultCategory.id}` : null);
    if (key) learned.set(m.normalisedKey, { key: m.normalisedKey, categoryKey: key, confirmations: m.confirmations, overrides: m.overrides });
  }
  return {
    rules: rules.map((r) => ({ ...r, categoryKey: r.category.key ?? `id:${r.category.id}` })),
    learned,
  };
}

function asTypeHint(t: string): "current" | "savings" | "credit_card" | undefined {
  return t === "current" || t === "savings" || t === "credit_card" ? t : undefined;
}

export type { ReviewModel };
