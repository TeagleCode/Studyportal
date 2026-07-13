const express  = require('express');
const bcrypt   = require('bcrypt');
const multer   = require('multer');
const db       = require('./db');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { evaluate } = require('mathjs');

const app = express();
app.use(express.json());

// ── File uploads ─────────────────────────────────────────────────
const avatarDir = path.join(__dirname, 'uploads/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: avatarDir,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  },
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

// ── Test session store (in-memory) ───────────────────────────────
const testSessions = new Map();

function generateValues(variables) {
  const vals = {};
  const deferred = [];
  for (const [k, r] of Object.entries(variables)) {
    if (r.formula) {
      deferred.push([k, r]);
    } else {
      vals[k] = Math.floor(Math.random() * (r.max - r.min + 1)) + r.min;
    }
  }
  for (const [k, r] of deferred) {
    try { vals[k] = +evaluate(r.formula, vals).toFixed(4); }
    catch (e) { vals[k] = 0; }
  }
  return vals;
}

function formatGeo(n) {
  if (!Number.isInteger(n)) return String(n);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) =>
    values[k] !== undefined ? formatGeo(values[k]) : `{${k}}`
  );
}

function normalizeText(s) {
  return String(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

function numericMatch(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (isNaN(na) || isNaN(nb)) return false;
  const tol = Math.max(Math.abs(nb) * 0.01, 0.01);
  return Math.abs(na - nb) <= tol;
}

function buildExplanation(q, sq) {
  const vals = sq.generated_values
    ? { ...sq.generated_values, answer: sq.computed_answer }
    : {};

  let explanation = null;
  if (q.is_parametric && q.explanation_template && sq.generated_values) {
    explanation = fillTemplate(q.explanation_template, vals);
  } else {
    explanation = q.explanation || null;
  }

  let steps = null;
  if (q.explanation_steps) {
    try {
      const raw = JSON.parse(q.explanation_steps);
      if (Array.isArray(raw) && raw.length > 1) {
        steps = raw.map(s =>
          (q.is_parametric && sq.generated_values) ? fillTemplate(String(s), vals) : String(s)
        );
      }
    } catch (_) {}
  }

  return { explanation, steps };
}

function gradeAnswer(sq, submittedAnswer) {
  const q     = sq.full_question;
  const qType = q.question_type || 'multiple_choice';

  if (qType === 'multiple_choice') {
    const isCorrect = String(submittedAnswer) === String(sq.correct_answer_id);
    let explanation = null;
    let steps = null;
    if (!isCorrect) {
      ({ explanation, steps } = buildExplanation(q, sq));
      if (q.option_explanations) {
        try {
          const optEx = JSON.parse(q.option_explanations);
          const specific = optEx[String(submittedAnswer)];
          if (specific) explanation = specific + (explanation ? '\n\n' + explanation : '');
        } catch (_) {}
      }
    }
    return { correct: isCorrect, correct_id: sq.correct_answer_id, explanation, steps };
  }

  // Text answer
  const norm    = normalizeText(submittedAnswer);
  const correct = sq.computed_answer ?? q.correct_answer;
  const normC   = normalizeText(correct);

  let isCorrect = numericMatch(norm, normC) || norm === normC;
  if (!isCorrect && q.acceptable_answers) {
    try {
      isCorrect = JSON.parse(q.acceptable_answers).some(a => normalizeText(a) === norm);
    } catch (_) {}
  }

  const { explanation: expl, steps } = isCorrect ? {} : buildExplanation(q, sq);
  return {
    correct: isCorrect,
    correct_answer: isCorrect ? null : correct,
    explanation: isCorrect ? null : expl,
    steps:       isCorrect ? null : steps,
  };
}

// ── Auth ──────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'not_registered' });

    const match = await bcrypt.compare(password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'wrong_password' });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ── User ──────────────────────────────────────────────────────────
app.get('/api/user/:username', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT username, email, first_name, last_name, avatar_url, rubies FROM users WHERE username = ?',
      [req.params.username]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.put('/api/user/username', async (req, res) => {
  const { currentUsername, newUsername } = req.body;
  try {
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [newUsername]);
    if (existing.length) return res.status(409).json({ error: 'taken' });
    await db.execute('UPDATE users SET username = ? WHERE username = ?', [newUsername, currentUsername]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.put('/api/user/password', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  try {
    const [rows] = await db.execute('SELECT password_hash FROM users WHERE username = ?', [username]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'wrong_password' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password_hash = ? WHERE username = ?', [hash, username]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/user/avatar', upload.single('avatar'), async (req, res) => {
  const { username } = req.body;
  const avatarUrl = '/uploads/avatars/' + req.file.filename;
  try {
    await db.execute('UPDATE users SET avatar_url = ? WHERE username = ?', [avatarUrl, username]);
    res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// ── Content ───────────────────────────────────────────────────────
app.get('/api/chapters/:grade/:subject', async (req, res) => {
  try {
    const [chapters] = await db.execute(`
      SELECT c.id, c.title, c.order_num
      FROM chapters c
      JOIN grades g ON c.grade_id = g.id
      JOIN subjects s ON c.subject_id = s.id
      WHERE g.grade_num = ? AND s.slug = ?
      ORDER BY c.order_num
    `, [req.params.grade, req.params.subject]);

    for (const ch of chapters) {
      const [topics] = await db.execute(
        'SELECT id, title FROM topics WHERE chapter_id = ? ORDER BY order_num',
        [ch.id]
      );
      ch.topics = topics;
    }
    res.json(chapters);
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// ── Test session ──────────────────────────────────────────────────
app.post('/api/test/start', async (req, res) => {
  const { topicId, username } = req.body;
  try {
    const limit = 10;
    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE topic_id = ? ORDER BY RAND() LIMIT ?',
      [topicId, limit]
    );
    if (!questions.length) return res.json({ sessionId: null, questions: [] });

    const sessionId = crypto.randomUUID();
    const session   = { username, sessionQuestions: [], score: 0 };
    const clientQs  = [];

    for (const q of questions) {
      const sq  = { full_question: q };
      const cq  = { question_type: q.question_type || 'multiple_choice' };

      if (q.is_parametric) {
        const vars   = q.variables ? JSON.parse(q.variables) : {};
        const values = generateValues(vars);
        sq.generated_values = values;
        cq.question_text    = fillTemplate(q.question_text, values);

        if (q.answer_formula) {
          try { sq.computed_answer = +evaluate(q.answer_formula, values).toFixed(4); }
          catch (e) { console.error('Formula error:', e); sq.computed_answer = null; }
        }

        if ((q.question_type || 'multiple_choice') === 'multiple_choice' && q.option_formulas) {
          const formulas = JSON.parse(q.option_formulas);
          const opts = formulas.map((f) => {
            let val;
            try { val = +evaluate(f.formula, values).toFixed(2); } catch { val = f.fallback || '?'; }
            return { answer_text: formatGeo(val), _correct: !!f.is_correct };
          });
          opts.sort(() => Math.random() - 0.5);
          cq.options = opts.map((o, i) => ({ id: i, answer_text: o.answer_text }));
          let correctIdx = opts.findIndex(o => o._correct);
          if (correctIdx < 0 && sq.computed_answer !== null) {
            correctIdx = opts.findIndex(o =>
              Math.abs(parseFloat(o.answer_text) - sq.computed_answer) < 0.05
            );
          }
          sq.correct_answer_id = correctIdx;
        }
      } else {
        cq.question_text = q.question_text;

        if ((q.question_type || 'multiple_choice') === 'multiple_choice') {
          const [answers] = await db.execute(
            'SELECT id, answer_text FROM answers WHERE question_id = ? ORDER BY RAND()',
            [q.id]
          );
          const [[correctRow]] = await db.execute(
            'SELECT id FROM answers WHERE question_id = ? AND is_correct = 1 LIMIT 1',
            [q.id]
          );
          // Re-index to 0..n so IDs are always small integers
          cq.options = answers.map((a, i) => ({ id: i, answer_text: a.answer_text, _dbId: a.id }));
          sq.correct_answer_id = cq.options.findIndex(o => o._dbId === correctRow?.id);
          cq.options = cq.options.map(({ id, answer_text }) => ({ id, answer_text }));
        }
      }

      session.sessionQuestions.push(sq);
      clientQs.push(cq);
    }

    testSessions.set(sessionId, session);
    setTimeout(() => testSessions.delete(sessionId), 2 * 60 * 60 * 1000);

    res.json({ sessionId, questions: clientQs });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/test/answer', (req, res) => {
  const { sessionId, questionIndex, answer } = req.body;
  const session = testSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });

  const sq = session.sessionQuestions[questionIndex];
  if (!sq) return res.status(400).json({ error: 'invalid_question' });

  const result = gradeAnswer(sq, answer);
  if (result.correct) session.score++;

  res.json(result);
});

app.post('/api/test/finish', async (req, res) => {
  const { sessionId } = req.body;
  const session = testSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });

  const total  = session.sessionQuestions.length;
  const score  = session.score;
  const pct    = Math.round((score / total) * 100);
  const rubies = Math.round(pct / 10);
  let newBalance = 0;

  if (session.username && rubies > 0) {
    try {
      await db.execute('UPDATE users SET rubies = rubies + ? WHERE username = ?', [rubies, session.username]);
      const [[user]] = await db.execute('SELECT rubies FROM users WHERE username = ?', [session.username]);
      newBalance = user.rubies;
    } catch (e) { console.error(e); }
  }

  testSessions.delete(sessionId);
  res.json({ score, total, pct, rubies, newBalance });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
