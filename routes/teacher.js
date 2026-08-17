const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, authorize('teacher'));

// Helper: does this teacher have an assignment for this class/section/subject?
// Used to gate every write, so a teacher can't reach another teacher's
// class/subject just by changing the request body/URL (rule 26).
async function hasAssignment(teacherId, classId, sectionId, subjectId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM teacher_assignments
     WHERE teacher_id = $1 AND class_id = $2
       AND (section_id = $3 OR ($3 IS NULL AND section_id IS NULL))
       AND subject_id = $4`,
    [teacherId, classId, sectionId, subjectId]
  );
  return rows.length > 0;
}

router.get('/me', async (req, res) => {
  const { rows } = await pool.query('SELECT teacher_id, name FROM teachers WHERE id = $1', [req.user.teacherId]);
  if (!rows[0]) return res.status(404).json({ error: 'Profile not found' });
  res.json(rows[0]);
});

// Classes/sections/subjects this teacher is actually assigned to — the
// source list the "My Classes" / "My Subjects" dashboard pages are built from.
router.get('/assignments', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ta.id, c.id AS class_id, c.name AS class_name,
            sec.id AS section_id, sec.name AS section_name,
            sub.id AS subject_id, sub.name AS subject_name
     FROM teacher_assignments ta
     JOIN classes c ON c.id = ta.class_id
     LEFT JOIN sections sec ON sec.id = ta.section_id
     JOIN subjects sub ON sub.id = ta.subject_id
     WHERE ta.teacher_id = $1
     ORDER BY c.name, sec.name, sub.name`,
    [req.user.teacherId]
  );
  res.json(rows);
});

// Students in an assigned class/section only.
router.get('/students', async (req, res) => {
  const classId = Number(req.query.classId);
  const sectionId = req.query.sectionId ? Number(req.query.sectionId) : null;
  if (!Number.isInteger(classId)) return res.status(400).json({ error: 'classId is required' });

  const { rows: assigned } = await pool.query(
    `SELECT 1 FROM teacher_assignments
     WHERE teacher_id = $1 AND class_id = $2
       AND (section_id = $3 OR $3 IS NULL)`,
    [req.user.teacherId, classId, sectionId]
  );
  if (assigned.length === 0) return res.status(403).json({ error: 'Not assigned to this class/section' });

  const { rows } = await pool.query(
    `SELECT id, student_id, name, roll, registration
     FROM students WHERE class_id = $1 AND ($2::int IS NULL OR section_id = $2)
     ORDER BY roll`,
    [classId, sectionId]
  );
  res.json(rows);
});

// Enter/update marks — only for a student+subject the teacher is assigned to.
router.post('/marks', async (req, res) => {
  const { studentId, examId, subjectId, fullMarks, marks, grade, gpa, status } = req.body || {};
  if (!studentId || !examId || !subjectId || marks == null || !grade || gpa == null || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    const { rows: studentRows } = await client.query(
      'SELECT class_id, section_id FROM students WHERE id = $1',
      [studentId]
    );
    const student = studentRows[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const allowed = await hasAssignment(req.user.teacherId, student.class_id, student.section_id, subjectId);
    if (!allowed) return res.status(403).json({ error: 'Not assigned to this class/subject' });

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO results (student_id, exam_id, subject_id, full_marks, marks, grade, gpa, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (student_id, exam_id, subject_id)
       DO UPDATE SET full_marks = EXCLUDED.full_marks, marks = EXCLUDED.marks,
                      grade = EXCLUDED.grade, gpa = EXCLUDED.gpa, status = EXCLUDED.status`,
      [studentId, examId, subjectId, fullMarks || 100, marks, grade, gpa, status]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Marks entry error', err);
    res.status(500).json({ error: 'Could not save marks' });
  } finally {
    client.release();
  }
});

module.exports = router;
