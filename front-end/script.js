const API_BASE = window.location.origin;

const SYLLABUS_UNITS = {
    'Data Structures': [
        'Unit 1: Arrays & Linked Lists',
        'Unit 2: Stacks & Queues',
        'Unit 3: Trees & Binary Search Trees',
        'Unit 4: Graphs & Graph Algorithms',
        'Unit 5: Sorting, Searching & Hashing'
    ],
    'Web Development': [
        'Unit 1: HTML5 Semantics & Structure',
        'Unit 2: Modern CSS3, Flexbox & Grid',
        'Unit 3: JavaScript Core, DOM & Events',
        'Unit 4: Asynchronous JavaScript & Fetch API',
        'Unit 5: Node.js & Express.js Fundamentals'
    ]
};

const state = {
    currentUser: null,
    teacher: { stats: {}, quizzes: [], questionBank: [], selectedQbQuestionIds: new Set(), customQuestions: [] },
    student: { quizzes: [], activeQuiz: null, quizQuestions: [], currentQuestionIndex: 0, userAnswers: {}, timerInterval: null, secondsRemaining: 0 }
};

const $ = id => document.getElementById(id);

async function api(endpoint, options = {}) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// ROUTING & SESSION
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkExistingSession();
});

function checkExistingSession() {
    const saved = sessionStorage.getItem('quiz_user');
    if (saved) {
        try {
            state.currentUser = JSON.parse(saved);
            renderAuthenticatedView();
            return;
        } catch { sessionStorage.removeItem('quiz_user'); }
    }
    showView('login');
}

function showView(viewName) {
    const views = { login: $('view-login'), teacher: $('view-teacher'), student: $('view-student'), takeQuiz: $('view-take-quiz') };
    Object.entries(views).forEach(([name, el]) => {
        el.classList.toggle('active', name === viewName);
        el.classList.toggle('hidden', name !== viewName);
    });
    $('nav-user-panel').classList.toggle('hidden', viewName === 'login');
}

// EVENT LISTENERS
function setupEventListeners() {
    $('form-login').addEventListener('submit', e => {
        e.preventDefault();
        handleLogin($('input-username').value.trim(), $('input-password').value.trim());
    });

    $('btn-logout').addEventListener('click', handleLogout);

    document.querySelectorAll('.tabs-nav .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab) switchTeacherTab(btn.dataset.tab);
            if (btn.dataset.studentTab) switchStudentTab(btn.dataset.studentTab);
        });
    });

    $('stat-card-completed').addEventListener('click', () => switchStudentTab('tab-student-completed'));
    $('btn-go-create-quiz').addEventListener('click', () => switchTeacherTab('tab-teacher-create'));
    $('btn-add-custom-q').addEventListener('click', handleAddCustomQuestion);
    $('form-create-quiz').addEventListener('submit', handlePublishQuiz);
    $('filter-results-quiz').addEventListener('change', () => loadTeacherResults($('filter-results-quiz').value));

    $('btn-quiz-prev').addEventListener('click', () => navigateQuiz(-1));
    $('btn-quiz-next').addEventListener('click', () => navigateQuiz(1));
    $('btn-quiz-submit').addEventListener('click', submitQuiz);
    $('btn-result-close').addEventListener('click', () => {
        $('modal-result').classList.add('hidden');
        if ($('view-take-quiz').classList.contains('active')) {
            loadStudentDashboard();
            showView('student');
        }
    });
}

// AUTH
async function handleLogin(username, password) {
    $('login-error').classList.add('hidden');
    try {
        const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        state.currentUser = data.user;
        sessionStorage.setItem('quiz_user', JSON.stringify(data.user));
        renderAuthenticatedView();
    } catch (err) {
        $('login-error').textContent = err.message;
        $('login-error').classList.remove('hidden');
    }
}

function handleLogout() {
    if (state.student.timerInterval) clearInterval(state.student.timerInterval);
    state.currentUser = null;
    sessionStorage.removeItem('quiz_user');
    $('input-username').value = '';
    $('input-password').value = '';
    $('login-error').classList.add('hidden');
    showView('login');
}

function renderAuthenticatedView() {
    const user = state.currentUser;
    $('user-display-name').textContent = user.name;
    const isTeacher = user.role === 'teacher';
    $('user-display-badge').textContent = isTeacher ? `Teacher (${user.subject})` : `Student (Section ${user.section})`;
    $('user-display-badge').className = `badge ${isTeacher ? 'badge-primary' : 'badge-accent'}`;
    showView(isTeacher ? 'teacher' : 'student');
    isTeacher ? loadTeacherDashboard() : loadStudentDashboard();
}

// TEACHER DASHBOARD
function switchTeacherTab(tabId) {
    document.querySelectorAll('.tabs-nav .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === tabId);
        c.classList.toggle('hidden', c.id !== tabId);
    });
    if (tabId === 'tab-teacher-create') initCreateQuizForm();
    if (tabId === 'tab-teacher-results') loadTeacherResults();
}

async function loadTeacherDashboard() {
    try {
        const data = await api(`/api/teacher/dashboard?teacherId=${state.currentUser.id}`);
        state.teacher.stats = data.stats;
        state.teacher.quizzes = data.quizzes;

        $('teacher-stat-subject').textContent = data.teacher.subject;
        $('teacher-stat-sections').textContent = data.stats.assignedSections.map(s => `Sec ${s}`).join(', ');
        $('teacher-stat-quizzes').textContent = data.stats.totalQuizzes;
        $('teacher-stat-submissions').textContent = data.stats.totalSubmissions;

        renderTeacherQuizzesList(data.quizzes);
    } catch (err) {
        alert('Error loading teacher dashboard: ' + err.message);
    }
}

function renderTeacherQuizzesList(quizzes) {
    if (!quizzes.length) {
        $('teacher-quizzes-list').innerHTML = `
            <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1;">
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">No quizzes created yet!</p>
                <p class="text-sm">Click "Create Quiz" above to schedule a new test for your sections.</p>
            </div>`;
        return;
    }

    $('teacher-quizzes-list').innerHTML = quizzes.map(q => {
        const units = Array.isArray(q.units) ? q.units : [];
        const unitsHtml = units.map(u => `<span class="badge badge-outline">${escapeHtml(u)}</span>`).join(' ');
        return `
            <div class="quiz-card">
                <div>
                    <div class="quiz-card-header">
                        <span class="badge badge-primary">${escapeHtml(q.subject)}</span>
                        <span class="badge badge-accent">Target: Section ${escapeHtml(q.target_section)}</span>
                    </div>
                    <h4 class="quiz-card-title">${escapeHtml(q.title)}</h4>
                    <div class="quiz-units-badges">${unitsHtml}</div>
                    <div class="quiz-meta-info">
                        <div><strong>Opens:</strong> ${new Date(q.open_time).toLocaleString()}</div>
                        <div><strong>Closes:</strong> ${new Date(q.close_time).toLocaleString()}</div>
                        <div><strong>Duration:</strong> ${q.duration_minutes} mins | <strong>Questions:</strong> ${q.question_count}</div>
                    </div>
                </div>
                <div class="d-flex justify-between align-center mt-3 pt-3" style="border-top: 1px solid var(--border-color);">
                    <span class="font-bold text-primary">${q.submission_count} Submissions</span>
                    <button class="btn btn-secondary btn-sm" onclick="viewQuizResults(${q.id})">View Results</button>
                </div>
            </div>`;
    }).join('');
}

window.viewQuizResults = function(quizId) {
    switchTeacherTab('tab-teacher-results');
    $('filter-results-quiz').value = quizId;
    loadTeacherResults(quizId);
};

// CREATE QUIZ
function initCreateQuizForm() {
    const teacher = state.currentUser;
    const units = SYLLABUS_UNITS[teacher.subject] || [];

    $('create-quiz-section').innerHTML = (teacher.sections || []).map(s => `<option value="${s}">Section ${s}</option>`).join('');

    const now = new Date();
    $('create-quiz-open').value = formatDateTimeLocal(now);
    $('create-quiz-close').value = formatDateTimeLocal(new Date(now.getTime() + 86400000));

    $('unit-checkboxes-container').innerHTML = units.map((u, i) => `
        <label class="unit-checkbox-item">
            <input type="checkbox" name="unit_select" value="${escapeHtml(u)}" ${i === 0 ? 'checked' : ''}>
            <span><strong>Unit ${i + 1}:</strong> ${escapeHtml(u.replace(/^Unit \d+:\s*/, ''))}</span>
        </label>`).join('');

    $('custom-q-unit').innerHTML = units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');

    state.teacher.selectedQbQuestionIds.clear();
    state.teacher.customQuestions = [];
    renderCustomQuestionsAdded();

    $('unit-checkboxes-container').querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', fetchQuestionBankForSelectedUnits);
    });

    fetchQuestionBankForSelectedUnits();
}

function getSelectedUnits() {
    return Array.from($('unit-checkboxes-container').querySelectorAll('input[name="unit_select"]:checked')).map(c => c.value);
}

async function fetchQuestionBankForSelectedUnits() {
    const units = getSelectedUnits();
    if (!units.length) {
        $('qb-questions-list').innerHTML = `<div class="text-muted p-3">Please check at least one unit above to view question bank questions.</div>`;
        state.teacher.questionBank = [];
        updateSelectedQuestionsCounter();
        return;
    }

    try {
        const data = await api(`/api/teacher/question-bank?subject=${encodeURIComponent(state.currentUser.subject)}&units=${encodeURIComponent(units.join(','))}`);
        state.teacher.questionBank = data.questions || [];
        renderQuestionBankList();
    } catch {
        $('qb-questions-list').innerHTML = `<div class="text-danger p-3">Failed to load question bank.</div>`;
    }
}

function renderQuestionBankList() {
    const questions = state.teacher.questionBank;
    if (!questions.length) {
        $('qb-questions-list').innerHTML = `<div class="text-muted p-3">No questions found in question bank for the selected units.</div>`;
        return;
    }

    $('qb-questions-list').innerHTML = questions.map(q => {
        const isChecked = state.teacher.selectedQbQuestionIds.has(q.id);
        const preview = q.options.map((opt, i) => `
            <span style="${i === q.correctAnswer ? 'color: var(--success); font-weight: 600;' : ''}">
                ${String.fromCharCode(65 + i)}. ${escapeHtml(opt)} ${i === q.correctAnswer ? '(Correct)' : ''}
            </span>`).join('');

        return `
            <div class="qb-item">
                <input type="checkbox" id="qb-q-${q.id}" ${isChecked ? 'checked' : ''} onchange="toggleQbQuestion(${q.id})">
                <div class="qb-item-details">
                    <div>
                        <span class="badge badge-outline" style="font-size: 0.7rem;">${escapeHtml(q.unit)}</span>
                        <label for="qb-q-${q.id}" style="font-weight: 600; cursor: pointer; margin-left: 0.35rem;">${escapeHtml(q.questionText)}</label>
                    </div>
                    <div class="qb-options-preview">${preview}</div>
                </div>
            </div>`;
    }).join('');

    updateSelectedQuestionsCounter();
}

window.toggleQbQuestion = function(qId) {
    state.teacher.selectedQbQuestionIds.has(qId) ? state.teacher.selectedQbQuestionIds.delete(qId) : state.teacher.selectedQbQuestionIds.add(qId);
    updateSelectedQuestionsCounter();
};

function handleAddCustomQuestion() {
    const unit = $('custom-q-unit').value, text = $('custom-q-text').value.trim();
    const opts = [$('custom-opt-0').value.trim(), $('custom-opt-1').value.trim(), $('custom-opt-2').value.trim(), $('custom-opt-3').value.trim()];
    const correct = parseInt($('custom-q-correct').value, 10);

    if (!text || opts.some(o => !o)) return alert('Please fill in question text and all 4 options.');

    state.teacher.customQuestions.push({ id: 'c_' + Date.now(), unit, questionText: text, options: opts, correctAnswer: correct });
    $('custom-q-text').value = '';
    ['custom-opt-0', 'custom-opt-1', 'custom-opt-2', 'custom-opt-3'].forEach(id => $(id).value = '');

    renderCustomQuestionsAdded();
    updateSelectedQuestionsCounter();
}

function renderCustomQuestionsAdded() {
    const list = state.teacher.customQuestions;
    if (!list.length) return $('custom-questions-added').innerHTML = '';

    $('custom-questions-added').innerHTML = `
        <h5 class="mb-2">Custom Questions Added (${list.length}):</h5>
        ${list.map((q, i) => `
            <div class="card p-3 mb-2 d-flex justify-between align-center" style="background: white;">
                <div>
                    <span class="badge badge-accent">${escapeHtml(q.unit)}</span>
                    <strong>${i + 1}. ${escapeHtml(q.questionText)}</strong>
                    <div class="text-sm text-muted mt-1">Correct Answer: Option ${q.correctAnswer + 1} (${escapeHtml(q.options[q.correctAnswer])})</div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="removeCustomQuestion(${i})">Remove</button>
            </div>`).join('')}`;
}

window.removeCustomQuestion = function(i) {
    state.teacher.customQuestions.splice(i, 1);
    renderCustomQuestionsAdded();
    updateSelectedQuestionsCounter();
};

function updateSelectedQuestionsCounter() {
    const qb = state.teacher.selectedQbQuestionIds.size, c = state.teacher.customQuestions.length;
    $('selected-questions-count').textContent = `${qb + c} Questions Selected (${qb} Bank + ${c} Custom)`;
}

async function handlePublishQuiz(e) {
    e.preventDefault();
    $('create-quiz-error').classList.add('hidden');

    const units = getSelectedUnits();
    if (!units.length) return showError('create-quiz-error', 'Please select at least one unit for this quiz.');

    const questions = [
        ...state.teacher.questionBank.filter(q => state.teacher.selectedQbQuestionIds.has(q.id)),
        ...state.teacher.customQuestions
    ].map(q => ({ unit: q.unit, questionText: q.questionText, options: q.options, correctAnswer: q.correctAnswer }));

    if (!questions.length) return showError('create-quiz-error', 'Please select at least 1 question.');

    const payload = {
        title: $('create-quiz-title').value.trim(),
        subject: state.currentUser.subject,
        units,
        teacherId: state.currentUser.id,
        teacherName: state.currentUser.name,
        targetSection: $('create-quiz-section').value,
        openTime: $('create-quiz-open').value,
        closeTime: $('create-quiz-close').value,
        durationMinutes: parseInt($('create-quiz-duration').value, 10) || 10,
        questions
    };

    try {
        await api('/api/teacher/quizzes', { method: 'POST', body: JSON.stringify(payload) });
        alert(`Quiz published successfully for Section ${payload.targetSection}!`);
        $('form-create-quiz').reset();
        switchTeacherTab('tab-teacher-quizzes');
        loadTeacherDashboard();
    } catch (err) {
        showError('create-quiz-error', err.message);
    }
}

function showError(id, msg) {
    $(id).textContent = msg;
    $(id).classList.remove('hidden');
}

// RESULTS
async function loadTeacherResults(filterQuizId = '') {
    try {
        let url = `/api/teacher/results?teacherId=${state.currentUser.id}`;
        if (filterQuizId) url += `&quizId=${filterQuizId}`;
        const data = await api(url);

        if ($('filter-results-quiz').options.length <= 1) {
            state.teacher.quizzes.forEach(q => {
                const opt = document.createElement('option');
                opt.value = q.id;
                opt.textContent = `${q.title} (Sec ${q.target_section})`;
                $('filter-results-quiz').appendChild(opt);
            });
        }

        const subs = data.submissions || [];
        if (!subs.length) {
            $('teacher-results-tbody').innerHTML = `<tr><td colspan="7" class="text-center text-muted">No submissions recorded yet.</td></tr>`;
            return;
        }

        $('teacher-results-tbody').innerHTML = subs.map((s, i) => {
            const pct = Math.round((s.score / s.total_questions) * 100);
            const badge = pct >= 80 ? 'badge-success' : pct >= 50 ? 'badge-warning' : 'badge-danger';
            return `
                <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHtml(s.student_name)}</strong></td>
                    <td><span class="badge badge-accent">Section ${escapeHtml(s.section)}</span></td>
                    <td>${escapeHtml(s.quiz_title)}</td>
                    <td><strong>${s.score} / ${s.total_questions}</strong></td>
                    <td><span class="badge ${badge}">${pct}%</span></td>
                    <td>${new Date(s.submitted_at).toLocaleString()}</td>
                </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
    }
}

// STUDENT DASHBOARD
function switchStudentTab(tabId) {
    document.querySelectorAll('[data-student-tab]').forEach(b => b.classList.toggle('active', b.dataset.studentTab === tabId));
    $('tab-student-available').classList.toggle('active', tabId === 'tab-student-available');
    $('tab-student-available').classList.toggle('hidden', tabId !== 'tab-student-available');
    $('tab-student-completed').classList.toggle('active', tabId === 'tab-student-completed');
    $('tab-student-completed').classList.toggle('hidden', tabId !== 'tab-student-completed');
}

async function loadStudentDashboard() {
    try {
        const student = state.currentUser;
        $('student-welcome-name').textContent = `Welcome, ${student.name}`;
        $('student-section-tag').textContent = `Section ${student.section}`;

        const data = await api(`/api/student/dashboard?studentId=${student.id}`);
        state.student.quizzes = data.quizzes;

        const availableQuizzes = data.quizzes.filter(q => q.status !== 'Submitted');
        const completedQuizzes = data.quizzes.filter(q => q.status === 'Submitted');

        $('student-stat-total').textContent = data.quizzes.length;
        $('student-stat-open').textContent = data.quizzes.filter(q => q.status === 'Open').length;
        $('student-stat-submitted').textContent = completedQuizzes.length;

        $('count-available-quizzes').textContent = availableQuizzes.length;
        $('count-completed-quizzes').textContent = completedQuizzes.length;

        renderStudentQuizzesGrid(availableQuizzes);
        renderStudentCompletedGrid(completedQuizzes);
    } catch (err) {
        alert('Error loading student dashboard: ' + err.message);
    }
}

function renderStudentQuizzesGrid(quizzes) {
    if (!quizzes.length) {
        $('student-quizzes-grid').innerHTML = `
            <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1;">
                <p style="font-size: 1.15rem; margin-bottom: 0.5rem;">No active or upcoming quizzes available.</p>
                <p class="text-sm">Check back later when your teachers schedule new tests.</p>
            </div>`;
        return;
    }

    $('student-quizzes-grid').innerHTML = quizzes.map(q => {
        const units = Array.isArray(q.units) ? q.units : [];
        const unitsHtml = units.map(u => `<span class="badge badge-outline">${escapeHtml(u)}</span>`).join(' ');

        let statusBadge = '', actionButton = '';
        if (q.status === 'Open') {
            statusBadge = `<span class="badge badge-success">Open Now</span>`;
            actionButton = `<button class="btn btn-primary btn-block" onclick="startQuiz(${q.id})">Start Test</button>`;
        } else if (q.status === 'Upcoming') {
            statusBadge = `<span class="badge badge-warning">Upcoming</span>`;
            actionButton = `<button class="btn btn-secondary btn-block" disabled>Opens: ${new Date(q.openTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</button>`;
        } else {
            statusBadge = `<span class="badge badge-danger">Expired</span>`;
            actionButton = `<button class="btn btn-secondary btn-block" disabled>Deadline Passed</button>`;
        }

        return `
            <div class="quiz-card">
                <div>
                    <div class="quiz-card-header"><span class="badge badge-primary">${escapeHtml(q.subject)}</span>${statusBadge}</div>
                    <h4 class="quiz-card-title">${escapeHtml(q.title)}</h4>
                    <div class="quiz-units-badges">${unitsHtml}</div>
                    <div class="quiz-meta-info">
                        <div><strong>Teacher:</strong> ${escapeHtml(q.teacherName)}</div>
                        <div><strong>Deadline:</strong> ${new Date(q.closeTime).toLocaleString()}</div>
                        <div><strong>Duration:</strong> ${q.durationMinutes} mins | <strong>Questions:</strong> ${q.questionCount}</div>
                    </div>
                </div>
                <div class="mt-3 pt-3" style="border-top: 1px solid var(--border-color);">${actionButton}</div>
            </div>`;
    }).join('');
}

function renderStudentCompletedGrid(quizzes) {
    if (!quizzes.length) {
        $('student-completed-grid').innerHTML = `
            <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1;">
                <p style="font-size: 1.15rem; margin-bottom: 0.5rem;">No completed exams yet.</p>
                <p class="text-sm">When you submit an exam, your score and detailed answer review will be available here.</p>
            </div>`;
        return;
    }

    $('student-completed-grid').innerHTML = quizzes.map(q => {
        const units = Array.isArray(q.units) ? q.units : [];
        const unitsHtml = units.map(u => `<span class="badge badge-outline">${escapeHtml(u)}</span>`).join(' ');
        const pct = q.submission ? q.submission.percentage : 0;
        const badgeClass = pct >= 80 ? 'badge-success' : pct >= 50 ? 'badge-warning' : 'badge-danger';

        return `
            <div class="quiz-card">
                <div>
                    <div class="quiz-card-header">
                        <span class="badge badge-primary">${escapeHtml(q.subject)}</span>
                        <span class="badge ${badgeClass}">Score: ${q.submission.score}/${q.submission.totalQuestions} (${pct}%)</span>
                    </div>
                    <h4 class="quiz-card-title">${escapeHtml(q.title)}</h4>
                    <div class="quiz-units-badges">${unitsHtml}</div>
                    <div class="quiz-meta-info">
                        <div><strong>Teacher:</strong> ${escapeHtml(q.teacherName)}</div>
                        <div><strong>Submitted:</strong> ${new Date(q.submission.submittedAt).toLocaleString()}</div>
                        <div><strong>Questions:</strong> ${q.submission.totalQuestions}</div>
                    </div>
                </div>
                <div class="mt-3 pt-3" style="border-top: 1px solid var(--border-color);">
                    <button class="btn btn-primary btn-block" onclick="openQuizReview(${q.id})">View Answer Review</button>
                </div>
            </div>`;
    }).join('');
}

// QUIZ TAKING
async function startQuiz(quizId) {
    try {
        const data = await api(`/api/quizzes/${quizId}/take?studentId=${state.currentUser.id}`);
        state.student.activeQuiz = data.quiz;
        state.student.quizQuestions = data.questions;
        state.student.currentQuestionIndex = 0;
        state.student.userAnswers = {};

        $('take-quiz-title').textContent = data.quiz.title;
        $('take-quiz-subject').textContent = data.quiz.subject;
        $('take-quiz-teacher').textContent = `Teacher: ${data.quiz.teacherName}`;

        state.student.secondsRemaining = (data.quiz.durationMinutes || 10) * 60;
        startCountdownTimer();
        showView('takeQuiz');
        renderActiveQuestion();
    } catch (err) {
        alert(err.message);
    }
}

function startCountdownTimer() {
    if (state.student.timerInterval) clearInterval(state.student.timerInterval);
    updateTimerDisplay();
    state.student.timerInterval = setInterval(() => {
        state.student.secondsRemaining--;
        updateTimerDisplay();
        if (state.student.secondsRemaining <= 0) {
            clearInterval(state.student.timerInterval);
            alert('⏰ Time has expired! Your quiz is being submitted automatically.');
            submitQuiz();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const m = Math.floor(state.student.secondsRemaining / 60), s = state.student.secondsRemaining % 60;
    $('quiz-timer-display').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderActiveQuestion() {
    const questions = state.student.quizQuestions, i = state.student.currentQuestionIndex, q = questions[i];
    $('quiz-question-counter').textContent = `Question ${i + 1} of ${questions.length}`;
    $('quiz-unit-badge').textContent = q.unit;
    $('quiz-progress-fill').style.width = `${((i + 1) / questions.length) * 100}%`;
    $('quiz-question-text').textContent = `${i + 1}. ${q.questionText}`;

    const selected = state.student.userAnswers[q.id];
    $('quiz-options-container').innerHTML = q.options.map((opt, optIdx) => `
        <div class="option-item ${selected === optIdx ? 'selected' : ''}" onclick="selectAnswer(${q.id}, ${optIdx})">
            <span class="option-letter">${String.fromCharCode(65 + optIdx)}</span>
            <span>${escapeHtml(opt)}</span>
        </div>`).join('');

    $('btn-quiz-prev').disabled = i === 0;
    const isLast = i === questions.length - 1;
    $('btn-quiz-next').classList.toggle('hidden', isLast);
    $('btn-quiz-submit').classList.toggle('hidden', !isLast);
}

window.selectAnswer = function(questionId, optionIndex) {
    state.student.userAnswers[questionId] = optionIndex;
    renderActiveQuestion();
};

function navigateQuiz(direction) {
    const nextIdx = state.student.currentQuestionIndex + direction;
    if (nextIdx >= 0 && nextIdx < state.student.quizQuestions.length) {
        state.student.currentQuestionIndex = nextIdx;
        renderActiveQuestion();
    }
}

async function submitQuiz() {
    if (state.student.timerInterval) clearInterval(state.student.timerInterval);
    try {
        const data = await api(`/api/quizzes/${state.student.activeQuiz.id}/submit`, {
            method: 'POST',
            body: JSON.stringify({ studentId: state.currentUser.id, answers: state.student.userAnswers })
        });
        showImmediateCompletionModal(data);
    } catch (err) {
        alert('Error submitting quiz: ' + err.message);
    }
}

function showImmediateCompletionModal(data) {
    $('result-modal-title').textContent = 'Quiz Submitted Successfully';
    $('result-score-badge').textContent = `${data.percentage}%`;
    $('result-score-detail').textContent = `You scored ${data.score} out of ${data.totalQuestions} questions correctly.`;
    $('result-performance-text').textContent = data.percentage >= 80 ? 'Outstanding Performance' : data.percentage >= 50 ? 'Good Effort - Keep Learning' : 'Review the concepts and practice again';
    $('result-immediate-note').classList.remove('hidden');
    $('result-breakdown-container').classList.add('hidden');
    $('btn-result-close').textContent = 'Back to Dashboard';
    $('modal-result').classList.remove('hidden');
}

window.openQuizReview = async function(quizId) {
    try {
        const data = await api(`/api/quizzes/${quizId}/review?studentId=${state.currentUser.id}`);
        $('result-modal-title').textContent = `Exam Review - ${escapeHtml(data.title || 'Quiz')}`;
        $('result-score-badge').textContent = `${data.percentage}%`;
        $('result-score-detail').textContent = `You scored ${data.score} out of ${data.totalQuestions} questions correctly.`;
        $('result-performance-text').textContent = data.percentage >= 80 ? 'Outstanding Performance' : data.percentage >= 50 ? 'Good Effort - Keep Learning' : 'Review the concepts and practice again';
        $('result-immediate-note').classList.add('hidden');
        $('result-breakdown-container').classList.remove('hidden');

        $('result-breakdown-list').innerHTML = data.review.map((item, idx) => {
            const ok = item.isCorrect;
            const sel = item.selectedAnswer !== null && item.selectedAnswer !== undefined ? item.options[item.selectedAnswer] : 'No answer selected';
            return `
                <div class="review-item ${ok ? 'correct' : 'wrong'}">
                    <div class="d-flex justify-between align-center mb-1">
                        <span class="badge badge-outline" style="font-size: 0.7rem;">${escapeHtml(item.unit)}</span>
                        <span class="review-badge-status ${ok ? 'correct' : 'wrong'}">${ok ? 'Correct (+1)' : 'Incorrect (0)'}</span>
                    </div>
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">${idx + 1}. ${escapeHtml(item.questionText)}</div>
                    <div class="text-sm">
                        <div><strong>Your Answer:</strong> <span style="color: ${ok ? 'var(--success)' : 'var(--danger)'};">${escapeHtml(sel)}</span></div>
                        ${!ok ? `<div class="mt-1"><strong>Correct Answer:</strong> <span style="color: var(--success); font-weight: 600;">${escapeHtml(item.options[item.correctAnswer])}</span></div>` : ''}
                    </div>
                </div>`;
        }).join('');

        $('btn-result-close').textContent = 'Close Review';
        $('modal-result').classList.remove('hidden');
    } catch (err) {
        alert('Could not load review: ' + err.message);
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTimeLocal(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
