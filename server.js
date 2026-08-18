require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const pool = require('./db/pool');

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const studentRoutes = require('./routes/student');
const teacherRoutes = require('./routes/teacher');
const adminRoutes = require('./routes/admin');

const app = express();

// Ensure the schema exists before we start accepting traffic. schema.sql is
// written entirely with `IF NOT EXISTS`, so running it on every boot is safe
// and cheap — this is what stops "relation ... does not exist" errors when
// DATABASE_URL points at a brand-new (or freshly reset) Postgres instance.
async function ensureSchema() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('Database schema verified/applied.');
}

app.use(express.json());
app.use(cookieParser());

// Static frontend (home page, public search, dashboards). All of this is
// just HTML/JS shell — every dashboard calls the authenticated APIs below
// for real data, so hiding a button here is cosmetic, not security (rule 13).
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/admin', adminRoutes);

// Who am I — small helper so the frontend can show the right dashboard
// without re-deriving anything security-relevant client-side.
const { authenticate } = require('./middleware/auth');
app.get('/api/me', authenticate, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Never leak internals in error responses (rule 41).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Result portal listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to apply database schema on startup:', err);
    process.exit(1);
  });
