# Deploying Tandem to Vercel (free)

Free stack: **Vercel Hobby** (the app, London region) + **Neon Free** (Postgres).
Your statements are stored encrypted inside the database, so there's nothing else to set up.

Time: about 15 minutes. You need a GitHub account and a terminal with `openssl`
(macOS/Linux, or Git Bash on Windows).

## 1. Put the code on GitHub (private repo)

```bash
cd tandem
git remote add origin git@github.com:<you>/tandem.git   # create an empty PRIVATE repo first
git push -u origin main
```

## 2. Create the Vercel project

1. vercel.com → **Add New… → Project** → import the `tandem` repo. Framework is detected as Next.js.
2. Open **Environment Variables** and add:
   - `STATEMENT_ENCRYPTION_KEY` → the output of `openssl rand -base64 32`.
     Mark it *Sensitive*. **Also save it in your password manager** — it's needed to read stored statement files.
3. Click **Deploy**. This first build is expected to **fail** (no database yet). That's fine.

## 3. Add the database

1. In the project → **Storage** → **Create Database** → **Neon** → Free plan.
   Pick a European region — London (AWS eu-west-2) if offered, otherwise Frankfurt.
2. Connect it to the project. Neon adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically.
3. **Deployments** → latest → **Redeploy**. The build runs the database migration, then builds the app.

`vercel.json` pins the app to London (`lhr1`), so pages load quickly and your data is processed in the UK.

## 4. First run

1. Open `https://<project>.vercel.app` → **Set up your household**: your name + an 8-digit PIN.
   Only the very first person can do this; after that sign-up is closed.
2. **Settings → Household → Create invite link** → send it to your partner. They pick their own name and PIN.
3. On each phone, open the site, then:
   - iPhone: Safari → Share → **Add to Home Screen**
   - Android: Chrome → ⋮ → **Install app**

Each phone stays signed in for 60 days. Five wrong PINs locks that person's sign-in for 15 minutes.

## Good to know

- **Cold starts:** Neon's free database sleeps when idle, so the first page after a quiet spell takes a second or two.
- **Upload size:** each statement file must be under 4.4 MB (Vercel's request limit). Normal monthly statements are far smaller; for big PDFs, download a shorter date range or the CSV.
- **Updates:** `git push` → Vercel redeploys and applies any new migrations automatically.
- **Backups:** Settings → *Export everything (CSV)* any time. For a full database copy:
  `pg_dump "$DATABASE_URL_UNPOOLED" > tandem-backup.sql` (connection string is in Vercel → Storage).
- **Custom domain (optional):** Vercel → Settings → Domains. Then set `APP_URL` so invite links use it.
- **Hobby plan** is for personal, non-commercial use — which this is.

## Alternative: self-host with Docker

`docker-compose.yml` runs the app, Postgres and Caddy (automatic HTTPS) on any small server:
set `STATEMENT_ENCRYPTION_KEY`, `POSTGRES_PASSWORD` and `DOMAIN` in `.env`, then `docker compose up -d`.
