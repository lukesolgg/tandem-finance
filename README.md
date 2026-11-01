# Tandem

Couple-first personal finance. Upload bank statements (PDF, CSV, OFX/QFX) → clean, de-duplicated, categorised transactions → shared and private budgets.

**To get it on both your phones, follow [DEPLOY.md](./DEPLOY.md)** (Vercel + Neon, free).

Local development needs Postgres (any will do):

```bash
docker run -d --name tandem-pg -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
cp .env.example .env
sed -i "s|^STATEMENT_ENCRYPTION_KEY=.*|STATEMENT_ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"|" .env
npm install
npx prisma migrate deploy
npm run dev        # http://localhost:3000 → "Set up your household"

TEST_DATABASE_URL=postgresql://postgres@localhost:5433/postgres npm test   # 84 tests
npm run typecheck
npm run parse -- ~/Downloads/statement.pdf credit_card   # try a real statement locally
```

Without `TEST_DATABASE_URL` the database-backed tests are skipped and the rest still run.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design and decisions.

## Layout

```
prisma/schema.prisma                 full data model
src/domain/ingestion/
  pipeline.ts                        parseStatement() + buildReview()
  service.ts                         stage / commit (Prisma, encryption)
  csv/profiles.ts                    ← add a bank here (declarative)
  csv/parser.ts  ofx/parser.ts
  pdf/extract.ts                     pdf.js → positioned lines/cells
  pdf/parser.ts                      generic table parser
  pdf/banks.ts                       ← bank fingerprints + tweaks
  dates.ts money.ts normalise.ts     UK-first primitives
  reconcile.ts confidence.ts dedupe.ts
src/domain/categorisation/           engine, learning, transfers, UK seed data
src/domain/access/visibility.ts      privacy model
src/app/api/statements/…             upload + commit endpoints
tests/                               fixtures + synthetic PDF generators
```

## Adding a bank

**CSV:** add a profile to `csv/profiles.ts` (header signature + column map), drop an anonymised fixture in `tests/fixtures`, add a test.
**PDF:** usually nothing — the generic parser handles header-based tables. If it guesses multi-line layout wrong, add a `PDF_BANK_TWEAKS` entry and a synthetic fixture in `tests/helpers/pdf-fixtures.ts`.

Supported: Monzo, Starling, Revolut, Barclays, NatWest/RBS/Ulster, Lloyds/Halifax/BoS, Nationwide, Bank of Ireland, AIB, Amex UK, Capital One, HSBC/First Direct (CSV); Santander (TXT); any bank's OFX/QFX; and PDFs from any bank with a normal transactions table. Credit cards (Vanquis, Zable, Capital One…) are detected and payments to the card are treated as money in.

> Fixtures are synthetic, modelled on each bank's published export format. Before trusting a profile in production, run one real export through it — banks change formats without notice, and real statements must never be committed to the repo.
