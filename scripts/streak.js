const username = sessionStorage.getItem('username');
const token    = sessionStorage.getItem('token');
const AUTH     = { Authorization: `Bearer ${token}` };
const $ = id => document.getElementById(id);

const DAY_LETTERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function flameHtml(stageClass, mini) {
  return `
    <div class="flame ${mini ? 'flame--mini' : ''} ${stageClass}">
      <div class="flame__glow"></div>
      <div class="flame__ring"></div>
      <div class="flame__body">
        <div class="flame__outer"></div>
        <div class="flame__mid"></div>
        <div class="flame__core"></div>
      </div>
    </div>`;
}

async function init() {
  if (!username || !token) { window.location.href = '/'; return; }

  let data;
  try {
    const res = await fetch('/api/streak', { headers: AUTH });
    if (res.status === 401) { window.location.href = '/'; return; }
    data = await res.json();
  } catch (e) {
    $('statusLine').textContent = 'Could not load your streak. Try again later.';
    return;
  }

  // ── Hero flame ──
  const hero = $('heroFlame');
  hero.classList.remove('stage-0');
  if (data.current === 0) {
    hero.classList.add('stage-0');
    $('stageName').textContent  = 'Flame out';
    $('statusLine').textContent = 'Finish a quiz today to light your flame!';
    $('ctaBtn').style.display   = 'inline-block';
  } else if (!data.stage) {
    hero.classList.add('stage-lit');
    $('stageName').textContent  = 'Lit — no badge yet';
    $('statusLine').textContent = data.active_today
      ? '✓ You studied today. Keep it going!'
      : '⚠ Finish a quiz today or your flame goes out!';
  } else {
    hero.classList.add(`stage-${data.stage.level}`);
    $('stageName').textContent  = `${data.stage.name} · stage ${data.stage.level} of 10`;
    $('statusLine').textContent = data.active_today
      ? '✓ You studied today. Keep it going!'
      : '⚠ Finish a quiz today or your flame goes out!';
  }
  $('streakCount').textContent = data.current;

  // ── Progress to next stage ──
  if (data.next_stage) {
    const prev = data.stage ? data.stage.threshold : 0;
    const pct  = Math.round(((data.current - prev) / (data.next_stage.threshold - prev)) * 100);
    $('progressFill').style.width = Math.max(4, pct) + '%';
    $('progressLabel').textContent =
      `${data.next_stage.days_left} day${data.next_stage.days_left === 1 ? '' : 's'} to ${data.next_stage.name} (${data.next_stage.threshold})`;
  } else {
    $('progressFill').style.width = '100%';
    $('progressLabel').textContent = `MAX — ${data.max}-day Eternal Flame! 🏆`;
  }

  // ── Week strip ──
  for (const d of data.week) {
    const el = document.createElement('div');
    el.className = 'week__day' + (d.active ? ' week__day--active' : '');
    const label = DAY_LETTERS[new Date(d.date + 'T12:00:00').getDay()];
    el.innerHTML = `<span class="week__flame">${d.active ? '🔥' : '·'}</span><span class="week__label">${label}</span>`;
    $('weekStrip').appendChild(el);
  }

  // ── Stats ──
  $('statCurrent').textContent = data.current;
  $('statLongest').textContent = data.longest;
  $('statBadges').textContent  = data.stages.filter(s => s.unlocked).length + ' / 10';

  // ── Stage gallery ──
  for (const s of data.stages) {
    const card = document.createElement('div');
    card.className = 'stage-card' + (s.unlocked ? '' : ' stage-card--locked');
    card.innerHTML = `
      <div class="stage-card__flame">${flameHtml(s.unlocked ? `stage-${s.level}` : 'stage-locked', true)}</div>
      <span class="stage-card__name">${s.unlocked ? s.name : '🔒 ' + s.name}</span>
      <span class="stage-card__req">${s.threshold}-day streak</span>`;
    $('stageGrid').appendChild(card);
  }
}

init();
