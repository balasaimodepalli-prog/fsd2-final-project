CREATE DATABASE IF NOT EXISTS college_quiz_db;
USE college_quiz_db;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    role ENUM('teacher', 'student') NOT NULL,
    name VARCHAR(100) NOT NULL,
    subject VARCHAR(100) NULL,
    sections VARCHAR(100) NULL,
    section VARCHAR(10) NULL
);

CREATE TABLE IF NOT EXISTS question_bank (
    id INT AUTO_INCREMENT PRIMARY KEY,
    subject VARCHAR(100) NOT NULL,
    unit VARCHAR(150) NOT NULL,
    question_text TEXT NOT NULL,
    options_json JSON NOT NULL,
    correct_answer INT NOT NULL
);

CREATE TABLE IF NOT EXISTS quizzes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    units_json JSON NOT NULL,
    teacher_id VARCHAR(50) NOT NULL,
    teacher_name VARCHAR(100) NOT NULL,
    target_section VARCHAR(10) NOT NULL,
    open_time DATETIME NOT NULL,
    close_time DATETIME NOT NULL,
    duration_minutes INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    quiz_id INT NOT NULL,
    unit VARCHAR(150) NOT NULL,
    question_text TEXT NOT NULL,
    options_json JSON NOT NULL,
    correct_answer INT NOT NULL,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    quiz_id INT NOT NULL,
    student_id VARCHAR(50) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    section VARCHAR(10) NOT NULL,
    score INT NOT NULL,
    total_questions INT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    answers_json JSON NOT NULL,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);
