# Student Result Portal

Node.js + Express + PostgreSQL. Role-based (Admin / Teacher / Student), with
Google Sheets import/sync. Built to run on Render's free tier.

```
Browser → Node.js + Express → PostgreSQL
Google Sheets → Node.js Backend → Validation → PostgreSQL
```

## What's here

```
server.js              # entry point, wires everything together
db/schema.sql           # PostgreSQL schema (source of truth)
db/seed.js               # one-command setup: applies schema, creates admin, loads sample data
db/pool.js               # PostgreSQL connection pool
middleware/auth.js       # JWT verification + role authorization (backend-enforced)
routes/auth.js           # login/logout
routes/public.js         # public result search (exam+year+roll+registration)
routes/student.js        # logged-in student's OWN data only
routes/teacher.js        # teacher's assigned classes/subjects only
routes/admin.js          # full admin CRUD + sync trigger
services/sheetsSync.js   # Google Sheets → PostgreSQL, validated + transactional
public/                  # static frontend (home, search, login, 3 dashboards)
```

## 1. Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- `DATABASE_URL` — a Postgres connection string (Neon free tier works well; Render's
  own free Postgres also works, but note Render's free Postgres expires after 90 days —
  Neon or another always-on free Postgres is more durable for this).
- `JWT_SECRET` — any long random string (`openssl rand -hex 32`).
- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` — your first admin login. Change the
  password after first login (Admin → Users → Reset Password).

Then, with no manual SQL required:

```bash
npm run seed   # applies schema.sql, creates the admin account, loads sample HSC data
npm start
```

Visit `http://localhost:3000`. Log in at `/login.html` with the admin account.
Try the public search at `/search.html` with: exam `HSC`, year `2026`, roll `123456`,
registration `2026123456` — that's the sample record `db/seed.js` loads.

## 2. Deploying to Render (free tier)

1. Push this folder to a GitHub repo.
2. On Render: **New → Web Service**, connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add the same environment variables from `.env` in Render's Environment tab —
   **never commit `.env`** (it's already in `.gitignore`).
5. Use a Neon (or other) Postgres `DATABASE_URL` — Render's free web service has
   no persistent disk, so the database must be external and already durable (rule 42/43).
6. After the first deploy, run `npm run seed` once — either as a Render **one-off job**,
   or temporarily set the start command to `node db/seed.js && node server.js`,
   redeploy once, then change it back.

## 3. Google Sheets sync

1. Create a Google Cloud service account, enable the Sheets API, and share each
   spreadsheet (view access) with the service account's email.
2. Put the service account's JSON key as a single-line string in
   `GOOGLE_SERVICE_ACCOUNT_JSON` (server-side env var only — this is never sent to
   the browser).
3. Set `GOOGLE_SHEETS_STUDENTS_ID`, `GOOGLE_SHEETS_TEACHERS_ID`, `GOOGLE_SHEETS_MARKS_ID`
   to each spreadsheet's ID (the long string in its URL).
4. Expected columns (row 1 = header, data starts row 2):
   - **Students** sheet: `student_id, name, roll, registration, class_name, section_name, group_name`
   - **Teachers** sheet: `teacher_id, name`
   - **Marks** sheet: `student_id, exam_name, exam_year, subject_code, full_marks, marks, grade, gpa, status`
5. Log in as admin → **Google Sheets Sync** tab → run the sync you need. The response
   reports how many rows were applied vs. rejected, with reasons for any rejected row.
   Nothing is written until every row in the batch has been validated; a bad sheet
   can't leave the database half-updated.

## Notes on the architecture rules this follows

- PostgreSQL is the only source of truth for accounts, roles, and results. Google
  Sheets is only ever an import/export source, synced through the backend — students
  and teachers never call the Sheets API directly, and only an authenticated admin
  can trigger a sync.
- Passwords are hashed with bcrypt; nothing is ever stored or logged in plain text.
- Auth is a stateless JWT in an httpOnly cookie — no Redis/session server needed,
  which keeps this comfortable inside Render's free-tier resource limits.
- Every role's data access is enforced in the route handlers using the identity from
  the verified JWT (`req.user`), not from anything the client sends — a student or
  teacher changing the URL/query string cannot reach another person's data.
- `db/seed.js` is the only "setup" step you run by hand; everything else is `npm start`.

## What you'll still want to add as this grows

- Pagination on the admin list views (currently capped at 500 rows).
- Bulk "create many students" in the admin UI (the sync feature covers bulk import
  via Sheets already).
- Email/SMS notification hooks when results are published.
- Automated grade/GPA calculation from a grading scale, instead of admin/teacher
  entering grade+GPA by hand alongside marks.
