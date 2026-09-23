# Multipliers Receivables — Vercel + Supabase

Same app and same data as before, but it no longer needs PHP or MySQL:

- **Frontend** — the same React (Vite) app, unchanged.
- **Backend** — `frontend/server/` (Node.js). It replaces `api.php`,
  `export_csv.php` and `export_xlsx.php` and runs as Vercel functions
  (`frontend/api/`). `vercel.json` routes the old `/api.php` paths to them,
  so the React code didn't need to change.
- **Database** — Supabase (PostgreSQL). `database/supabase_setup.sql`
  creates the tables and loads all your existing data.

```
receivables-supabase/
  database/supabase_setup.sql   run once in Supabase
  frontend/                     deploy this folder to Vercel
    api/          Vercel functions (thin wrappers)
    server/       backend code (API, exports, login, date rules)
    src/          React app (unchanged)
    vercel.json   routes /api.php etc. to the functions
    dev-api.js    local backend for development
    .env.example  the 2 settings the backend needs
```

## 1. Create the database (Supabase)

1. Go to https://supabase.com and create a free project. Pick the
   **Southeast Asia (Singapore)** region, which is closest to the Philippines.
   Save the database password it asks for.
2. Open **SQL Editor**, then **New query**. Paste the whole content of
   `database/supabase_setup.sql` and click **Run**.
3. Check that it worked in **Table Editor**: `ledger_entries` should have
   686 rows and `companies` 45.

Run the file only once. On a database that already has data it will fail
on duplicate ids, which protects you from loading the data twice.

## 2. Get the connection string

In Supabase, click **Connect** at the top and copy the
**Transaction pooler** string (port **6543**). It looks like:

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Replace `[YOUR-PASSWORD]` with your database password. If the password has
symbols like `@ # / ?`, reset it to one with only letters and numbers, or
URL-encode it.

## 3. Deploy to Vercel

1. Put this project on GitHub, then in Vercel choose **Add New → Project**
   and import it.
2. Set **Root Directory** to `frontend`. Vercel detects Vite by itself
   (build `npm run build`, output `dist`).
3. Under **Environment Variables** add:
   - `DATABASE_URL`: the connection string from step 2
   - `SESSION_SECRET`: a long random string. Generate one with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. Click **Deploy**, open the site and log in with your usual username
   and password.

If you change an environment variable later, redeploy so it takes effect.

## Running it on your PC (optional)

```
cd frontend
npm install
copy .env.example .env     (then put your real values in .env)
```

Then use two terminals:
- Terminal 1: `npm run api` (backend on http://localhost:8000)
- Terminal 2: `npm run dev` (open http://localhost:5173)

The local backend uses the same Supabase database as the live site, so
changes you make locally are real.

## What changed compared to the PHP version

- **Logins** are kept in a signed cookie (`SESSION_SECRET`) instead of PHP
  session files, because Vercel functions don't keep files between
  requests. Users are logged out after 12 hours or when the browser closes.
  Existing passwords work unchanged.
- **Times** like `created_at` are saved in Philippine time, same as before.
- **Database safety:** Supabase exposes tables through its public API. The
  setup file turns on Row Level Security with no policies, so nothing
  (including password hashes) can be read that way; only this app's
  backend, using `DATABASE_URL`, can reach the data.
- The old "auto-create default accounts" behaviour is gone. The database
  is created only by `supabase_setup.sql`.

## Backups

Accounting data is important. In Supabase, **Database → Backups** holds
the automatic backups. You can also export any table as CSV from the Table
Editor, or use the app's own Excel export, for example once a week.

## Managing users

There's no user admin page (same as before). To add a user, first make a
bcrypt hash of the password on your PC:

```
cd frontend
node -e "console.log(require('bcryptjs').hashSync('THE-PASSWORD', 10))"
```

Then run this in Supabase's SQL Editor:

```sql
INSERT INTO users (username, password_hash, full_name, role)
VALUES ('newuser', 'PASTE-HASH-HERE', 'New User', 'branch');  -- or 'admin'
```

To change a password, run
`UPDATE users SET password_hash = '...' WHERE username = '...';`

Branch accounts only see companies whose **Branch** field equals their
username, same as before.
