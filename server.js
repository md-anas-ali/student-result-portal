require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const studentRoutes = require('./routes/student');
const teacherRoutes = require('./routes/teacher');
const adminRoutes = require('./routes/admin');

const app = express();

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
app.listen(PORT, () => console.log(`Result portal listening on port ${PORT}`));
