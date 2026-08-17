const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');

const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

// Public marksheet search. Deliberately requires the FULL combination —
// exam name + year + roll + registration — not just a roll number,
// so a guessed/incremented roll can't pull up someone else's result (rule 23/25).
router.get('/result', searchLimiter, async (req, res) => {
  const { exam, year, roll, registration } = req.query;

  if (!exam || !year || !roll || !registration) {
    return res.status(400).json({ error: 'Exam, year, roll and registration are all required' });
  }

  try {
    const { rows: examRows } = await pool.query(
      'SELECT id, name, year FROM exams WHERE name = $1 AND year = $2',
      [exam, year]
    );
    const examRow = examRows[0];
    if (!examRow) {
      return res.status(404).json({ error: 'No result found for this exam and year' });
    }

    const { rows: studentRows } = await pool.query(
      `SELECT id, student_id, name, roll, registration, group_name,
              (SELECT name FROM classes WHERE id = class_id) AS class_name
       FROM students
       WHERE roll = $1 AND registration = $2`,
      [roll, registration]
    );
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ error: 'No matching student found' });
    }

    const { rows: summaryRows } = await pool.query(
      `SELECT total_marks, total_full_marks, gpa, status
       FROM result_summary WHERE student_id = $1 AND exam_id = $2`,
      [student.id, examRow.id]
    );
    const summary = summaryRows[0];
    if (!summary) {
      return res.status(404).json({ error: 'Result not published for this exam yet' });
    }

    const { rows: subjectRows } = await pool.query(
      `SELECT sub.name AS subject, r.full_marks, r.marks, r.grade, r.gpa, r.status
       FROM results r
       JOIN subjects sub ON sub.id = r.subject_id
       WHERE r.student_id = $1 AND r.exam_id = $2
       ORDER BY sub.id`,
      [student.id, examRow.id]
    );

    res.json({
      exam: { name: examRow.name, year: examRow.year },
      student: {
        name: student.name,
        roll: student.roll,
        registration: student.registration,
        class: student.class_name,
        group: student.group_name
      },
      summary,
      subjects: subjectRows
    });
  } catch (err) {
    console.error('Public result search error', err);
    res.status(500).json({ error: 'Search failed, please try again' });
  }
});

module.exports = router;
