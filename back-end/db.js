const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'college_quiz_db'
};

let pool = null;

async function initDB() {
    try {
        const conn = await mysql.createConnection({
            host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password
        });
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
        await conn.end();

        pool = mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 10, queueLimit: 0 });

        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(50) PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(100) NOT NULL,
            role ENUM('teacher', 'student') NOT NULL, name VARCHAR(100) NOT NULL, subject VARCHAR(100) NULL,
            sections VARCHAR(100) NULL, section VARCHAR(10) NULL
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS question_bank (
            id INT AUTO_INCREMENT PRIMARY KEY, subject VARCHAR(100) NOT NULL, unit VARCHAR(150) NOT NULL,
            question_text TEXT NOT NULL, options_json JSON NOT NULL, correct_answer INT NOT NULL
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS quizzes (
            id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(200) NOT NULL, subject VARCHAR(100) NOT NULL,
            units_json JSON NOT NULL, teacher_id VARCHAR(50) NOT NULL, teacher_name VARCHAR(100) NOT NULL,
            target_section VARCHAR(10) NOT NULL, open_time DATETIME NOT NULL, close_time DATETIME NOT NULL,
            duration_minutes INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS quiz_questions (
            id INT AUTO_INCREMENT PRIMARY KEY, quiz_id INT NOT NULL, unit VARCHAR(150) NOT NULL,
            question_text TEXT NOT NULL, options_json JSON NOT NULL, correct_answer INT NOT NULL,
            FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS submissions (
            id INT AUTO_INCREMENT PRIMARY KEY, quiz_id INT NOT NULL, student_id VARCHAR(50) NOT NULL,
            student_name VARCHAR(100) NOT NULL, section VARCHAR(10) NOT NULL, score INT NOT NULL,
            total_questions INT NOT NULL, submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            answers_json JSON NOT NULL, FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        console.log(`[Database] Connected to '${dbConfig.database}'`);
        return true;
    } catch (err) {
        console.error('[Database Error]', err.message);
        return false;
    }
}

module.exports = { initDB, getPool: () => pool };
