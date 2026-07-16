const params   = new URLSearchParams(window.location.search);
const topicId  = params.get('topicId');
const grade    = params.get('grade')   || '7';
const subject  = params.get('subject') || 'math';
const username = sessionStorage.getItem('username');
const token    = sessionStorage.getItem('token');

let questions  = [];
let current    = 0;
let score      = 0;
let answered   = false;
let timeLeft   = 600;
let timerInterval;
let sessionId  = null;
let stepsData  = [];
let stepIndex  = 0;

const $ = id => document.getElementById(id);

async function init() {
  if (!topicId) { $('questionText').textContent = 'No topic selected.'; return; }

  const res  = await fetch('/api/test/start', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:    JSON.stringify({ topicId }),
  });
  if (res.status === 401) {   // session revoked (logged in elsewhere) or expired
    sessionStorage.clear();
    window.location.href = '/';
    return;
  }
  const data = await res.json();
  sessionId  = data.sessionId;
  questions  = data.questions;

  if (!questions.length) {
    $('questionText').textContent = 'No questions available for this topic yet.';
    return;
  }

  startTimer();
  showQuestion();

  $('nextBtn').addEventListener('click', nextQuestion);
  $('nextStepBtn').addEventListener('click', showNextStep);
  $('retryBtn').addEventListener('click', () => location.reload());
  $('backBtn').addEventListener('click', () => {
    window.location.href = `./grades/chapters.html?grade=${grade}&subject=${subject}`;
  });
  $('textSubmit').addEventListener('click', submitTextAnswer);
  $('textInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitTextAnswer(); });
}

function startTimer() {
  timerInterval = setInterval(() => {
    timeLeft--;
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    $('timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (timeLeft <= 60) $('timer').classList.add('timer--warning');
    if (timeLeft <= 0)  { clearInterval(timerInterval); finishTest(); }
  }, 1000);
}

function showQuestion() {
  const q  = questions[current];
  answered = false;

  $('progress').textContent     = `Question ${current + 1} of ${questions.length}`;
  $('progressFill').style.width = `${(current / questions.length) * 100}%`;
  $('questionText').textContent = q.question_text;
  $('feedback').textContent     = '';
  $('feedback').className       = 'feedback';
  $('nextBtn').style.display    = 'none';
  $('explanationPanel').style.display = 'none';

  if (q.question_type === 'text') {
    $('textAnswer').style.display = 'flex';
    $('answers').style.display    = 'none';
    $('textInput').value          = '';
    $('textInput').disabled       = false;
    $('textInput').style.borderColor = '';
    $('textSubmit').disabled      = false;
    $('textInput').focus();
  } else {
    $('textAnswer').style.display = 'none';
    $('answers').style.display    = 'grid';
    const container = $('answers');
    container.innerHTML = '';
    q.options.forEach(a => {
      const btn = document.createElement('button');
      btn.className       = 'answer-btn';
      btn.textContent     = a.answer_text;
      btn.dataset.id      = a.id;
      btn.addEventListener('click', () => submitMCAnswer(btn, a.id));
      container.appendChild(btn);
    });
  }
}

async function submitMCAnswer(btn, answerId) {
  if (answered) return;
  answered = true;
  document.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);

  const res  = await fetch('/api/test/answer', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId, questionIndex: current, answer: answerId }),
  });
  const data = await res.json();

  // Highlight correct option
  document.querySelectorAll('.answer-btn').forEach(b => {
    if (String(b.dataset.id) === String(data.correct_id)) {
      b.classList.add('answer-btn--correct');
    }
  });
  if (!data.correct) btn.classList.add('answer-btn--wrong');

  showFeedback(data.correct, data.explanation, data.steps);
}

async function submitTextAnswer() {
  if (answered) return;
  const value = $('textInput').value.trim();
  if (!value) return;
  answered = true;
  $('textInput').disabled  = true;
  $('textSubmit').disabled = true;

  const res  = await fetch('/api/test/answer', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId, questionIndex: current, answer: value }),
  });
  const data = await res.json();

  $('textInput').style.borderColor = data.correct ? '#4caf50' : '#e94560';

  if (!data.correct && data.correct_answer != null) {
    const hint = document.createElement('p');
    hint.className   = 'text-correct-answer';
    hint.textContent = `Correct answer: ${data.correct_answer}`;
    $('textAnswer').appendChild(hint);
  }

  showFeedback(data.correct, data.explanation, data.steps);
}

function showFeedback(isCorrect, explanation, steps) {
  if (isCorrect) {
    score++;
    $('feedback').textContent = '✓ Correct!';
    $('feedback').className   = 'feedback feedback--correct';
  } else {
    $('feedback').textContent = '✗ Wrong!';
    $('feedback').className   = 'feedback feedback--wrong';
    if (steps && steps.length > 1) {
      stepsData  = steps;
      stepIndex  = 0;
      $('stepProgress').textContent        = `Step 1 of ${steps.length}`;
      $('explanationText').innerHTML       = steps[0].replace(/\n/g, '<br>');
      $('nextStepBtn').style.display       = 'inline-block';
      $('explanationPanel').style.display  = 'block';
    } else if (explanation) {
      stepsData = [];
      $('stepProgress').textContent        = '';
      $('nextStepBtn').style.display       = 'none';
      $('explanationText').innerHTML       = explanation.replace(/\n/g, '<br>');
      $('explanationPanel').style.display  = 'block';
    }
  }
  $('scoreDisplay').textContent = `Score: ${score}/${current + 1}`;
  $('nextBtn').style.display    = 'inline-block';
}

function showNextStep() {
  stepIndex++;
  if (stepIndex >= stepsData.length) return;
  $('stepProgress').textContent  = `Step ${stepIndex + 1} of ${stepsData.length}`;
  $('explanationText').innerHTML = stepsData[stepIndex].replace(/\n/g, '<br>');
  if (stepIndex >= stepsData.length - 1) $('nextStepBtn').style.display = 'none';
}

function nextQuestion() {
  // Remove any "correct answer" hints added for text questions
  const hint = document.querySelector('.text-correct-answer');
  if (hint) hint.remove();

  current++;
  if (current >= questions.length) finishTest();
  else showQuestion();
}

async function finishTest() {
  clearInterval(timerInterval);
  const elapsed = 600 - timeLeft;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;

  let rubies = 0, newBalance = 0, pct = 0, finalScore = score, streak = null;

  if (sessionId) {
    const res  = await fetch('/api/test/finish', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    rubies     = data.rubies;
    newBalance = data.newBalance;
    pct        = data.pct;
    finalScore = data.score;
    streak     = data.streak;
  }

  $('testScreen').style.display    = 'none';
  $('resultsScreen').style.display = 'flex';
  $('finalScore').textContent      = `${finalScore} / ${questions.length}  (${pct}%)`;
  $('finalTime').textContent       = `Time: ${m}:${s.toString().padStart(2, '0')}`;
  $('rubyEarned').textContent      = `💎 +${rubies} rubies earned`;
  if (newBalance) $('rubyTotal').textContent = `Total balance: 💎 ${newBalance}`;

  if (streak && streak.current > 0) {
    $('streakLine').textContent = streak.extended
      ? `🔥 ${streak.current}-day streak${streak.stage ? ` — ${streak.stage}` : ''}!`
      : `🔥 ${streak.current}-day streak going strong`;
    $('streakLine').style.display = 'inline-block';
  }
}

init();
