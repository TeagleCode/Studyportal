#!/usr/bin/env node
// End-to-end machine test against the running server (localhost:3000).
// Covers auth, single-session, quiz flow, progress, streaks, rate limiting,
// signup, and SP-xxx error codes (docs/ERROR-CODES.md).
// Run: node scripts/e2e-test.js   (needs server + DB running)
const BASE = 'http://localhost:3000';
let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${name}${cond ? '' : '  ' + extra}`);
  if (!cond) failures++;
}
async function post(p, body, headers = {}) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function get(p, headers = {}) {
  const r = await fetch(BASE + p, { headers });
  return { status: r.status, data: await r.json().catch(() => null) };
}

(async () => {
  // ── auth ──
  const login = await post('/api/login', { username: 'david', password: 'password123' });
  check('login works and returns token', login.status === 200 && login.data.success && !!login.data.token);
  let TOKEN = login.data.token;
  let AUTH  = { Authorization: `Bearer ${TOKEN}` };

  const badLogin = await post('/api/login', { username: 'david', password: 'nope' });
  check('wrong password rejected', badLogin.status === 401);

  check('user endpoint w/o token → 401', (await get('/api/user/david')).status === 401);
  check('user endpoint with token → 200', (await get('/api/user/david', AUTH)).status === 200);
  check("other user's data with my token → 403", (await get('/api/user/testuser', AUTH)).status === 403);

  // ── error codes (docs/ERROR-CODES.md) ──
  check('wrong password carries SP-101', badLogin.data.code === 'SP-101', JSON.stringify(badLogin.data));
  check('unknown user carries SP-100',
    (await post('/api/login', { username: 'no_such_user_xyz', password: 'x' })).data.code === 'SP-100');
  check('unauthorized carries SP-103', (await get('/api/user/david')).data.code === 'SP-103');
  check('forbidden carries SP-104', (await get('/api/user/testuser', AUTH)).data.code === 'SP-104');
  check('taken username carries SP-107',
    (await post('/api/signup', { username: 'david', password: 'secret123' })).data.code === 'SP-107');

  // ── single session per account ──
  const relogin = await post('/api/login', { username: 'david', password: 'password123' });
  check('second login issues a different token', !!relogin.data.token && relogin.data.token !== TOKEN);
  check('first token revoked by second login', (await get('/api/user/david', AUTH)).status === 401);
  const staleAuth = AUTH;
  TOKEN = relogin.data.token;
  AUTH  = { Authorization: `Bearer ${TOKEN}` };
  check('new token works', (await get('/api/user/david', AUTH)).status === 200);
  const staleStart = await post('/api/test/start', { topicId: 1 }, staleAuth);
  check('quiz start with revoked token → 401 (no silent guest)', staleStart.status === 401);
  await post('/api/login', { username: 'testuser', password: 'password123' });
  check("other account's login does not revoke mine", (await get('/api/user/david', AUTH)).status === 200);

  // ── signup ──
  const fresh = 'e2e_' + Math.random().toString(36).slice(2, 10);
  const su = await post('/api/signup', { username: fresh, password: 'secret123' });
  check('signup creates account (201 + token)', su.status === 201 && !!su.data.token);
  check('signup token works immediately', (await get(`/api/user/${fresh}`, { Authorization: `Bearer ${su.data.token}` })).status === 200);
  check('duplicate username → 409', (await post('/api/signup', { username: fresh, password: 'secret123' })).status === 409);
  check('invalid username → 400', (await post('/api/signup', { username: 'x', password: 'secret123' })).status === 400);
  check('weak password → 400', (await post('/api/signup', { username: fresh + 'b', password: '123' })).status === 400);
  const freshLogin = await post('/api/login', { username: fresh, password: 'secret123' });
  check('new account can log in normally', freshLogin.status === 200 && !!freshLogin.data.token);

  // ── content ──
  const chapters = (await get('/api/chapters/7/math')).data;
  check('chapters listed (public)', Array.isArray(chapters) && chapters.length >= 3);
  const exampleCh = chapters.find(c => c.title.includes('სამაგალითო'));
  check('example chapter present', !!exampleCh);
  const topicId = exampleCh.topics[0].id;

  const guestStart = await post('/api/test/start', { topicId });
  check('guest quiz start (no auth header) still works', guestStart.status === 200 && !!guestStart.data.sessionId);

  // ── per-wrong-option explanation (static MC: even-number question) ──
  {
    let done = false;
    for (let tries = 0; tries < 8 && !done; tries++) {
      const s = (await post('/api/test/start', { topicId })).data;
      const idx = s.questions.findIndex(q => q.question_type === 'multiple_choice' && q.question_text.includes('ლუწი'));
      if (idx === -1) continue;
      const q = s.questions[idx];
      const seven = q.options.find(o => o.answer_text === '7');
      const r = (await post('/api/test/answer', { sessionId: s.sessionId, questionIndex: idx, answer: seven.id })).data;
      check('picking distractor "7" is graded wrong', r.correct === false);
      check('explanation is the one written for "7"', !!r.explanation && r.explanation.includes('7 კენტია'), r.explanation);
      const correct = q.options.find(o => String(o.id) === String(r.correct_id));
      check('option_explanations mapping was exercised', correct && correct.answer_text === '14');
      done = true;
    }
    if (!done) check('found the even-number static MC within 8 sessions', false);
  }

  // ── quiz flow ──
  const start = (await post('/api/test/start', { topicId }, AUTH)).data;
  check('test session started', !!start.sessionId && start.questions.length === 4);
  const raw = JSON.stringify(start);
  check('no answer leakage in start payload',
    !/is_correct|correct_answer|answer_formula|option_formulas|acceptable|explanation|_dbId|_correct|correct_id/.test(raw),
    raw.slice(0, 200));

  let correctCount = 0, reanswerChecked = false;
  for (let i = 0; i < start.questions.length; i++) {
    const q = start.questions[i];
    if (q.question_type === 'multiple_choice') {
      const m = q.question_text.match(/(\d+)\s*×\s*(\d+)/);
      let answerId = 0;
      if (m) {
        const target = +m[1] * +m[2];
        const found = q.options.find(o => Math.abs(parseFloat(o.answer_text.replace(/\./g, '')) - target) < 0.01);
        if (found) answerId = found.id;
      } else {
        const found = q.options.find(o => o.answer_text === '14');
        if (found) answerId = found.id;
      }
      const res = (await post('/api/test/answer', { sessionId: start.sessionId, questionIndex: i, answer: answerId })).data;
      check(`q${i} MC answered correctly`, res.correct === true, JSON.stringify(res));
      if (res.correct) correctCount++;
      if (!reanswerChecked) {
        const again = await post('/api/test/answer', { sessionId: start.sessionId, questionIndex: i, answer: answerId });
        check(`q${i} re-answer rejected (409, SP-202)`, again.status === 409 && again.data.code === 'SP-202', JSON.stringify(again.data));
        reanswerChecked = true;
      }
    } else {
      const m = q.question_text.match(/(\d+)\s*\+\s*(\d+)/);
      if (m) {
        const ans = `${+m[1] + +m[2]},0 კმ`;
        const res = (await post('/api/test/answer', { sessionId: start.sessionId, questionIndex: i, answer: ans })).data;
        check(`q${i} text answered correctly ("${ans}")`, res.correct === true, JSON.stringify(res));
        if (res.correct) correctCount++;
      } else {
        const res = (await post('/api/test/answer', { sessionId: start.sessionId, questionIndex: i, answer: '  ორი!! ' })).data;
        check(`q${i} text answered correctly ("  ორი!! ")`, res.correct === true, JSON.stringify(res));
        if (res.correct) correctCount++;
      }
    }
  }

  const fin = (await post('/api/test/finish', { sessionId: start.sessionId })).data;
  check('finish returns score', fin.score === correctCount && fin.total === 4, JSON.stringify(fin));
  check('rubies credited to token user', fin.rubies > 0);

  // ── progress ──
  check('progress w/o token → 401', (await get('/api/progress/david')).status === 401);
  check("other user's progress → 403", (await get('/api/progress/testuser', AUTH)).status === 403);
  const prog = (await get('/api/progress/david', AUTH)).data;
  check('progress: overall answered ≥ 4', prog.overall.answered >= 4);
  check('progress: subject row for math g7', prog.subjects.some(s => s.subject === 'math' && s.grade === 7));
  check('progress: recent quiz recorded', prog.recent_quizzes.length >= 1 && prog.recent_quizzes[0].total === 4);
  check('progress: daily activity present', prog.daily.length >= 1);

  // ── streak ──
  check('streak w/o token → 401', (await get('/api/streak')).status === 401);
  const st = (await get('/api/streak', AUTH)).data;
  check('streak: 10 stages, max 200', st.stages.length === 10 && st.max === 200);
  check('streak: current ≥ 1 and active today', st.current >= 1 && st.active_today === true, JSON.stringify(st));
  check('streak: week has 7 days, today active', st.week.length === 7 && st.week[6].active === true);
  check('streak: thresholds are 3..200', st.stages[0].threshold === 3 && st.stages[9].threshold === 200);
  check('finish response included streak', fin.streak && fin.streak.current === st.current, JSON.stringify(fin.streak));

  const s2 = (await post('/api/test/start', { topicId }, AUTH)).data;
  for (let i = 0; i < s2.questions.length; i++)
    await post('/api/test/answer', { sessionId: s2.sessionId, questionIndex: i, answer: 0 });
  const fin2 = (await post('/api/test/finish', { sessionId: s2.sessionId })).data;
  check('same-day finish does not extend streak', fin2.streak.extended === false && fin2.streak.current === st.current);

  // stage math with injected streak values
  const db = require('../db');
  const today = new Date().toLocaleDateString('en-CA');
  const [[u]] = await db.execute("SELECT id FROM users WHERE username = 'david'");

  await db.execute('UPDATE user_streaks SET current_streak = 55, longest_streak = 55, last_active_date = ? WHERE user_id = ?', [today, u.id]);
  const st55 = (await get('/api/streak', AUTH)).data;
  check('55-day streak → stage 6 Azure Flame', st55.stage && st55.stage.level === 6 && st55.stage.name === 'Azure Flame');
  check('55-day streak → 20 days to Violet Inferno', st55.next_stage && st55.next_stage.days_left === 20);
  check('55-day streak → 6 badges unlocked', st55.stages.filter(s => s.unlocked).length === 6);

  await db.execute('UPDATE user_streaks SET current_streak = 200, longest_streak = 200, last_active_date = ? WHERE user_id = ?', [today, u.id]);
  const st200 = (await get('/api/streak', AUTH)).data;
  check('200-day streak → stage 10 Eternal Flame, no next stage', st200.stage.level === 10 && st200.next_stage === null);
  check('200-day streak → all 10 badges unlocked', st200.stages.every(s => s.unlocked));

  const threeAgo = new Date(Date.now() - 3 * 86400000).toLocaleDateString('en-CA');
  await db.execute('UPDATE user_streaks SET current_streak = 42, last_active_date = ? WHERE user_id = ?', [threeAgo, u.id]);
  const stBroken = (await get('/api/streak', AUTH)).data;
  check('stale streak reads as 0 (broken)', stBroken.current === 0 && stBroken.stage === null);
  check('longest streak survives the break', stBroken.longest === 200);

  // restore real values captured before the injections
  await db.execute('UPDATE user_streaks SET current_streak = ?, longest_streak = ?, last_active_date = ? WHERE user_id = ?', [st.current, st.longest, today, u.id]);
  // clean up the e2e signup account (it has no attempts/streaks)
  await db.execute('DELETE FROM users WHERE username LIKE "e2e\\_%"');

  // ── rate limiting (via spoofed forwarded IP so the real bucket stays clean;
  //    loopback is a trusted proxy, so XFF is honored for local requests) ──
  const FAKE_IP = { 'X-Forwarded-For': '203.0.113.77' };
  let got429 = false, code429 = null;
  for (let i = 0; i < 12; i++) {
    const r = await post('/api/login', { username: 'david', password: 'wrong' }, FAKE_IP);
    if (r.status === 429) { got429 = true; code429 = r.data.code; break; }
  }
  check('login rate limit kicks in (429, SP-102)', got429 && code429 === 'SP-102');
  check('rate limit is per-IP: other visitors unaffected',
    (await post('/api/login', { username: 'david', password: 'password123' })).status === 200);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
