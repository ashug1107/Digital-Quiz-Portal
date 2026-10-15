const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './database.sqlite';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

// Helper function to persist database to file
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
}

// Initialize sql.js Async Database
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const filebuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  // Schema creation
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'student')) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      quiz_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      percentage REAL NOT NULL,
      submission_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default data if empty
  const res = db.exec("SELECT count(*) as count FROM users");
  const userCount = res.length > 0 ? res[0].values[0][0] : 0;

  if (userCount === 0) {
    db.run("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')");
    db.run("INSERT INTO users (username, password, role) VALUES ('student1', 'student123', 'student')");

    db.run("INSERT INTO quizzes (title, created_by) VALUES ('Software Testing & Quality Assurance Mid-Term', 'admin')");
    
    db.run(`
      INSERT INTO questions (quiz_id, question, option_a, option_b, option_c, option_d, correct_option)
      VALUES (1, 'Which testing level verifies individual software modules?', 'Integration Testing', 'Unit Testing', 'System Testing', 'Acceptance Testing', 'B')
    `);
    db.run(`
      INSERT INTO questions (quiz_id, question, option_a, option_b, option_c, option_d, correct_option)
      VALUES (1, 'What is Boundary Value Analysis (BVA)?', 'White-box technique', 'Black-box technique for extreme inputs', 'Performance test', 'UML modeling tool', 'B')
    `);

    saveDatabase();
    console.log("Database initialized with seed data.");
  }
}

// Helper to convert sql.js result formats into array of plain objects
function queryObjects(sqlQuery, params = []) {
  const stmt = db.prepare(sqlQuery);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// API: Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = queryObjects("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);

  if (users.length === 0) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const user = users[0];
  res.json({ id: user.id, username: user.username, role: user.role });
});

// API: List Quizzes
app.get('/api/quizzes', (req, res) => {
  const quizzes = queryObjects("SELECT * FROM quizzes");
  res.json(quizzes);
});

// API: Get Single Quiz Questions
app.get('/api/quiz/:id', (req, res) => {
  const quizzes = queryObjects("SELECT * FROM quizzes WHERE id = ?", [req.params.id]);
  if (quizzes.length === 0) return res.status(404).json({ error: "Quiz not found" });

  const questions = queryObjects(`
    SELECT id, question, option_a, option_b, option_c, option_d 
    FROM questions WHERE quiz_id = ?
  `, [req.params.id]);

  res.json({ quiz: quizzes[0], questions });
});

// API: Submit Quiz
app.post('/api/quiz/:id/submit', (req, res) => {
  const quizId = req.params.id;
  const { studentName, answers } = req.body;

  const questions = queryObjects("SELECT * FROM questions WHERE quiz_id = ?", [quizId]);
  if (questions.length === 0) return res.status(400).json({ error: "Invalid Quiz" });

  let score = 0;
  const breakdown = [];

  questions.forEach(q => {
    const selected = answers ? answers[q.id] : null;
    const isCorrect = selected === q.correct_option;
    if (isCorrect) score++;

    breakdown.push({
      questionId: q.id,
      questionText: q.question,
      selectedOption: selected || "Not Answered",
      correctOption: q.correct_option,
      isCorrect,
      options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d }
    });
  });

  const percentage = parseFloat(((score / questions.length) * 100).toFixed(1));

  db.run(`
    INSERT INTO results (student_name, quiz_id, score, total, percentage)
    VALUES (?, ?, ?, ?, ?)
  `, [studentName, quizId, score, questions.length, percentage]);

  saveDatabase();

  res.json({
    score,
    total: questions.length,
    percentage,
    passed: percentage >= 50,
    breakdown
  });
});

// API: Admin Create Quiz
app.post('/api/admin/quiz', (req, res) => {
  const { title, createdBy, questions } = req.body;

  if (!title || !questions || questions.length === 0) {
    return res.status(400).json({ error: "Title and questions required." });
  }

  db.run("INSERT INTO quizzes (title, created_by) VALUES (?, ?)", [title, createdBy]);
  const quizRes = queryObjects("SELECT last_insert_rowid() as id");
  const quizId = quizRes[0].id;

  for (const q of questions) {
    db.run(`
      INSERT INTO questions (quiz_id, question, option_a, option_b, option_c, option_d, correct_option)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [quizId, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]);
  }

  saveDatabase();
  res.json({ success: true, message: "Quiz published successfully!" });
});

// API: Admin Results
app.get('/api/admin/results', (req, res) => {
  const results = queryObjects(`
    SELECT r.id, r.student_name, q.title as quiz_title, r.score, r.total, r.percentage, r.submission_time
    FROM results r
    JOIN quizzes q ON r.quiz_id = q.id
    ORDER BY r.submission_time DESC
  `);
  res.json(results);
});

// Initialize DB and start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("Failed to start database:", err);
});