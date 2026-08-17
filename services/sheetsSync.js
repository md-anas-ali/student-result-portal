// Google Sheets import/sync.
//
// Design rules this file enforces (per project spec):
//  - Students/teachers never touch the Sheets API directly — only this
//    server-side service does, and only an authorized admin can trigger it
//    (enforced one layer up, in routes/admin.js).
//  - Credentials come from environment variables only — never written to
//    a file the frontend/git repo could expose.
//  - Every row is VALIDATED before anything touches PostgreSQL. A sheet
//    with bad rows must not corrupt the database — invalid rows are
//    skipped and reported, valid rows are still applied.
//  - Writes are transactional and use ON CONFLICT upserts keyed on a
//    natural unique id (student_id / teacher_id / roll+registration),
//    so re-running a sync never creates duplicates.

const { google } = require('googleapis');
const pool = require('../db/pool');

function getAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured on the server');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
}

async function fetchRows(spreadsheetId, range) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

// ---------- Validators ----------
// Each returns { valid: boolean, errors: string[] } and never throws.

function validateStudentRow(cols) {
  const [studentId, name, roll, registration, className, sectionName, groupName] = cols;
  const errors = [];
  if (!studentId) errors.push('missing student_id');
  if (!name) errors.push('missing name');
  if (!roll) errors.push('missing roll');
  if (!registration) errors.push('missing registration');
  return { valid: errors.length === 0, errors, data: { studentId, name, roll, registration, className, sectionName, groupName } };
}

function validateTeacherRow(cols) {
  const [teacherId, name] = cols;
  const errors = [];
  if (!teacherId) errors.push('missing teacher_id');
  if (!name) errors.push('missing name');
  return { valid: errors.length === 0, errors, data: { teacherId, name } };
}

function validateMarksRow(cols) {
  const [studentId, examName, examYear, subjectCode, fullMarks, marks, grade, gpa, status] = cols;
  const errors = [];
  if (!studentId) errors.push('missing student_id');
  if (!examName) errors.push('missing exam name');
  if (!examYear || Number.isNaN(Number(examYear))) errors.push('missing/invalid exam year');
  if (!subjectCode) errors.push('missing subject code');
  if (marks == null || Number.isNaN(Number(marks))) errors.push('missing/invalid marks');
  if (!grade) errors.push('missing grade');
  if (gpa == null || Number.isNaN(Number(gpa))) errors.push('missing/invalid gpa');
  if (!status || !['PASS', 'FAIL'].includes(String(status).toUpperCase())) errors.push('missing/invalid status');
  return {
    valid: errors.length === 0,
    errors,
    data: {
      studentId, examName, examYear: Number(examYear), subjectCode,
      fullMarks: fullMarks ? Number(fullMarks) : 100,
      marks: Number(marks), grade, gpa: Number(gpa), status: String(status).toUpperCase()
    }
  };
}

const SHEET_CONFIG = {
  students: { envId: 'GOOGLE_SHEETS_STUDENTS_ID', range: 'Sheet1!A2:G', validator: validateStudentRow },
  teachers: { envId: 'GOOGLE_SHEETS_TEACHERS_ID', range: 'Sheet1!A2:B', validator: validateTeacherRow },
  marks: { envId: 'GOOGLE_SHEETS_MARKS_ID', range: 'Sheet1!A2:I', validator: validateMarksRow }
};

async function applyStudents(client, rows) {
  for (const r of rows) {
    const classRes = r.className
      ? await client.query('SELECT id FROM classes WHERE name = $1', [r.className])
      : { rows: [] };
    const sectionRes = r.sectionName && classRes.rows[0]
      ? await client.query('SELECT id FROM sections WHERE class_id = $1 AND name = $2', [classRes.rows[0].id, r.sectionName])
      : { rows: [] };

    await client.query(
      `INSERT INTO students (student_id, name, roll, registration, class_id, section_id, group_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (student_id) DO UPDATE SET
         name = EXCLUDED.name, roll = EXCLUDED.roll, registration = EXCLUDED.registration,
         class_id = EXCLUDED.class_id, section_id = EXCLUDED.section_id,
         group_name = EXCLUDED.group_name, updated_at = now()`,
      [r.studentId, r.name, r.roll, r.registration, classRes.rows[0]?.id || null, sectionRes.rows[0]?.id || null, r.groupName || null]
    );
  }
}

async function applyTeachers(client, rows) {
  for (const r of rows) {
    await client.query(
      `INSERT INTO teachers (teacher_id, name) VALUES ($1,$2)
       ON CONFLICT (teacher_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [r.teacherId, r.name]
    );
  }
}

async function applyMarks(client, rows) {
  for (const r of rows) {
    const studentRes = await client.query('SELECT id FROM students WHERE student_id = $1', [r.studentId]);
    if (!studentRes.rows[0]) throw new Error(`Unknown student_id ${r.studentId}`);

    const examRes = await client.query(
      `INSERT INTO exams (name, year) VALUES ($1,$2)
       ON CONFLICT (name, year) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [r.examName, r.examYear]
    );
    const subjectRes = await client.query('SELECT id FROM subjects WHERE code = $1', [r.subjectCode]);
    if (!subjectRes.rows[0]) throw new Error(`Unknown subject code ${r.subjectCode}`);

    await client.query(
      `INSERT INTO results (student_id, exam_id, subject_id, full_marks, marks, grade, gpa, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (student_id, exam_id, subject_id) DO UPDATE SET
         full_marks = EXCLUDED.full_marks, marks = EXCLUDED.marks,
         grade = EXCLUDED.grade, gpa = EXCLUDED.gpa, status = EXCLUDED.status`,
      [studentRes.rows[0].id, examRes.rows[0].id, subjectRes.rows[0].id, r.fullMarks, r.marks, r.grade, r.gpa, r.status]
    );
  }
}

async function syncFromSheets(sheetType, triggeredByUserId) {
  const config = SHEET_CONFIG[sheetType];
  const spreadsheetId = process.env[config.envId];
  if (!spreadsheetId) throw new Error(`${config.envId} is not configured on the server`);

  const rawRows = await fetchRows(spreadsheetId, config.range);

  const valid = [];
  const rejected = [];
  for (const cols of rawRows) {
    const result = config.validator(cols);
    if (result.valid) valid.push(result.data);
    else rejected.push({ row: cols, errors: result.errors });
  }

  const client = await pool.connect();
  let status = 'success';
  let errorSummary = null;
  try {
    await client.query('BEGIN');
    if (sheetType === 'students') await applyStudents(client, valid);
    if (sheetType === 'teachers') await applyTeachers(client, valid);
    if (sheetType === 'marks') await applyMarks(client, valid);
    await client.query('COMMIT');
    status = rejected.length > 0 ? 'partial' : 'success';
  } catch (err) {
    // Any failure during apply rolls back the WHOLE batch — a bad sheet
    // can never leave the database half-written / corrupted (rule 38).
    await client.query('ROLLBACK');
    status = 'failed';
    errorSummary = err.message;
    valid.length = 0; // nothing was actually committed
  } finally {
    client.release();
  }

  await pool.query(
    `INSERT INTO sheet_sync_log (sheet_type, triggered_by, rows_total, rows_valid, rows_rejected, status, error_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sheetType, triggeredByUserId, rawRows.length, valid.length, rejected.length, status, errorSummary]
  );

  return {
    status,
    rowsTotal: rawRows.length,
    rowsApplied: valid.length,
    rowsRejected: rejected.length,
    rejectedDetail: rejected.slice(0, 20), // cap what comes back over the API
    error: errorSummary
  };
}

module.exports = { syncFromSheets };
