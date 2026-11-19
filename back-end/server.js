const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, getPool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../front-end')));

const parseJson = (val, def = []) => {
    if (typeof val === 'object' && val !== null) return val;
    try { return JSON.parse(val || '[]'); } catch { return def; }
};

// 1. AUTHENTICATION
app.post('/api/auth/login', async (req, res) => {
    try {
        const pool = getPool();
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

        const [rows] = await pool.query(
            'SELECT id, username, role, name, subject, sections, section FROM users WHERE username = ? AND password = ?',
            [username.trim(), password.trim()]
        );
        if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });

        const user = rows[0];
        if (user.sections) user.sections = parseJson(user.sections);
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

app.get('/api/auth/demo-users', async (req, res) => {
    try {
        const [users] = await getPool().query('SELECT id, username, role, name, subject, sections, section FROM users');
        res.json({ users: users.map(u => ({ ...u, sections: parseJson(u.sections) })) });
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch demo users' });
    }
});

// 2. TEACHER APIS
app.get('/api/teacher/dashboard', async (req, res) => {
    try {
        const { teacherId } = req.query;
        if (!teacherId) return res.status(400).json({ error: 'teacherId query parameter is required' });

        const pool = getPool();
        const [tRows] = await pool.query('SELECT * FROM users WHERE id = ? AND role = "teacher"', [teacherId]);
        if (!tRows.length) return res.status(404).json({ error: 'Teacher not found' });

        const teacher = tRows[0];
        const assignedSections = parseJson(teacher.sections);

        const [quizzes] = await pool.query(`
            SELECT q.*, COUNT(DISTINCT qq.id) AS question_count, COUNT(DISTINCT s.id) AS submission_count
            FROM quizzes q
            LEFT JOIN quiz_questions qq ON q.id = qq.quiz_id
            LEFT JOIN submissions s ON q.id = s.quiz_id
            WHERE q.teacher_id = ?
            GROUP BY q.id ORDER BY q.created_at DESC`, [teacherId]);

        const formattedQuizzes = quizzes.map(q => ({ ...q, units: parseJson(q.units_json) }));
        const totalSubmissions = quizzes.reduce((sum, q) => sum + Number(q.submission_count), 0);

        res.json({
            teacher: { id: teacher.id, name: teacher.name, subject: teacher.subject, sections: assignedSections },
            stats: { totalQuizzes: quizzes.length, totalSubmissions, assignedSections },
            quizzes: formattedQuizzes
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch teacher dashboard' });
    }
});

app.get('/api/teacher/question-bank', async (req, res) => {
    try {
        const { subject, units } = req.query;
        if (!subject) return res.status(400).json({ error: 'Subject is required' });

        let sql = 'SELECT id, subject, unit, question_text, options_json, correct_answer FROM question_bank WHERE subject = ?';
        const params = [subject];

        if (units) {
            const list = units.split(',').map(u => u.trim());
            sql += ` AND unit IN (${list.map(() => '?').join(',')})`;
            params.push(...list);
        }
        sql += ' ORDER BY unit, id';

        const [rows] = await getPool().query(sql, params);
        res.json({
            questions: rows.map(r => ({
                id: r.id, subject: r.subject, unit: r.unit, questionText: r.question_text,
                options: parseJson(r.options_json), correctAnswer: r.correct_answer
            }))
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch question bank' });
    }
});

app.post('/api/teacher/quizzes', async (req, res) => {
    const conn = await getPool().getConnection();
    try {
        const { title, subject, units, teacherId, teacherName, targetSection, openTime, closeTime, durationMinutes, questions } = req.body;
        if (!title || !subject || !targetSection || !openTime || !closeTime || !questions?.length) {
            return res.status(400).json({ error: 'All fields including at least 1 question are required' });
        }

        const [tRows] = await conn.query('SELECT sections FROM users WHERE id = ?', [teacherId]);
        if (!tRows.length) return res.status(403).json({ error: 'Unauthorized teacher' });
        const allowedSections = parseJson(tRows[0].sections);
        if (!allowedSections.includes(targetSection)) {
            return res.status(403).json({ error: `Authorized sections: ${allowedSections.join(', ')}` });
        }

        await conn.beginTransaction();
        const [quizRes] = await conn.query(
            `INSERT INTO quizzes (title, subject, units_json, teacher_id, teacher_name, target_section, open_time, close_time, duration_minutes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, subject, JSON.stringify(units || []), teacherId, teacherName, targetSection, new Date(openTime), new Date(closeTime), parseInt(durationMinutes, 10) || 10]
        );

        for (const q of questions) {
            await conn.query(
                `INSERT INTO quiz_questions (quiz_id, unit, question_text, options_json, correct_answer) VALUES (?, ?, ?, ?, ?)`,
                [quizRes.insertId, q.unit || 'General', q.questionText || q.question_text, JSON.stringify(q.options), parseInt(q.correctAnswer ?? q.correct_answer, 10)]
            );
        }

        await conn.commit();
        res.json({ success: true, message: 'Quiz published successfully!', quizId: quizRes.insertId });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: 'Failed to create quiz: ' + err.message });
    } finally {
        conn.release();
    }
});

app.get('/api/teacher/results', async (req, res) => {
    try {
        const { teacherId, quizId } = req.query;
        let sql = `SELECT s.*, q.title as quiz_title, q.subject, q.target_section
                   FROM submissions s JOIN quizzes q ON s.quiz_id = q.id WHERE q.teacher_id = ?`;
        const params = [teacherId];
        if (quizId) { sql += ' AND q.id = ?'; params.push(quizId); }
        sql += ' ORDER BY s.submitted_at DESC';

        const [rows] = await getPool().query(sql, params);
        res.json({ submissions: rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch results' });
    }
});

// 3. STUDENT APIS
app.get('/api/student/dashboard', async (req, res) => {
    try {
        const { studentId } = req.query;
        if (!studentId) return res.status(400).json({ error: 'studentId query parameter is required' });

        const pool = getPool();
        const [sRows] = await pool.query('SELECT * FROM users WHERE id = ? AND role = "student"', [studentId]);
        if (!sRows.length) return res.status(404).json({ error: 'Student not found' });
        const student = sRows[0];

        const [quizzes] = await pool.query(`
            SELECT q.*, COUNT(DISTINCT qq.id) AS question_count,
                   s.id AS submission_id, s.score AS submission_score, s.total_questions AS submission_total,
                   s.submitted_at AS student_submitted_at
            FROM quizzes q
            LEFT JOIN quiz_questions qq ON q.id = qq.quiz_id
            LEFT JOIN submissions s ON q.id = s.quiz_id AND s.student_id = ?
            WHERE q.target_section = ? GROUP BY q.id, s.id ORDER BY q.created_at DESC`,
            [studentId, student.section]
        );

        const now = new Date();
        const formatted = quizzes.map(q => {
            const open = new Date(q.open_time), close = new Date(q.close_time);
            let status = 'Open', canAttempt = false;

            if (q.submission_id) status = 'Submitted';
            else if (now < open) status = 'Upcoming';
            else if (now > close) status = 'Expired';
            else { status = 'Open'; canAttempt = true; }

            return {
                id: q.id, title: q.title, subject: q.subject, units: parseJson(q.units_json),
                teacherName: q.teacher_name, targetSection: q.target_section,
                openTime: q.open_time, closeTime: q.close_time, durationMinutes: q.duration_minutes,
                questionCount: q.question_count, status, canAttempt,
                submission: q.submission_id ? {
                    id: q.submission_id, score: q.submission_score, totalQuestions: q.submission_total,
                    percentage: Math.round((q.submission_score / q.submission_total) * 100),
                    submittedAt: q.student_submitted_at
                } : null
            };
        });

        res.json({ student: { id: student.id, name: student.name, section: student.section }, quizzes: formatted });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch student dashboard' });
    }
});

app.get('/api/quizzes/:id/take', async (req, res) => {
    try {
        const pool = getPool();
        const { id } = req.params;
        const { studentId } = req.query;

        const [qRows] = await pool.query('SELECT * FROM quizzes WHERE id = ?', [id]);
        if (!qRows.length) return res.status(404).json({ error: 'Quiz not found' });
        const quiz = qRows[0];

        if (studentId) {
            const [sub] = await pool.query('SELECT id FROM submissions WHERE quiz_id = ? AND student_id = ?', [id, studentId]);
            if (sub.length) return res.status(400).json({ error: 'You have already submitted this quiz' });
        }

        const now = new Date();
        if (now < new Date(quiz.open_time)) return res.status(403).json({ error: 'This quiz has not opened yet' });
        if (now > new Date(quiz.close_time)) return res.status(403).json({ error: 'This quiz has expired and is closed' });

        const [questions] = await pool.query('SELECT id, unit, question_text, options_json FROM quiz_questions WHERE quiz_id = ? ORDER BY id', [id]);
        res.json({
            quiz: { id: quiz.id, title: quiz.title, subject: quiz.subject, units: parseJson(quiz.units_json), teacherName: quiz.teacher_name, durationMinutes: quiz.duration_minutes },
            questions: questions.map(q => ({ id: q.id, unit: q.unit, questionText: q.question_text, options: parseJson(q.options_json) }))
        });
    } catch (err) {
        res.status(500).json({ error: 'Could not load quiz questions' });
    }
});

app.get('/api/quizzes/:id/review', async (req, res) => {
    try {
        const pool = getPool();
        const { id } = req.params;
        const { studentId } = req.query;
        if (!studentId) return res.status(400).json({ error: 'studentId is required' });

        const [subRows] = await pool.query('SELECT * FROM submissions WHERE quiz_id = ? AND student_id = ?', [id, studentId]);
        if (!subRows.length) return res.status(404).json({ error: 'No submission found for this quiz' });
        const sub = subRows[0];

        const [quizRows] = await pool.query('SELECT title, subject FROM quizzes WHERE id = ?', [id]);
        const quiz = quizRows[0] || {};

        const [qRows] = await pool.query('SELECT id, unit, question_text, options_json, correct_answer FROM quiz_questions WHERE quiz_id = ? ORDER BY id', [id]);
        const answers = parseJson(sub.answers_json, {});
        const review = qRows.map(q => {
            const options = parseJson(q.options_json);
            const selected = answers[q.id] !== undefined ? parseInt(answers[q.id], 10) : null;
            return {
                questionId: q.id, unit: q.unit, questionText: q.question_text, options,
                selectedAnswer: selected, correctAnswer: q.correct_answer, isCorrect: selected === q.correct_answer
            };
        });

        res.json({
            title: quiz.title, subject: quiz.subject, score: sub.score, totalQuestions: sub.total_questions,
            percentage: Math.round((sub.score / sub.total_questions) * 100), submittedAt: sub.submitted_at, review
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch quiz review' });
    }
});

app.post('/api/quizzes/:id/submit', async (req, res) => {
    try {
        const pool = getPool();
        const { id } = req.params;
        const { studentId, answers } = req.body;
        if (!studentId || !answers) return res.status(400).json({ error: 'studentId and answers are required' });

        const [sRows] = await pool.query('SELECT name, section FROM users WHERE id = ?', [studentId]);
        if (!sRows.length) return res.status(404).json({ error: 'Student not found' });

        const [existing] = await pool.query('SELECT id FROM submissions WHERE quiz_id = ? AND student_id = ?', [id, studentId]);
        if (existing.length) return res.status(400).json({ error: 'You have already submitted this quiz' });

        const [qRows] = await pool.query('SELECT id, correct_answer FROM quiz_questions WHERE quiz_id = ? ORDER BY id', [id]);
        let score = 0;
        for (const q of qRows) {
            const selected = answers[q.id] !== undefined ? parseInt(answers[q.id], 10) : null;
            if (selected === q.correct_answer) score++;
        }

        await pool.query(
            `INSERT INTO submissions (quiz_id, student_id, student_name, section, score, total_questions, answers_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, studentId, sRows[0].name, sRows[0].section, score, qRows.length, JSON.stringify(answers)]
        );

        res.json({ success: true, score, totalQuestions: qRows.length, percentage: Math.round((score / qRows.length) * 100) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to evaluate quiz submission' });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../front-end/index.html')));

async function startServer() {
    await initDB();
    app.listen(PORT, () => console.log(`College Quiz Portal running at: http://localhost:${PORT}`));
}

startServer();
