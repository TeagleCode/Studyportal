const express  = require('express');
const bcrypt   = require('bcrypt');
const multer   = require('multer');
const db       = require('./db');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
// Restricted mathjs evaluate (per mathjs security docs): formulas can do
// arithmetic but can't import functions, define units, or nest evaluate/parse.
const { create, all } = require('mathjs');
const math = create(all);
const evaluate = math.evaluate;
math.import({
  import:     () => { throw new Error('import is disabled'); },
  createUnit: () => { throw new Error('createUnit is disabled'); },
  evaluate:   () => { throw new Error('evaluate is disabled'); },
  parse:      () => { throw new Error('parse is disabled'); },
  simplify:   () => { throw new Error('simplify is disabled'); },
  derivative: () => { throw new Error('derivative is disabled'); },
}, { override: true });

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

// Only expose public assets — never the project root (.env, db.js, seed
// scripts with answers, etc. must not be reachable over HTTP).
app.use('/pages',   express.static(path.join(__dirname, 'pages')));
app.use('/style',   express.static(path.join(__dirname, 'style')));
app.use('/img',     express.static(path.join(__dirname, 'img')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// scripts/ also holds seed/import tooling; only client scripts are served.
const CLIENT_SCRIPTS = new Set([
  'login.js', 'test.js', 'chapters.js', 'dashboard.js',
  'accountManagement.js', 'bg-symbols.js', 'streak.js',
]);
app.get('/scripts/:file', (req, res) => {
  if (!CLIENT_SCRIPTS.has(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'scripts', req.params.file));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

// ── Auth tokens (in-memory) ──────────────────────────────────────
// Login issues a bearer token; user-specific endpoints derive the username
// from the token instead of trusting whatever the client sends.
const authTokens = new Map();                    // token -> { username, expires }
const TOKEN_TTL  = 7 * 24 * 60 * 60 * 1000;      // 7 days

function tokenUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const entry = authTokens.get(h.slice(7));
  if (!entry) return null;
  if (Date.now() > entry.expires) { authTokens.delete(h.slice(7)); return null; }
  return entry.username;
}

function requireAuth(req, res, next) {
  const username = tokenUser(req);
  if (!username) return res.status(401).json({ error: 'unauthorized' });
  req.username = username;
  next();
}

// ── Login rate limiting (in-memory) ──────────────────────────────
const loginAttempts = new Map();                 // ip -> { count, resetAt }
const LOGIN_WINDOW  = 15 * 60 * 1000;
const LOGIN_MAX     = 10;

function loginLimiter(req, res, next) {
  const now = Date.now();
  let e = loginAttempts.get(req.ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + LOGIN_WINDOW }; loginAttempts.set(req.ip, e); }
  if (e.count >= LOGIN_MAX) return res.status(429).json({ error: 'too_many_attempts' });
  e.count++;
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of loginAttempts) if (now > e.resetAt) loginAttempts.delete(ip);
}, LOGIN_WINDOW).unref();

// ── Streaks ───────────────────────────────────────────────────────
// Daily study streak (Duolingo-style): finishing at least one quiz per
// calendar day keeps the flame alive. First badge at 3 days, cap at 200.
const STREAK_CAP = 200;
const STREAK_STAGES = [
  { level: 1,  name: 'Spark',         threshold: 3   },
  { level: 2,  name: 'Ember',         threshold: 7   },
  { level: 3,  name: 'Kindled Flame', threshold: 14  },
  { level: 4,  name: 'Steady Blaze',  threshold: 21  },
  { level: 5,  name: 'Bonfire',       threshold: 30  },
  { level: 6,  name: 'Azure Flame',   threshold: 50  },
  { level: 7,  name: 'Violet Inferno',threshold: 75  },
  { level: 8,  name: 'White-Hot',     threshold: 100 },
  { level: 9,  name: 'Golden Flame',  threshold: 150 },
  { level: 10, name: 'Eternal Flame', threshold: 200 },
];
const stageFor     = days => [...STREAK_STAGES].reverse().find(s => days >= s.threshold) || null;
const nextStageFor = days => STREAK_STAGES.find(s => s.threshold > days) || null;

// DB timestamps use the DB server's clock (UTC in the container); shift to
// this machine's local timezone before taking calendar dates.
const TZ_OFFSET_MIN = -new Date().getTimezoneOffset();

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');            // YYYY-MM-DD
}

// Called when a logged-in user finishes a quiz. Returns { current, extended }.
async function bumpStreak(userId) {
  const today = localDate(0), yesterday = localDate(-1);
  const [[row]] = await db.execute(
    "SELECT current_streak, longest_streak, DATE_FORMAT(last_active_date, '%Y-%m-%d') AS last FROM user_streaks WHERE user_id = ?",
    [userId]
  );
  if (!row) {
    await db.execute(
      'INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date) VALUES (?, 1, 1, ?)',
      [userId, today]
    );
    return { current: 1, extended: true };
  }
  if (row.last === today) return { current: row.current_streak, extended: false };

  const current = row.last === yesterday ? Math.min(row.current_streak + 1, STREAK_CAP) : 1;
  const longest = Math.max(row.longest_streak, current);
  await db.execute(
    'UPDATE user_streaks SET current_streak = ?, longest_streak = ?, last_active_date = ? WHERE user_id = ?',
    [current, longest, today, userId]
  );
  return { current, extended: true };
}

// Read-only streak state. A streak whose last active day is before yesterday
// is broken: reported as 0 without writing (next finish resets it anyway).
async function readStreak(userId) {
  const today = localDate(0), yesterday = localDate(-1);
  const [[row]] = await db.execute(
    "SELECT current_streak, longest_streak, DATE_FORMAT(last_active_date, '%Y-%m-%d') AS last FROM user_streaks WHERE user_id = ?",
    [userId]
  );
  let current = 0, longest = 0, activeToday = false;
  if (row) {
    longest = row.longest_streak;
    if (row.last === today)          { current = row.current_streak; activeToday = true; }
    else if (row.last === yesterday) { current = row.current_streak; }
  }
  return { current, longest, activeToday };
}

// ── Test session store (in-memory) ───────────────────────────────
const testSessions = new Map();

// Fisher–Yates; returns [value, originalIndex] pairs so shuffled option ids
// can be traced back to the authored index (option_explanations keys).
function shuffleWithIndex(arr) {
  const a = arr.map((v, i) => [v, i]);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
  return String(s)
    .normalize('NFC')                                  // Georgian & accented scripts
    .toLowerCase()
    .replace(/[.,!?;:'"«»„“”‘’`()[\]{}\\/|_~^*+=<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse a student-typed number: fractions ("3/4", "1 1/2"), comma decimals
// ("3,5"), thousands separators ("1.234.567", "1,234.5"), trailing units
// ("25 კმ", "3.5cm", "50%"), unicode minus.
function parseNumeric(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).normalize('NFC').trim().replace(/[−–]/g, '-');
  s = s.replace(/\s*(?:[a-zა-ჿ]+\.?|%|°)\s*$/i, '');

  const mixed = s.match(/^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const den = +mixed[4];
    if (!den) return NaN;
    const v = +mixed[2] + (+mixed[3] / den);
    return mixed[1] === '-' ? -v : v;
  }
  const frac = s.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const den = +frac[2];
    return den ? +frac[1] / den : NaN;
  }

  s = s.replace(/[   \s]+/g, '');
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Rightmost separator is the decimal point; the other one groups thousands
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // Single comma = decimal comma; multiple = thousands separators
    s = (s.match(/,/g).length === 1) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot && s.match(/\./g).length > 1) {
    s = s.replace(/\./g, '');  // "1.234.567" → 1234567
  }

  return s && /^-?\d*\.?\d+(e-?\d+)?$/i.test(s) ? Number(s) : NaN;
}

function numericMatch(a, b) {
  const na = parseNumeric(a), nb = parseNumeric(b);
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
          // option_explanations keys are authored indexes; served ids are shuffled
          const authoredIdx = sq.option_index_map
            ? sq.option_index_map[Number(submittedAnswer)]
            : Number(submittedAnswer);
          const specific = optEx[String(authoredIdx)];
          if (specific) explanation = specific + (explanation ? '\n\n' + explanation : '');
        } catch (_) {}
      }
    }
    return { correct: isCorrect, correct_id: sq.correct_answer_id, explanation, steps };
  }

  // Text answer — numeric compare on raw strings first (keeps fractions like
  // "3/4" intact), then normalized text compare, then acceptable_answers.
  const correct = sq.computed_answer ?? q.correct_answer;
  const norm    = normalizeText(submittedAnswer);

  let isCorrect = numericMatch(submittedAnswer, correct) || norm === normalizeText(correct);
  if (!isCorrect && q.acceptable_answers) {
    try {
      isCorrect = JSON.parse(q.acceptable_answers).some(a =>
        normalizeText(a) === norm || numericMatch(submittedAnswer, a));
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
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'not_registered' });

    const match = await bcrypt.compare(password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'wrong_password' });

    loginAttempts.delete(req.ip);
    // Single active session per account: a new login revokes every existing
    // token for this user (also bounds the map to one entry per user).
    for (const [t, entry] of authTokens)
      if (entry.username === rows[0].username) authTokens.delete(t);
    const token = crypto.randomUUID();
    authTokens.set(token, { username: rows[0].username, expires: Date.now() + TOKEN_TTL });
    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ── User (all token-scoped: you can only read/change your own account) ────
app.get('/api/user/:username', requireAuth, async (req, res) => {
  if (req.params.username !== req.username) return res.status(403).json({ error: 'forbidden' });
  try {
    const [rows] = await db.execute(
      'SELECT username, email, first_name, last_name, avatar_url, rubies FROM users WHERE username = ?',
      [req.username]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.put('/api/user/username', requireAuth, async (req, res) => {
  const { newUsername } = req.body;
  if (!newUsername || !newUsername.trim()) return res.status(400).json({ error: 'invalid' });
  try {
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [newUsername]);
    if (existing.length) return res.status(409).json({ error: 'taken' });
    await db.execute('UPDATE users SET username = ? WHERE username = ?', [newUsername, req.username]);
    for (const entry of authTokens.values())
      if (entry.username === req.username) entry.username = newUsername;
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.put('/api/user/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const [rows] = await db.execute('SELECT password_hash FROM users WHERE username = ?', [req.username]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'wrong_password' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password_hash = ? WHERE username = ?', [hash, req.username]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/user/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const avatarUrl = '/uploads/avatars/' + req.file.filename;
  try {
    await db.execute('UPDATE users SET avatar_url = ? WHERE username = ?', [avatarUrl, req.username]);
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
  const { topicId } = req.body;
  // A revoked/expired token gets a clear 401 (client thinks it's logged in —
  // don't silently downgrade to guest). No Authorization header = guest.
  if (req.headers.authorization && !tokenUser(req))
    return res.status(401).json({ error: 'unauthorized' });
  const username = tokenUser(req);   // null for guests; never trusted from body
  try {
    const limit = 10;
    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE topic_id = ? ORDER BY RAND() LIMIT ?',
      [topicId, limit]
    );
    if (!questions.length) return res.json({ sessionId: null, questions: [] });

    let userId = null;
    if (username) {
      const [[user]] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
      if (user) userId = user.id;
    }
    const [attemptRes] = await db.execute(
      'INSERT INTO quiz_attempts (user_id, topic_id, total) VALUES (?, ?, ?)',
      [userId, topicId, questions.length]
    );
    const attemptId = attemptRes.insertId;

    const sessionId = crypto.randomUUID();
    const session   = { username, userId, attemptId, sessionQuestions: [], score: 0 };
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
          const shuffled = shuffleWithIndex(JSON.parse(q.option_formulas));
          const opts = shuffled.map(([f]) => {
            let val;
            try { val = +evaluate(f.formula, values).toFixed(2); } catch { val = f.fallback || '?'; }
            return { answer_text: formatGeo(val), _correct: !!f.is_correct };
          });
          cq.options = opts.map((o, i) => ({ id: i, answer_text: o.answer_text }));
          sq.option_index_map = shuffled.map(([, orig]) => orig);  // served id → authored index
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
          // Authored order (by id), shuffled in JS so served option ids can be
          // mapped back to authored indexes for option_explanations.
          const [answers] = await db.execute(
            'SELECT answer_text, is_correct FROM answers WHERE question_id = ? ORDER BY id',
            [q.id]
          );
          const shuffled = shuffleWithIndex(answers);
          cq.options = shuffled.map(([a], i) => ({ id: i, answer_text: a.answer_text }));
          sq.correct_answer_id = shuffled.findIndex(([a]) => a.is_correct);
          sq.option_index_map  = shuffled.map(([, orig]) => orig);
        }
      }

      const [aqRes] = await db.execute(
        'INSERT INTO attempt_questions (attempt_id, question_id, generated_values) VALUES (?, ?, ?)',
        [attemptId, q.id, sq.generated_values ? JSON.stringify(sq.generated_values) : null]
      );
      sq.attemptQuestionId = aqRes.insertId;

      session.sessionQuestions.push(sq);
      clientQs.push(cq);
    }

    testSessions.set(sessionId, session);
    setTimeout(() => testSessions.delete(sessionId), 2 * 60 * 60 * 1000);

    res.json({ sessionId, questions: clientQs });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/test/answer', async (req, res) => {
  const { sessionId, questionIndex, answer } = req.body;
  const session = testSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });

  const sq = session.sessionQuestions[questionIndex];
  if (!sq) return res.status(400).json({ error: 'invalid_question' });
  if (sq.answered) return res.status(409).json({ error: 'already_answered' });
  sq.answered = true;

  const result = gradeAnswer(sq, answer);
  if (result.correct) session.score++;

  try {
    await db.execute(
      'UPDATE attempt_questions SET submitted_answer = ?, is_correct = ?, answered_at = NOW() WHERE id = ?',
      [String(answer), result.correct ? 1 : 0, sq.attemptQuestionId]
    );
  } catch (e) { console.error('attempt record error:', e); }

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

  try {
    await db.execute(
      'UPDATE quiz_attempts SET score = ?, finished_at = NOW() WHERE id = ?',
      [score, session.attemptId]
    );
  } catch (e) { console.error('attempt record error:', e); }

  if (session.username && rubies > 0) {
    try {
      await db.execute('UPDATE users SET rubies = rubies + ? WHERE username = ?', [rubies, session.username]);
      const [[user]] = await db.execute('SELECT rubies FROM users WHERE username = ?', [session.username]);
      newBalance = user.rubies;
    } catch (e) { console.error(e); }
  }

  let streak = null;
  if (session.userId) {
    try {
      const s = await bumpStreak(session.userId);
      const stage = stageFor(s.current);
      streak = { current: s.current, extended: s.extended, stage: stage ? stage.name : null };
    } catch (e) { console.error('streak error:', e); }
  }

  testSessions.delete(sessionId);
  res.json({ score, total, pct, rubies, newBalance, streak });
});

// ── Streak ────────────────────────────────────────────────────────
app.get('/api/streak', requireAuth, async (req, res) => {
  try {
    const [[user]] = await db.execute('SELECT id FROM users WHERE username = ?', [req.username]);
    if (!user) return res.status(404).json({ error: 'not_found' });

    const { current, longest, activeToday } = await readStreak(user.id);

    // Activity dots for the last 7 days (from attempt history)
    const [activeRows] = await db.execute(`
      SELECT DISTINCT DATE_FORMAT(finished_at + INTERVAL ? MINUTE, '%Y-%m-%d') AS day
      FROM quiz_attempts
      WHERE user_id = ? AND finished_at IS NOT NULL
        AND finished_at >= NOW() - INTERVAL 8 DAY
    `, [TZ_OFFSET_MIN, user.id]);
    const activeDays = new Set(activeRows.map(r => r.day));
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const day = localDate(-i);
      week.push({ date: day, active: activeDays.has(day) });
    }

    const stage = stageFor(current);
    const next  = nextStageFor(current);
    res.json({
      current, longest, active_today: activeToday, max: STREAK_CAP,
      stage: stage ? { level: stage.level, name: stage.name, threshold: stage.threshold } : null,
      next_stage: next
        ? { level: next.level, name: next.name, threshold: next.threshold, days_left: next.threshold - current }
        : null,
      week,
      stages: STREAK_STAGES.map(s => ({ ...s, unlocked: longest >= s.threshold })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// ── Progress ──────────────────────────────────────────────────────
app.get('/api/progress/:username', requireAuth, async (req, res) => {
  if (req.params.username !== req.username) return res.status(403).json({ error: 'forbidden' });
  try {
    const [[user]] = await db.execute('SELECT id FROM users WHERE username = ?', [req.username]);
    if (!user) return res.status(404).json({ error: 'not_found' });

    const [[overall]] = await db.execute(`
      SELECT COUNT(*) AS answered, COALESCE(SUM(aq.is_correct), 0) AS correct
      FROM attempt_questions aq
      JOIN quiz_attempts qa ON aq.attempt_id = qa.id
      WHERE qa.user_id = ? AND aq.is_correct IS NOT NULL
    `, [user.id]);

    const [subjects] = await db.execute(`
      SELECT s.slug, s.display_name, g.grade_num,
             COUNT(*) AS answered, COALESCE(SUM(aq.is_correct), 0) AS correct
      FROM attempt_questions aq
      JOIN quiz_attempts qa ON aq.attempt_id = qa.id
      JOIN questions q  ON aq.question_id = q.id
      JOIN topics t     ON q.topic_id = t.id
      JOIN chapters c   ON t.chapter_id = c.id
      JOIN subjects s   ON c.subject_id = s.id
      JOIN grades g     ON c.grade_id = g.id
      WHERE qa.user_id = ? AND aq.is_correct IS NOT NULL
      GROUP BY s.id, g.id
      ORDER BY s.display_name, g.grade_num
    `, [user.id]);

    const [weakTopics] = await db.execute(`
      SELECT t.id AS topic_id, t.title AS topic, c.title AS chapter,
             s.slug AS subject, s.display_name AS subject_name, g.grade_num,
             COUNT(*) AS answered, COALESCE(SUM(aq.is_correct), 0) AS correct
      FROM attempt_questions aq
      JOIN quiz_attempts qa ON aq.attempt_id = qa.id
      JOIN questions q  ON aq.question_id = q.id
      JOIN topics t     ON q.topic_id = t.id
      JOIN chapters c   ON t.chapter_id = c.id
      JOIN subjects s   ON c.subject_id = s.id
      JOIN grades g     ON c.grade_id = g.id
      WHERE qa.user_id = ? AND aq.is_correct IS NOT NULL
      GROUP BY t.id
      HAVING COUNT(*) >= 5 AND COALESCE(SUM(aq.is_correct), 0) / COUNT(*) < 0.6
      ORDER BY COALESCE(SUM(aq.is_correct), 0) / COUNT(*) ASC
      LIMIT 5
    `, [user.id]);

    const [recent] = await db.execute(`
      SELECT qa.id, qa.score, qa.total, qa.finished_at,
             t.id AS topic_id, t.title AS topic, c.title AS chapter,
             s.slug AS subject, s.display_name AS subject_name, g.grade_num
      FROM quiz_attempts qa
      JOIN topics t   ON qa.topic_id = t.id
      JOIN chapters c ON t.chapter_id = c.id
      JOIN subjects s ON c.subject_id = s.id
      JOIN grades g   ON c.grade_id = g.id
      WHERE qa.user_id = ? AND qa.finished_at IS NOT NULL
      ORDER BY qa.finished_at DESC
      LIMIT 10
    `, [user.id]);

    const [daily] = await db.execute(`
      SELECT DATE(aq.answered_at) AS day,
             COUNT(*) AS answered, COALESCE(SUM(aq.is_correct), 0) AS correct
      FROM attempt_questions aq
      JOIN quiz_attempts qa ON aq.attempt_id = qa.id
      WHERE qa.user_id = ? AND aq.is_correct IS NOT NULL
        AND aq.answered_at >= NOW() - INTERVAL 14 DAY
      GROUP BY DATE(aq.answered_at)
      ORDER BY day
    `, [user.id]);

    res.json({
      overall: {
        answered: Number(overall.answered),
        correct:  Number(overall.correct),
        accuracy: overall.answered ? Math.round((overall.correct / overall.answered) * 100) : null,
      },
      subjects: subjects.map(r => ({
        subject: r.slug, subject_name: r.display_name, grade: r.grade_num,
        answered: Number(r.answered), correct: Number(r.correct),
        accuracy: Math.round((r.correct / r.answered) * 100),
      })),
      weak_topics: weakTopics.map(r => ({
        topic_id: r.topic_id, topic: r.topic, chapter: r.chapter,
        subject: r.subject, subject_name: r.subject_name, grade: r.grade_num,
        answered: Number(r.answered), correct: Number(r.correct),
        accuracy: Math.round((r.correct / r.answered) * 100),
      })),
      recent_quizzes: recent.map(r => ({
        topic_id: r.topic_id, topic: r.topic, chapter: r.chapter,
        subject: r.subject, subject_name: r.subject_name, grade: r.grade_num,
        score: r.score, total: r.total,
        pct: r.total ? Math.round((r.score / r.total) * 100) : 0,
        finished_at: r.finished_at,
      })),
      daily: daily.map(r => ({
        day: r.day, answered: Number(r.answered), correct: Number(r.correct),
        accuracy: Math.round((r.correct / r.answered) * 100),
      })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
