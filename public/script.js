let currentUser = null;
let currentQuizId = null;
let questionCount = 0;

// Element Selectors
const views = ['view-login', 'view-student', 'view-exam', 'view-student-result', 'view-admin'];

function showView(viewId) {
  views.forEach(v => document.getElementById(v).classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
}

// Authentication
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) throw new Error((await res.json()).error);

    currentUser = await res.json();
    document.getElementById('user-badge').classList.remove('hidden');
    document.getElementById('user-display').innerText = `${currentUser.username} (${currentUser.role})`;

    if (currentUser.role === 'admin') {
      showView('view-admin');
      initAdminBuilder();
      loadAdminResults();
    } else {
      showView('view-student');
      loadStudentQuizzes();
    }
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  location.reload();
});

// Student Dashboard: Fetch & Render Quizzes
async function loadStudentQuizzes() {
  const res = await fetch('/api/quizzes');
  const quizzes = await res.json();

  const container = document.getElementById('quiz-list');
  container.innerHTML = quizzes.map(q => `
    <div class="quiz-card">
      <h4>${q.title}</h4>
      <p class="subtitle">By ${q.created_by}</p>
      <button onclick="startExam(${q.id})" class="btn btn-primary" style="margin-top:10px;">Start Test</button>
    </div>
  `).join('');
}

// Student: Load and Render Exam
async function startExam(quizId) {
  currentQuizId = quizId;
  const res = await fetch(`/api/quiz/${quizId}`);
  const data = await res.json();

  document.getElementById('exam-title').innerText = data.quiz.title;
  const container = document.getElementById('exam-questions');

  container.innerHTML = data.questions.map((q, idx) => `
    <div class="review-item">
      <p><strong>Q${idx + 1}. ${q.question}</strong></p>
      <div class="form-group" style="margin-top: 8px;">
        <label><input type="radio" name="q_${q.id}" value="A" required> A) ${q.option_a}</label>
        <label><input type="radio" name="q_${q.id}" value="B"> B) ${q.option_b}</label>
        <label><input type="radio" name="q_${q.id}" value="C"> C) ${q.option_c}</label>
        <label><input type="radio" name="q_${q.id}" value="D"> D) ${q.option_d}</label>
      </div>
    </div>
  `).join('');

  showView('view-exam');
}

// Student: Submit Answers & View Detailed Results
document.getElementById('exam-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const answers = {};

  for (let [key, val] of formData.entries()) {
    answers[key.replace('q_', '')] = val;
  }

  const res = await fetch(`/api/quiz/${currentQuizId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentName: currentUser.username, answers })
  });

  const result = await res.json();
  renderStudentFeedback(result);
});

function renderStudentFeedback(result) {
  document.getElementById('summary-card').innerHTML = `
    <p>Final Score: <strong>${result.score} / ${result.total}</strong> (${result.percentage}%)</p>
    <p>Status: <strong style="color: ${result.passed ? 'green' : 'red'};">${result.passed ? 'PASSED' : 'FAILED'}</strong></p>
  `;

  document.getElementById('questions-review').innerHTML = result.breakdown.map((q, idx) => `
    <div class="review-item ${q.isCorrect ? 'correct' : 'incorrect'}">
      <p><strong>Q${idx + 1}. ${q.questionText}</strong></p>
      <p>Your Answer: <strong>${q.selectedOption}) ${q.options[q.selectedOption] || 'None'}</strong> - ${q.isCorrect ? '✓ Correct' : '✗ Incorrect'}</p>
      ${!q.isCorrect ? `<p style="color:#2e7d32;">Correct Answer: <strong>${q.correctOption})${q.options[q.correctOption]}</strong></p>` : ''}
    </div>
  `).join('');

  showView('view-student-result');
}

// Admin Panel Logic
function switchAdminTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (tab === 'create') {
    document.getElementById('admin-tab-create').classList.remove('hidden');
    document.getElementById('admin-tab-results').classList.add('hidden');
    event.target.classList.add('active');
  } else {
    document.getElementById('admin-tab-create').classList.add('hidden');
    document.getElementById('admin-tab-results').classList.remove('hidden');
    event.target.classList.add('active');
    loadAdminResults();
  }
}

function initAdminBuilder() {
  document.getElementById('admin-questions-builder').innerHTML = '';
  questionCount = 0;
  addQuestionField();
}

document.getElementById('add-question-btn').addEventListener('click', addQuestionField);

function addQuestionField() {
  questionCount++;
  const div = document.createElement('div');
  div.className = 'q-builder-box';
  div.innerHTML = `
    <h5>Question ${questionCount}</h5>
    <div class="form-group"><input type="text" class="q-text" placeholder="Question Text" required></div>
    <div class="grid-list">
      <input type="text" class="q-opt-a" placeholder="Option A" required>
      <input type="text" class="q-opt-b" placeholder="Option B" required>
      <input type="text" class="q-opt-c" placeholder="Option C" required>
      <input type="text" class="q-opt-d" placeholder="Option D" required>
    </div>
    <div class="form-group" style="margin-top:8px;">
      <label>Correct Answer:</label>
      <select class="q-correct">
        <option value="A">Option A</option>
        <option value="B">Option B</option>
        <option value="C">Option C</option>
        <option value="D">Option D</option>
      </select>
    </div>
  `;
  document.getElementById('admin-questions-builder').appendChild(div);
}

// Admin: Submit New Quiz
document.getElementById('create-quiz-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('quiz-title-input').value;
  const qBoxes = document.querySelectorAll('.q-builder-box');

  const questions = Array.from(qBoxes).map(box => ({
    question: box.querySelector('.q-text').value,
    option_a: box.querySelector('.q-opt-a').value,
    option_b: box.querySelector('.q-opt-b').value,
    option_c: box.querySelector('.q-opt-c').value,
    option_d: box.querySelector('.q-opt-d').value,
    correct_option: box.querySelector('.q-correct').value
  }));

  const res = await fetch('/api/admin/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, createdBy: currentUser.username, questions })
  });

  if (res.ok) {
    alert("Quiz created successfully!");
    document.getElementById('create-quiz-form').reset();
    initAdminBuilder();
  }
});

// Admin: Fetch All Student Results
async function loadAdminResults() {
  const res = await fetch('/api/admin/results');
  const results = await res.json();

  document.getElementById('results-table-body').innerHTML = results.map(r => `
    <tr>
      <td><strong>${r.student_name}</strong></td>
      <td>${r.quiz_title}</td>
      <td>${r.score} / ${r.total}</td>
      <td>${r.percentage}%</td>
      <td>${new Date(r.submission_time).toLocaleString()}</td>
    </tr>
  `).join('');
}