const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');
const { syncFromSheets } = require('../services/sheetsSync');

const router = express.Router();
router.use(authenticate, authorize('admin'));

// ---------- Users ----------

router.get('/users', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, role, is_active, created_at FROM users ORDER BY id`
  );
  res.json(rows);
});

router.post('/users', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password || !['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'username, password and a valid role are required' });
  }
  try {
    const hash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id, username, role`,
      [username, hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    console.error('Create user error', err);
    res.status(500).json({ error: 'Could not create user' });
  }
});

router.patch('/users/:id/status', async (req, res) => {
  const { isActive } = req.body || {};
  await pool.query('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2', [!!isActive, req.params.id]);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }
  const hash = await hashPassword(newPassword);
  await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.params.id]);
  res.json({ ok: true });
});

// ---------- Classes / Sections / Subjects / Exams ----------

router.get('/classes', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM classes ORDER BY name');
  res.json(rows);
});
router.post('/classes', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query('INSERT INTO classes (name) VALUES ($1) RETURNING *', [name]);
  res.status(201).json(rows[0]);
});

router.get('/sections', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM sections ORDER BY class_id, name');
  res.json(rows);
});
router.post('/sections', async (req, res) => {
  const { classId, name } = req.body || {};
  if (!classId || !name) return res.status(400).json({ error: 'classId and name are required' });
  const { rows } = await pool.query(
    'INSERT INTO sections (class_id, name) VALUES ($1,$2) RETURNING *', [classId, name]
  );
  res.status(201).json(rows[0]);
});

router.get('/subjects', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM subjects ORDER BY name');
  res.json(rows);
});
router.post('/subjects', async (req, res) => {
  const { code, name, isFourthSubject } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  const { rows } = await pool.query(
    'INSERT INTO subjects (code, name, is_fourth_subject) VALUES ($1,$2,$3) RETURNING *',
    [code, name, !!isFourthSubject]
  );
  res.status(201).json(rows[0]);
});

router.get('/exams', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM exams ORDER BY year DESC, name');
  res.json(rows);
});
router.post('/exams', async (req, res) => {
  const { name, year } = req.body || {};
  if (!name || !year) return res.status(400).json({ error: 'name and year are required' });
  const { rows } = await pool.query('INSERT INTO exams (name, year) VALUES ($1,$2) RETURNING *', [name, year]);
  res.status(201).json(rows[0]);
});

// ---------- Students / Teachers ----------

router.get('/students', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN sections sec ON sec.id = s.section_id
     ORDER BY s.id DESC LIMIT 500`
  );
  res.json(rows);
});

router.post('/students', async (req, res) => {
  const { studentId, name, roll, registration, classId, sectionId, groupName, createLogin } = req.body || {};
  if (!studentId || !name || !roll || !registration) {
    return res.status(400).json({ error: 'studentId, name, roll and registration are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let userId = null;
    if (createLogin && createLogin.username && createLogin.password) {
      const hash = await hashPassword(createLogin.password);
      const { rows: userRows } = await client.query(
        `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'student') RETURNING id`,
        [createLogin.username, hash]
      );
      userId = userRows[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO students (student_id, user_id, name, roll, registration, class_id, section_id, group_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [studentId, userId, name, roll, registration, classId || null, sectionId || null, groupName || null]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Duplicate student_id, username, or roll+registration' });
    console.error('Create student error', err);
    res.status(500).json({ error: 'Could not create student' });
  } finally {
    client.release();
  }
});

router.get('/teachers', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM teachers ORDER BY id DESC');
  res.json(rows);
});

router.post('/teachers', async (req, res) => {
  const { teacherId, name, createLogin } = req.body || {};
  if (!teacherId || !name) return res.status(400).json({ error: 'teacherId and name are required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let userId = null;
    if (createLogin && createLogin.username && createLogin.password) {
      const hash = await hashPassword(createLogin.password);
      const { rows: userRows } = await client.query(
        `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'teacher') RETURNING id`,
        [createLogin.username, hash]
      );
      userId = userRows[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO teachers (teacher_id, user_id, name) VALUES ($1,$2,$3) RETURNING *`,
      [teacherId, userId, name]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Duplicate teacher_id or username' });
    console.error('Create teacher error', err);
    res.status(500).json({ error: 'Could not create teacher' });
  } finally {
    client.release();
  }
});

router.post('/teacher-assignments', async (req, res) => {
  const { teacherId, classId, sectionId, subjectId } = req.body || {};
  if (!teacherId || !classId || !subjectId) {
    return res.status(400).json({ error: 'teacherId, classId and subjectId are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO teacher_assignments (teacher_id, class_id, section_id, subject_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [teacherId, classId, sectionId || null, subjectId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Assignment already exists' });
    console.error('Create assignment error', err);
    res.status(500).json({ error: 'Could not create assignment' });
  }
});

// ---------- Results (manual admin entry / correction) ----------

router.post('/results', async (req, res) => {
  const { studentId, examId, subjectId, fullMarks, marks, grade, gpa, status } = req.body || {};
  if (!studentId || !examId || !subjectId || marks == null || !grade || gpa == null || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  await pool.query(
    `INSERT INTO results (student_id, exam_id, subject_id, full_marks, marks, grade, gpa, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (student_id, exam_id, subject_id)
     DO UPDATE SET full_marks = EXCLUDED.full_marks, marks = EXCLUDED.marks,
                    grade = EXCLUDED.grade, gpa = EXCLUDED.gpa, status = EXCLUDED.status`,
    [studentId, examId, subjectId, fullMarks || 100, marks, grade, gpa, status]
  );
  res.json({ ok: true });
});

router.post('/results/summary', async (req, res) => {
  const { studentId, examId, totalMarks, totalFullMarks, gpa, status } = req.body || {};
  if (!studentId || !examId || totalMarks == null || totalFullMarks == null || gpa == null || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  await pool.query(
    `INSERT INTO result_summary (student_id, exam_id, total_marks, total_full_marks, gpa, status)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (student_id, exam_id)
     DO UPDATE SET total_marks = EXCLUDED.total_marks, total_full_marks = EXCLUDED.total_full_marks,
                    gpa = EXCLUDED.gpa, status = EXCLUDED.status`,
    [studentId, examId, totalMarks, totalFullMarks, gpa, status]
  );
  res.json({ ok: true });
});

// ---------- Google Sheets sync (admin-only, rule 27) ----------

router.post('/sync/sheets', async (req, res) => {
  const { sheetType } = req.body || {}; // 'students' | 'teachers' | 'marks'
  if (!['students', 'teachers', 'marks'].includes(sheetType)) {
    return res.status(400).json({ error: 'sheetType must be students, teachers, or marks' });
  }
  try {
    const report = await syncFromSheets(sheetType, req.user.id);
    res.json(report);
  } catch (err) {
    console.error('Sheets sync error', err);
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
});

router.get('/sync/log', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM sheet_sync_log ORDER BY id DESC LIMIT 50');
  res.json(rows);
});

module.exports = router;
