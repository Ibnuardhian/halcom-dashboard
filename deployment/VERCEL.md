# Deploying Halcom Dashboard to Vercel (with the database on Neon)

Written for whoever puts this application online and keeps it running. Follow it top to bottom the first time; afterwards only
"Every later deploy" and "When the schema changes" apply.

The application is a Next.js app that keeps nothing on disk and nothing in memory between requests, so it suits Vercel. Its
database is PostgreSQL on Neon. The one thing that does **not** work there is the Backups page: see
[What does not work on Vercel](#what-does-not-work-on-vercel).

---

## 0. Before you start

You need:

- the repository on GitHub, with `main` as the production branch and `development` for preview deploys;
- a Neon project (this is the database the application already uses) and both of its connection strings;
- a Vercel account with access to that repository;
- Docker Desktop on your own machine, which is how the migration and bootstrap commands below are run.

Decide two things first:

| Decision | Recommendation |
|---|---|
| Vercel plan | **Pro.** Hobby forbids commercial use, and this is an internal company tool. |
| Function region | **Singapore (`sin1`)**, next to the Neon project in `ap-southeast-1`. Every page talks to the database, so distance is latency. `vercel.json` already sets it. A Hobby project may have one region, which is all this needs. |

---

## 1. Environment variables

Set these in Vercel under **Settings → Environment Variables**. Add them to **Production** and **Preview** separately: preview
deployments should never write to the production database.

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | Neon's **pooled** string (the host contains `-pooler`) | Every request. The pooler is what survives many short-lived functions. |
| `DIRECT_URL` | Neon's **direct** string (no `-pooler`) | Migrations. A pooler cannot run them; the application itself never uses this. |
| `APP_BASE_URL` | `https://<your domain>` | The link the copy-and-paste e-mail text carries. Without it the body says the link is not available. |
| `APP_ENV` | `production` | Shown on the System page, and the guard that makes every seed and import script refuse to run. |
| `EMAIL_TO_HITBOQ` | the BOQ distribution list | The To line of the BOQ e-mail text. A request type without a valid value shows a configuration error instead of recipients. |
| `EMAIL_CC_HITBOQ` | the BOQ copy list (may be empty) | |
| `EMAIL_TO_HITRFQ`, `EMAIL_CC_HITRFQ` | the RFQ lists | |
| `EMAIL_TO_HITPO`, `EMAIL_CC_HITPO` | the PO lists | |

**Never set `SEED_USER_PASSWORD` on Vercel.** It is the shared password of the synthetic development accounts; the seed refuses to
run outside development and test anyway, and the variable has no other use.

`NODE_ENV` is set by Vercel itself. Do not add it.

Keep the Neon password out of chat, tickets and this repository: `.env` and `DEV_ACCOUNTS.md` are git-ignored for that reason.

---

## 2. Bring the database up to date

Run this from your machine, against the **direct** Neon URL. `compose.neon.yaml` reads `NEON_DATABASE_URL` and `NEON_DIRECT_URL`
from your own `.env`.

```bash
# 1. A backup first. Neon keeps its own history, but a file you hold costs nothing.
#    The local `db` container has the PostgreSQL client; the URL is handed to it for this one command only.
U=$(grep '^NEON_DIRECT_URL=' .env | cut -d= -f2-)
docker compose exec -T -e NU="$U" db sh -c 'pg_dump "$NU" -Fc --no-owner --no-acl' > backups/neon-before-deploy.dump

# 2. What is still missing?
docker compose -f compose.yaml -f compose.neon.yaml run --rm app npm run db:migrate:status

# 3. Apply it.
docker compose -f compose.yaml -f compose.neon.yaml run --rm app npm run db:migrate:deploy
```

Read the list before you apply it. Two migrations in the history **drop columns**
(`20261027100000_request_trim_and_raiser`, `20261027110000_drop_deprecated_columns`); on a database that still holds data in them,
that data is gone. Everything after them only adds.

Migrations are deliberately **not** part of the Vercel build: a build that half-applies a schema and then fails is far worse than
a deploy that waits for you.

---

## 3. Create the first superadmin

A fresh database has no account at all, and the seed will not make one outside development. Run this once:

```bash
docker compose -f compose.yaml -f compose.neon.yaml run --rm \
  -e BOOTSTRAP_NAME="Your Name" \
  -e BOOTSTRAP_EMAIL="you@halcominovasi.co.id" \
  -e BOOTSTRAP_PASSWORD="<a long one, only you know it>" \
  app npm run db:bootstrap-superadmin
```

- It refuses as soon as any superadmin exists, so it cannot be used twice to slip an account in.
- The password comes from the environment, not from the command line, so it stays out of the shell history.
- The account **must choose its own password at its first sign-in**; nothing else in the application opens until it has.
- The creation is in the audit log as `user.bootstrapped`. Check it afterwards.

Add `--dry-run` to see what it would do without writing anything. Every further account is made on the Users page, and each of
those also has to replace the password the administrator typed.

---

## 4. Load the existing data (only on an empty database)

If the Neon database is new and should start with the projects and RFQ tickets:

```bash
docker compose run --rm app npm run db:import-sql    # writes prisma/data/halcom_import_all.sql from your development database
psql "<the direct Neon URL>" -v ON_ERROR_STOP=1 -f prisma/data/halcom_import_all.sql
```

The file only adds, runs in one transaction and is safe to run twice. It holds customer names and e-mail addresses, so it is
git-ignored: never commit it, and delete your copy when you are done.

---

## 5. Create the Vercel project

1. **Add New → Project**, import the GitHub repository.
2. Framework: **Next.js** (detected). Leave Build and Install commands on their defaults — the repository's `build` script already
   runs `prisma generate && next build`, and `postinstall` runs `prisma generate` too, because Vercel caches dependencies and would
   otherwise reuse a client generated against an older schema.
3. **Node.js version: 24.** It is Vercel's default; `package.json` also pins `engines.node` to the 24 range. If a build complains
   about the version, set it under Settings → Build and Deployment.
4. **Production branch: `main`.** Every other branch, `development` included, becomes a preview deployment with its own URL.
5. Add the environment variables from step 1, then **Deploy**.

`vercel.json` in the repository already fixes the framework, the region and the (silent) GitHub comments.

---

## 6. Check the first deployment

Open the deployment URL and work through this list:

- [ ] `/api/health` answers `200`.
- [ ] The sign-in page loads; the browser shows a padlock.
- [ ] Sign in as the bootstrap superadmin: it lands on **Choose your own password** and nothing else opens until the password is changed.
- [ ] After the change, the Superadmin dashboard, Projects and Requests all load.
- [ ] Five wrong passwords on any address lock it for fifteen minutes (`Too many sign-in attempts`), and the audit log shows `auth.login_failed`.
- [ ] A request page shows the e-mail text with the right To and Cc, and the link points at `APP_BASE_URL`.
- [ ] **Admin → System** shows environment `production` and the Neon PostgreSQL version.
- [ ] **Admin → Backups** shows the notice that this deployment cannot write backups (expected, see below).

Then set the custom domain (Settings → Domains) and change `APP_BASE_URL` to it, because the e-mail text uses it.

---

## 7. Every later deploy

- Push to `development` → preview deployment, its own URL, preview environment variables.
- Merge `development` into `main` → production deployment.
- Vercel keeps every earlier deployment: **Instant Rollback** from the dashboard puts the previous one back within seconds. That
  rolls back *code only*, which is exactly why migrations are additive and never part of the build.

## When the schema changes

Order matters, because old and new code run side by side for a moment during a deploy:

1. Merge and deploy nothing yet.
2. Run `db:migrate:deploy` against Neon (step 2) **before** promoting the code that needs it.
3. Deploy.

Additive migrations (a new table, a new nullable column) are safe in this order. A migration that drops or renames something needs
two deploys: one that stops using it, then the migration, then one that removes the code.

---

## What does not work on Vercel

- **The Backups page.** It shells out to `pg_dump` and writes to a folder on the host; a serverless function has neither. The page
  now says so instead of offering a button that fails, and the action refuses as well. Use Neon instead: point-in-time restore and
  branches cover the same ground, and a scheduled `pg_dump` from a machine you control covers the rest. Decide the retention you
  want and write it down (OPEN_QUESTIONS T-11 is still open).
- **The seed, the sales-export import and the RFQ import.** They refuse unless `APP_ENV` is development or test. Load data with the
  SQL file of step 4, or through the application.
- **Long-running work.** There is none today; keep it that way, or it will need a different host.

## Known risks to weigh before real users arrive

- Password hashing is scrypt at about 64 MiB per check. It is deliberate, and it costs function memory: watch the first week, and
  raise the function memory if sign-ins are slow when several people arrive at once.
- The sign-in throttle counts in the database, so it works across functions and regions; it does not stop a distributed attack from
  many addresses. The lock never lasts longer than an hour, on purpose: a permanent lockout would be a way to keep a colleague out.
- Everything in `prisma/data/` is real customer data. It is git-ignored and Docker-ignored; keep it that way.

---

## Quick reference

```bash
# status / migrate
docker compose -f compose.yaml -f compose.neon.yaml run --rm app npm run db:migrate:status
docker compose -f compose.yaml -f compose.neon.yaml run --rm app npm run db:migrate:deploy

# the first superadmin (once per database)
docker compose -f compose.yaml -f compose.neon.yaml run --rm \
  -e BOOTSTRAP_NAME=... -e BOOTSTRAP_EMAIL=... -e BOOTSTRAP_PASSWORD=... \
  app npm run db:bootstrap-superadmin

# run the application locally against a copy of Neon, not Neon itself
docker compose -f compose.yaml -f compose.neon-local.yaml up -d app
```
