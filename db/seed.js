// One-command setup: `npm run seed`
// - Applies schema.sql (safe to re-run)
// - Creates the initial admin account from .env
// - Loads the sample HSC marksheet from the original design as seed data
//   (rule 47) — this is seed data, not the source of truth for real results.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const { hashPassword } = require('../utils/password');

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema...');
  await pool.query(schema);

  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn('SEED_ADMIN_PASSWORD not set — skipping admin creation. Set it in .env and re-run.');
  } else {
    const hash = await hashPassword(adminPassword);
    await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'admin')
       ON CONFLICT (username) DO NOTHING`,
      [adminUsername, hash]
    );
    console.log(`Admin account ensured: ${adminUsername}`);
  }

  console.log('Loading sample seed data (from original marksheet design)...');

  const classRes = await pool.query(
    `INSERT INTO classes (name) VALUES ('HSC') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  const classId = classRes.rows[0].id;

  const examRes = await pool.query(
    `INSERT INTO exams (name, year) VALUES ('HSC', 2026)
     ON CONFLICT (name, year) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  const examId = examRes.rows[0].id;

  const subjects = [
    ['BAN101', 'বাংলা ১ম ও ২য় পত্র'],
    ['ENG101', 'ইংরেজি ১ম ও ২য় পত্র'],
    ['ICT101', 'তথ্য ও যোগাযোগ প্রযুক্তি'],
    ['ACC101', 'হিসাববিজ্ঞান ১ম ও ২য় পত্র'],
    ['BUS101', 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা'],
    ['FIN101', 'ফিন্যান্স, ব্যাংকিং ও বিমা'],
    ['MKT101', 'উৎপাদন ব্যবস্থাপনা ও বিপণন'],
    ['STA101', 'পরিসংখ্যান (৪র্থ বিষয়)']
  ];
  const subjectIds = {};
  for (const [code, name] of subjects) {
    const isFourth = code === 'STA101';
    const { rows } = await pool.query(
      `INSERT INTO subjects (code, name, is_fourth_subject) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [code, name, isFourth]
    );
    subjectIds[code] = rows[0].id;
  }

  const studentRes = await pool.query(
    `INSERT INTO students (student_id, name, roll, registration, class_id, group_name)
     VALUES ('STU-123456', 'Rumman Ahmed', '123456', '2026123456', $1, 'Business Studies')
     ON CONFLICT (student_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [classId]
  );
  const studentId = studentRes.rows[0].id;

  const marks = [
    ['BAN101', 200, 170, 'A+', 5.00, 'PASS'],
    ['ENG101', 200, 158, 'A', 4.00, 'PASS'],
    ['ICT101', 100, 86, 'A+', 5.00, 'PASS'],
    ['ACC101', 200, 176, 'A+', 5.00, 'PASS'],
    ['BUS101', 200, 168, 'A+', 5.00, 'PASS'],
    ['FIN101', 200, 160, 'A', 4.00, 'PASS'],
    ['MKT101', 200, 172, 'A+', 5.00, 'PASS'],
    ['STA101', 200, 176, 'A+', 5.00, 'PASS']
  ];
  let totalMarks = 0, totalFull = 0;
  for (const [code, full, got, grade, gpa, status] of marks) {
    totalMarks += got; totalFull += full;
    await pool.query(
      `INSERT INTO results (student_id, exam_id, subject_id, full_marks, marks, grade, gpa, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (student_id, exam_id, subject_id) DO UPDATE SET
         full_marks = EXCLUDED.full_marks, marks = EXCLUDED.marks, grade = EXCLUDED.grade,
         gpa = EXCLUDED.gpa, status = EXCLUDED.status`,
      [studentId, examId, subjectIds[code], full, got, grade, gpa, status]
    );
  }

  await pool.query(
    `INSERT INTO result_summary (student_id, exam_id, total_marks, total_full_marks, gpa, status)
     VALUES ($1,$2,$3,$4,4.83,'PASS')
     ON CONFLICT (student_id, exam_id) DO UPDATE SET
       total_marks = EXCLUDED.total_marks, total_full_marks = EXCLUDED.total_full_marks,
       gpa = EXCLUDED.gpa, status = EXCLUDED.status`,
    [studentId, examId, totalMarks, totalFull]
  );

  console.log('Seed complete. Sample lookup: exam=HSC, year=2026, roll=123456, registration=2026123456');
  await pool.end();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
