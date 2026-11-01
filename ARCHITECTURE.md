# Tandem — architecture

> Working name **Tandem** (two people, one direction). "Us & Money" works too; Tandem is shorter, brandable, and doesn't read as a budgeting app for one.

## Shape of the system

```
Browser (Next.js App Router, RSC + client islands, PWA)
   │  server actions / route handlers — every call resolves a Viewer first
   ▼
Domain layer  src/domain/*            ← pure TypeScript, no framework imports
   ├─ ingestion/      bytes → ParseResult → review → ledger
   ├─ categorisation/ rules → learned → seed → bank hint → heuristics
   ├─ access/         THE privacy model (where-builders + predicates)
   ├─ household/      creation, invites, seeding
   ├─ budgets/ goals/ insights/   (phase 5)
   ▼
Prisma  →  Postgres (Neon on Vercel, or the docker-compose Postgres)
StatementBlob table  ← AES-256-GCM ciphertext of originals (no separate blob service)
```

**Why a pure domain layer:** the hardest code here (parsing, dedupe, privacy, budget maths) is all deterministic. Keeping it free of Next/React/Prisma means it is unit-tested against fixtures in milliseconds, and it can move to a worker or a CLI unchanged.

## Ingestion pipeline (the foundation)

```
upload ─► detectFormat (magic bytes > extension)
        ─► parse
             CSV : profile match (11 UK/IE layouts) → generic synonyms → headerless
             OFX : SGML + XML, FITID, LEDGERBAL
             PDF : pdf.js positional text → header-anchored column map → line classification
                   → multi-line assembly (leads | terminates) → balance-group sign solving
        ─► normalise (UK date order proof, integer pence, description cleaning)
        ─► reconcile (running balance chain | opening + Σ = closing)
        ─► confidence (per row from warnings, per statement with reconciliation)
        ─► dedupe vs ledger (externalId → fingerprint → fuzzy=flag)
        ─► STAGE (Statement + StatementRow)  ── user reviews/edits ──► COMMIT (atomic)
                                                                         ↳ categorise with latest rules
                                                                         ↳ merchant upsert, balance snapshot
                                                                         ↳ activity log (no amounts)
```

Key decisions:

| Decision | Why |
|---|---|
| Money as integer minor units, signed (− = out) | No float drift; one sign convention everywhere. |
| Dates as `YYYY-MM-DD` strings in the domain, UTC midnight in the DB | Statements have no time; avoids BST off-by-one. |
| DD/MM vs MM/DD decided per **column**, not per value | One `13/02` proves the whole file; otherwise assume UK + flag. |
| PDF parser is generic + tiny per-bank tweaks | Bank templates change; geometry + header synonyms survive that. Per-bank parsers rot. |
| Balance reconciliation is the primary correctness signal | A chained balance *proves* signs, row assignment and completeness. Reconciled statements can be one-click imported. |
| Missing signs solved from balance groups (≤12 unknowns, unique solution only) | Handles statements that print one amount column and balances only at end of day. |
| Fingerprint = (account, date, amount, nth-occurrence) — **no description** | Same txn reads differently in CSV vs PDF; two identical coffees stay distinct. Fuzzy matches are flagged, never silently dropped. |
| Stage → review → commit | Nothing touches the ledger until a human (or a reconciled statement) says so. Rows are kept for provenance and re-parsing. |
| Categorise at commit, not at stage | Uses rules created while reviewing an earlier file in the same batch. |
| Originals encrypted with AES-256-GCM, statement id as AAD | Integrity + can't swap blobs between statements; user can opt out of retention. |

## Privacy model (`src/domain/access/visibility.ts`)

* You always see what you own. Joint accounts (`ownerId = null`) are visible to both.
* Partner's personal account `visibility`: `shared` · `summary_only` (totals yes, rows no) · `private` (doesn't exist for them).
* Any transaction can be `isPrivate` with a `privateOwnerId` — works inside joint accounts (surprise gifts).
* Two where-builders: `transactionWhere` (rows) and `aggregateTransactionWhere` (totals). All data access composes one; there is no unscoped helper.
* Inaccessible = **404, never 403**, so the API doesn't confirm existence.
* Activity log entries never contain amounts/descriptions, and inherit visibility.
* Prisma query logging is off; route errors log the error *name* only.

## Categorisation

Precedence with confidence: user rule (1.0) → household-learned merchant (0.5–0.99, Laplace-smoothed on confirmations/overrides) → ~100 seeded UK/IE merchants (0.85) → bank's own category (0.6) → heuristics (0.5). Learning is per **household**, so either partner's correction helps both. Two identical corrections prompt "Always categorise X as Y?". Internal transfers are paired (opposite amount, different account, ≤3 days) and excluded from spend/income.

## Status

1. ✅ Data model (`prisma/schema.prisma`, migration in `prisma/migrations`)
2. ✅ Ingestion: 13 CSV layouts, OFX/QFX, Santander TXT, generic PDF; credit-card sign handling (Vanquis, Capital One, Zable)
3. ✅ Auth: tap your name + personal 8-digit PIN (scrypt), DB-backed lockout (5 tries → 15 min), DB sessions (60 days), first-user sign-up, single-use invite links; privacy per account and per transaction
4. ✅ Transactions: filters, search, splits, bulk categorise, notes (shared or private), reactions, manual entries, rules, learning, transfer + recurring detection
5. ✅ Budgets (household + personal, payday-aligned months, rollover, zero-based), goals (shared/personal/private, monthly suggestion, linked savings account), dashboard, monthly review
6. ✅ Mobile-first UI, PWA (installable, offline shell, no financial data cached), dark mode, keyboard shortcuts, CSV export, print-to-PDF review, activity log

### Why personal PINs, not one shared passcode
A shared code can't tell you apart, which would silently disable private accounts, hidden
transactions, personal budgets and the activity log. Personal PINs cost the same effort (each
phone stays signed in 60 days). An 8-digit PIN alone is guessable by a script; the per-person
lockout stored in Postgres caps guessing at ~480/day (~570 years on average). It's in the DB,
not memory, because serverless instances don't share memory.

### Why custom auth instead of Auth.js
Name + PIN + invite link + DB sessions is ~150 lines of auditable code. Auth.js would add an
adapter layer, JWT defaults to turn off, and email infrastructure this app doesn't need.

### Hosting
Vercel Hobby (London, `vercel.json`) + Neon free Postgres. Builds run `prisma migrate deploy`
(via `DATABASE_URL_UNPOOLED`), the app uses the pooled `DATABASE_URL`. Uploads go one file per
request to stay under Vercel's 4.5 MB body limit. Docker + compose remains as a self-host option.
