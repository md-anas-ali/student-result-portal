const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, authorize('student'));

// A logged-in student can only ever see their OWN data. The student id comes
// from the verified JWT (req.user.studentId), never from a URL/query param —
// so changing the URL cannot expose another student's record (rule 25).
router.get('/me', async (req, res) => {
  if (!req.user.studentId) return res.status(404).json({ error: 'No student profile linked to this account' });
  const { rows } = await pool.query(
    `SELECT s.student_id, s.name, s.roll, s.registration, s.group_name,
            c.name AS class_name, sec.name AS section_name
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE s.id = $1`,
    [req.user.studentId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Profile not found' });
  res.json(rows[0]);
});

router.get('/results', async (req, res) => {
  if (!req.user.studentId) return res.status(404).json({ error: 'No student profile linked to this account' });
  const { rows } = await pool.query(
    `SELECT e.id AS exam_id, e.name AS exam, e.year, rs.total_marks, rs.total_full_marks, rs.gpa, rs.status
     FROM result_summary rs
     JOIN exams e ON e.id = rs.exam_id
     WHERE rs.student_id = $1
     ORDER BY e.year DESC`,
    [req.user.studentId]
  );
  res.json(rows);
});

router.get('/marksheet/:examId', async (req, res) => {
  if (!req.user.studentId) return res.status(404).json({ error: 'No student profile linked to this account' });
  const examId = Number(req.params.examId);
  if (!Number.isInteger(examId)) return res.status(400).json({ error: 'Invalid exam id' });

  const { rows: subjectRows } = await pool.query(
    `SELECT sub.name AS subject, r.full_marks, r.marks, r.grade, r.gpa, r.status
     FROM results r
     JOIN subjects sub ON sub.id = r.subject_id
     WHERE r.student_id = $1 AND r.exam_id = $2
     ORDER BY sub.id`,
    [req.user.studentId, examId]
  );
  if (subjectRows.length === 0) return res.status(404).json({ error: 'Marksheet not found for this exam' });

  const { rows: summaryRows } = await pool.query(
    `SELECT total_marks, total_full_marks, gpa, status FROM result_summary WHERE student_id = $1 AND exam_id = $2`,
    [req.user.studentId, examId]
  );

  res.json({ summary: summaryRows[0] || null, subjects: subjectRows });
});

module.exports = router;
