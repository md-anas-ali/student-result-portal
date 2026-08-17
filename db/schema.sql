-- ============================================================
-- Student Result Portal — PostgreSQL schema (source of truth)
-- Safe to re-run: uses IF NOT EXISTS everywhere.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(64)  NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    role            VARCHAR(16)  NOT NULL CHECK (role IN ('admin','teacher','student')),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS classes (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(64) NOT NULL UNIQUE   -- e.g. "SSC", "HSC-1", "Class 9"
);

CREATE TABLE IF NOT EXISTS sections (
    id        SERIAL PRIMARY KEY,
    class_id  INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name      VARCHAR(32) NOT NULL,       -- e.g. "A", "Science", "Commerce"
    UNIQUE (class_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sections_class ON sections(class_id);

CREATE TABLE IF NOT EXISTS subjects (
    id      SERIAL PRIMARY KEY,
    code    VARCHAR(32) NOT NULL UNIQUE,
    name    VARCHAR(128) NOT NULL,
    is_fourth_subject BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS exams (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(64) NOT NULL,         -- e.g. "SSC", "HSC"
    year    INTEGER NOT NULL,
    UNIQUE (name, year)
);

-- ---------- People ----------

CREATE TABLE IF NOT EXISTS students (
    id              SERIAL PRIMARY KEY,
    student_id      VARCHAR(32) NOT NULL UNIQUE,      -- public-facing unique student id (not necessarily login username)
    user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    name            VARCHAR(128) NOT NULL,
    roll            VARCHAR(32) NOT NULL,
    registration    VARCHAR(32) NOT NULL,
    class_id        INTEGER REFERENCES classes(id),
    section_id      INTEGER REFERENCES sections(id),
    group_name      VARCHAR(64),                      -- e.g. Science / Commerce / Arts
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll);
CREATE INDEX IF NOT EXISTS idx_students_registration ON students(registration);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id, section_id);

CREATE TABLE IF NOT EXISTS teachers (
    id          SERIAL PRIMARY KEY,
    teacher_id  VARCHAR(32) NOT NULL UNIQUE,
    user_id     INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    name        VARCHAR(128) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which teacher is allowed to see/manage which class+section+subject.
-- This table is the backend-enforced authorization boundary for teachers (rule 15, 26).
CREATE TABLE IF NOT EXISTS teacher_assignments (
    id          SERIAL PRIMARY KEY,
    teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    section_id  INTEGER REFERENCES sections(id) ON DELETE CASCADE,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    UNIQUE (teacher_id, class_id, section_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON teacher_assignments(teacher_id);

-- ---------- Results ----------

CREATE TABLE IF NOT EXISTS results (
    id          SERIAL PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_id     INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    full_marks  NUMERIC(6,2) NOT NULL DEFAULT 100,
    marks       NUMERIC(6,2) NOT NULL,
    grade       VARCHAR(4) NOT NULL,
    gpa         NUMERIC(3,2) NOT NULL,
    status      VARCHAR(8) NOT NULL CHECK (status IN ('PASS','FAIL')),
    UNIQUE (student_id, exam_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_results_student_exam ON results(student_id, exam_id);

-- One row per student per exam: overall summary (source of truth for the marksheet header)
CREATE TABLE IF NOT EXISTS result_summary (
    id              SERIAL PRIMARY KEY,
    student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_id         INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    total_marks     NUMERIC(8,2) NOT NULL,
    total_full_marks NUMERIC(8,2) NOT NULL,
    gpa             NUMERIC(3,2) NOT NULL,
    status          VARCHAR(8) NOT NULL CHECK (status IN ('PASS','FAIL')),
    UNIQUE (student_id, exam_id)
);
CREATE INDEX IF NOT EXISTS idx_result_summary_lookup ON result_summary(student_id, exam_id);

-- ---------- Sync bookkeeping (avoid duplicate imports, rule 36/37/39) ----------

CREATE TABLE IF NOT EXISTS sheet_sync_log (
    id            SERIAL PRIMARY KEY,
    sheet_type    VARCHAR(16) NOT NULL,   -- 'students' | 'teachers' | 'marks'
    triggered_by  INTEGER REFERENCES users(id),
    rows_total    INTEGER NOT NULL DEFAULT 0,
    rows_valid    INTEGER NOT NULL DEFAULT 0,
    rows_rejected INTEGER NOT NULL DEFAULT 0,
    status        VARCHAR(16) NOT NULL,   -- 'success' | 'partial' | 'failed'
    error_summary TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
