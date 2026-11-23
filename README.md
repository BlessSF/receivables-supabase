# Multipliers Receivables

A receivables and payables management system for a multi-branch HMO billing business: ledger, SOA tracking, collections, aging, past-due follow-up, payables, cash position and cheque printing, in one app.

**Built and developed by Bless Florentino.** See `LICENSE` and `COPYRIGHT.md`.

- **Frontend:** React (Vite) single-page app in `frontend/src`
- **Backend:** Node.js in `frontend/server`, run as Vercel functions (`frontend/api`)
- **Database:** Supabase (PostgreSQL)

```
receivables-supabase/
  database/supabase_setup.sql   run once in Supabase
  LICENSE, COPYRIGHT.md         author credit
  frontend/                     deploy this folder to Vercel
    api/          Vercel functions (thin wrappers)
    server/       backend: API, auth, exports, date rules, combined report, audit
    src/          React app (pages in src/pages)
    vercel.json   routes /api.php etc. to the functions
    dev-api.js    local backend for development
    .env.example  the settings the backend needs
```

---

## What it does

### Receivables
| Page | What it is for |
| --- | --- |
| **Dashboard** | Billed, Collected, Outstanding balance, Past due and Due for any account, by month, year or all time. Every card has **See why →**, which lists the exact entries behind the number (the list total equals the card). The header stays pinned while you scroll. |
| **Ledger** | Every billing entry: SOA number, covered period, amount, paid, balance, payment history. Inline editing, exports. |
| **Reports by Month / Summary** | January to December tables per account, using each entry's Period Date. |
| **Aging / Past Due / Monitoring** | How old the unpaid balance is, what is late, and who to chase. |
| **SOA Tracker, Billing, Payment Record** | Statement of Account tracking and payment records. |
| **Executive Dashboard** | Owner/accounting overview: where the money is, how old it is, collection trend. |
| **Combined (Demic Main + Demic Jaro)** | Both branch databases side by side, with **separate totals per branch** (not merged). Admin can set, per HMO, whether it shows as Both, Main only, Jaro only, or Hidden. |

### Payables
| Page | What it is for |
| --- | --- |
| **Running Payables** | Bills to pay, with pay dates and balances. Rows that came from the PDC Tracker are marked as future payables and are changed there. |
| **PDC Tracker** | Post-dated cheque schedules per item. Marking a month unpaid creates the next unpaid row in Running Payables automatically. |
| **Cash Position** | Receivables due, payables due and future payables (shown as the **outstanding balance** still to pay, not the instalment). |
| **Cheque Maker** | Prints cheques on a saved layout, protected by an edit code. |

### System (admin)
- **Users:** create staff, branch, accounting and executive accounts; rename, reset password, delete. Admin and executive can also switch **Accounting Receivables** and **Accounting Payables** on or off **per user**.
- **Settings:** payment terms and past-due rules, navigation access per role, brand name and logo, **Theme** (sidebar and highlight colors, saved for everyone), Combined-report scope.
- **Audit log** of important changes.

### Roles
| Role | Sees |
| --- | --- |
| **admin** | Everything, including Users and Settings. |
| **executive** | Dashboards and reports; can control who gets Receivables/Payables. |
| **accounting** | Receivables and/or Payables, depending on the per-user switches. |
| **staff** | Dashboard, Ledger (all companies), Reports by Month. In the Ledger they can edit only **Payment Date**, **Check Ref** and **Paid**. |
| **branch** | Only companies whose **Branch** equals their username. |

Permissions are enforced on the server (`server/api.js`), not only hidden in the screen.

---

## 1. Create the database (Supabase)

1. Go to https://supabase.com and create a free project. Pick the **Southeast Asia (Singapore)** region. Save the database password.
2. Open **SQL Editor → New query**, paste the whole of `database/supabase_setup.sql` and click **Run**.
3. Check in **Table Editor** that `ledger_entries` and `companies` have rows.

Run the file **only once**. On a database that already has data it fails on duplicate ids, which protects you from loading the data twice.

## 2. Get the connection string

In Supabase click **Connect** and copy the **Transaction pooler** string (port **6543**):

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Replace `[YOUR-PASSWORD]`. If the password has symbols like `@ # / ?`, reset it to letters and numbers only, or URL-encode it.

## 3. Deploy to Vercel

1. Put the project on GitHub, then in Vercel choose **Add New → Project** and import it.
2. Set **Root Directory** to `frontend`. Vercel detects Vite (build `npm run build`, output `dist`).
3. Add these **Environment Variables**:

| Name | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | The connection string from step 2 |
| `SESSION_SECRET` | yes | A long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PEER_DATABASE_URL` | only for the Combined page | Connection string of the other branch's database (e.g. Demic Jaro, from Demic Main) |

4. Click **Deploy**, open the site and log in.

Changing an environment variable needs a **redeploy** to take effect.

Each branch is its own deployment with its own database. The Combined page reads the other one through `PEER_DATABASE_URL`.

## Updating an existing database

New tables, columns and settings are **created automatically** the first time the app needs them (for example the PDC tables, the Future-payable link on Running Payables, and settings for Theme, per-user modules and Combined scope). You normally don't run any SQL for an update.

The one manual migration: if your database was created before the **Period Date** column existed, run `database/add_period_date.sql` once (Supabase → SQL Editor). It fills the column from each entry's old Billing Date and is safe to run twice.

## Running it on your PC (optional)

```
cd frontend
npm install
copy .env.example .env     (then put your real values in .env)
```

Two terminals:
- Terminal 1: `npm run api` (backend on http://localhost:8000)
- Terminal 2: `npm run dev` (open http://localhost:5173)

The local backend uses the same database as the live site, so changes made locally are real.

## Managing users

Use **System → Users** in the app. If you ever need to add an account by SQL, make a bcrypt hash first:

```
cd frontend
node -e "console.log(require('bcryptjs').hashSync('THE-PASSWORD', 10))"
```

```sql
INSERT INTO users (username, password_hash, full_name, role)
VALUES ('newuser', 'PASTE-HASH-HERE', 'New User', 'branch');  -- admin, executive, accounting, staff or branch
```

Change a password: `UPDATE users SET password_hash = '...' WHERE username = '...';`

## Good to know

- **Logins** are a signed cookie (`SESSION_SECRET`). Users are logged out after 12 hours or when the browser closes.
- **Times** such as `created_at` are saved in Philippine time.
- **Database safety:** Row Level Security is on with no policies, so nothing (including password hashes) can be read through Supabase's public API. Only this app's backend, using `DATABASE_URL`, reaches the data.
- **Past due rule:** an entry is due on its own Due Date if it has one, otherwise a set number of months after its billing month (default 2; change it in Settings).
- **Collected** counts each payment in the month it was received. **Billed** counts an entry in the month of its covered period.

## Backups

In Supabase, **Database → Backups** holds the automatic backups. You can also export any table as CSV from the Table Editor, or use the app's Excel export, for example once a week.

## Author

Designed, developed and maintained by **Bless Florentino**. Credit appears in the app footer. See `LICENSE` and `COPYRIGHT.md` for terms.