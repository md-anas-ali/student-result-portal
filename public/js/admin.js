function showError(msg) {
    const el = document.getElementById('errorMsg');
    el.textContent = msg;
    el.classList.add('show');
}
function clearError() {
    document.getElementById('errorMsg').classList.remove('show');
}

document.querySelectorAll('.dash-nav button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.dash-nav button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
    });
});

async function guard() {
    const r = await fetch('/api/me');
    if (!r.ok) { window.location.href = '/login.html'; return false; }
    const me = await r.json();
    if (me.role !== 'admin') { window.location.href = '/login.html'; return false; }
    return true;
}

async function api(path, opts) {
    const r = await fetch('/api/admin' + path, opts);
    const data = await r.json();
    if (!r.ok) { showError(data.error || 'Request failed'); throw new Error(data.error); }
    clearError();
    return data;
}

// ---------- Students ----------
async function createStudent() {
    const createLogin = (document.getElementById('s_loginUser').value)
        ? { username: document.getElementById('s_loginUser').value, password: document.getElementById('s_loginPass').value }
        : undefined;
    await api('/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        studentId: document.getElementById('s_studentId').value,
        name: document.getElementById('s_name').value,
        roll: document.getElementById('s_roll').value,
        registration: document.getElementById('s_registration').value,
        classId: Number(document.getElementById('s_classId').value) || null,
        sectionId: Number(document.getElementById('s_sectionId').value) || null,
        groupName: document.getElementById('s_group').value || null,
        createLogin
    })});
    loadStudents();
}
async function loadStudents() {
    const rows = await api('/students');
    document.querySelector('#studentsTable tbody').innerHTML = rows.map(s => `
        <tr><td>${s.id}</td><td>${s.student_id}</td><td>${s.name}</td><td>${s.roll}</td><td>${s.registration}</td><td>${s.class_name || ''}</td></tr>`).join('');
}

// ---------- Teachers ----------
async function createTeacher() {
    const createLogin = (document.getElementById('t_loginUser').value)
        ? { username: document.getElementById('t_loginUser').value, password: document.getElementById('t_loginPass').value }
        : undefined;
    await api('/teachers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        teacherId: document.getElementById('t_teacherId').value,
        name: document.getElementById('t_name').value,
        createLogin
    })});
    loadTeachers();
}
async function loadTeachers() {
    const rows = await api('/teachers');
    document.querySelector('#teachersTable tbody').innerHTML = rows.map(t => `<tr><td>${t.id}</td><td>${t.teacher_id}</td><td>${t.name}</td></tr>`).join('');
}
async function createAssignment() {
    await api('/teacher-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        teacherId: Number(document.getElementById('ta_teacherId').value),
        classId: Number(document.getElementById('ta_classId').value),
        sectionId: Number(document.getElementById('ta_sectionId').value) || null,
        subjectId: Number(document.getElementById('ta_subjectId').value)
    })});
    alert('Assignment created.');
}

// ---------- Classes / Sections / Subjects ----------
async function createClass() {
    await api('/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('c_name').value }) });
    loadClasses();
}
async function loadClasses() {
    const rows = await api('/classes');
    document.querySelector('#classesTable tbody').innerHTML = rows.map(c => `<tr><td>${c.id}</td><td>${c.name}</td></tr>`).join('');
}
async function createSection() {
    await api('/sections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        classId: Number(document.getElementById('sec_classId').value), name: document.getElementById('sec_name').value
    })});
    loadSections();
}
async function loadSections() {
    const rows = await api('/sections');
    document.querySelector('#sectionsTable tbody').innerHTML = rows.map(s => `<tr><td>${s.id}</td><td>${s.class_id}</td><td>${s.name}</td></tr>`).join('');
}
async function createSubject() {
    await api('/subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        code: document.getElementById('sub_code').value, name: document.getElementById('sub_name').value
    })});
    loadSubjects();
}
async function loadSubjects() {
    const rows = await api('/subjects');
    document.querySelector('#subjectsTable tbody').innerHTML = rows.map(s => `<tr><td>${s.id}</td><td>${s.code}</td><td>${s.name}</td></tr>`).join('');
}

// ---------- Exams ----------
async function createExam() {
    await api('/exams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        name: document.getElementById('e_name').value, year: Number(document.getElementById('e_year').value)
    })});
    loadExams();
}
async function loadExams() {
    const rows = await api('/exams');
    document.querySelector('#examsTable tbody').innerHTML = rows.map(e => `<tr><td>${e.id}</td><td>${e.name}</td><td>${e.year}</td></tr>`).join('');
}

// ---------- Results ----------
async function saveResult() {
    await api('/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        studentId: Number(document.getElementById('r_studentId').value),
        examId: Number(document.getElementById('r_examId').value),
        subjectId: Number(document.getElementById('r_subjectId').value),
        fullMarks: Number(document.getElementById('r_full').value),
        marks: Number(document.getElementById('r_marks').value),
        grade: document.getElementById('r_grade').value,
        gpa: Number(document.getElementById('r_gpa').value),
        status: document.getElementById('r_status').value
    })});
    alert('Result saved.');
}
async function saveSummary() {
    await api('/results/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        studentId: Number(document.getElementById('rs_studentId').value),
        examId: Number(document.getElementById('rs_examId').value),
        totalMarks: Number(document.getElementById('rs_total').value),
        totalFullMarks: Number(document.getElementById('rs_totalFull').value),
        gpa: Number(document.getElementById('rs_gpa').value),
        status: document.getElementById('rs_status').value
    })});
    alert('Summary saved.');
}

// ---------- Users ----------
async function createUser() {
    await api('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        username: document.getElementById('u_username').value,
        password: document.getElementById('u_password').value,
        role: document.getElementById('u_role').value
    })});
    loadUsers();
}
async function loadUsers() {
    const rows = await api('/users');
    document.querySelector('#usersTable tbody').innerHTML = rows.map(u => `
        <tr><td>${u.id}</td><td>${u.username}</td><td>${u.role}</td><td>${u.is_active}</td>
        <td><button onclick="toggleUser(${u.id}, ${!u.is_active})">${u.is_active ? 'Disable' : 'Enable'}</button></td></tr>`).join('');
}
async function toggleUser(id, makeActive) {
    await api(`/users/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: makeActive }) });
    loadUsers();
}

// ---------- Sync ----------
async function runSync(type) {
    const out = document.getElementById('syncResult');
    out.textContent = 'Running sync...';
    try {
        const report = await api('/sync/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheetType: type }) });
        out.textContent = JSON.stringify(report, null, 2);
    } catch (e) {
        out.textContent = 'Sync failed: ' + e.message;
    }
}

async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

guard().then(ok => {
    if (!ok) return;
    loadStudents(); loadTeachers(); loadClasses(); loadSections(); loadSubjects(); loadExams(); loadUsers();
});
