const username = sessionStorage.getItem('username');
const token    = sessionStorage.getItem('token');
const AUTH     = { Authorization: `Bearer ${token}` };
const $ = id => document.getElementById(id);

const GRADES   = [7, 8, 9, 10, 11];
const SUBJECTS = [
  ['math',      'მათემატიკა'],
  ['georgian',  'ქართული'],
  ['english',   'ინგლისური'],
  ['physics',   'ფიზიკა'],
  ['chemistry', 'ქიმია'],
  ['history',   'ისტორია'],
];

function pctClass(pct) {
  if (pct >= 80) return 'good';
  if (pct >= 60) return 'ok';
  return 'bad';
}

function quizUrl(t) {
  return `./grades/chapters.html?grade=${t.grade}&subject=${t.subject}`;
}

async function init() {
  if (!username || !token) { window.location.href = '/'; return; }
  $('greeting').textContent = `${username}'s dashboard`;

  fetch(`/api/user/${username}`, { headers: AUTH })
    .then(r => {
      if (r.status === 401) { sessionStorage.clear(); window.location.href = '/'; return null; }
      return r.json();
    })
    .then(u => { if (u) $('rubyCount').textContent = u.rubies ?? 0; })
    .catch(() => {});

  fetch('/api/streak', { headers: AUTH })
    .then(r => r.json())
    .then(s => { $('statStreak').textContent = `🔥 ${s.current}`; })
    .catch(() => {});

  buildStartGrid();

  let data;
  try {
    const res = await fetch(`/api/progress/${username}`, { headers: AUTH });
    if (res.status === 401) { sessionStorage.clear(); window.location.href = '/'; return; }
    if (!res.ok) throw new Error('progress fetch failed');
    data = await res.json();
  } catch (e) {
    $('statAnswered').textContent = '0';
    return;
  }

  // Overall stats
  $('statAnswered').textContent = data.overall.answered;
  $('statAccuracy').textContent = data.overall.accuracy === null ? '—' : data.overall.accuracy + '%';
  $('statQuizzes').textContent  = data.recent_quizzes.length >= 10 ? '10+' : data.recent_quizzes.length;

  // Subjects
  if (data.subjects.length) {
    $('subjectEmpty').style.display = 'none';
    for (const s of data.subjects) {
      const row = document.createElement('div');
      row.className = 'subject-row';
      row.innerHTML = `
        <div class="subject-row__head">
          <span>${s.subject_name} · ${s.grade} კლასი</span>
          <span class="subject-row__pct subject-row__pct--${pctClass(s.accuracy)}">${s.accuracy}%</span>
        </div>
        <div class="bar"><div class="bar__fill bar__fill--${pctClass(s.accuracy)}" style="width:${s.accuracy}%"></div></div>
        <span class="subject-row__meta">${s.correct} / ${s.answered} correct</span>`;
      $('subjectList').appendChild(row);
    }
  }

  // Weak topics
  if (data.weak_topics.length) {
    $('weakEmpty').style.display = 'none';
    for (const t of data.weak_topics) {
      const row = document.createElement('div');
      row.className = 'weak-row';
      row.innerHTML = `
        <div class="weak-row__info">
          <span class="weak-row__topic">${t.topic}</span>
          <span class="weak-row__meta">${t.subject_name} · ${t.chapter} · ${t.accuracy}%</span>
        </div>`;
      const btn = document.createElement('a');
      btn.className = 'weak-row__btn';
      btn.textContent = 'Practice';
      btn.href = `./test.html?topicId=${t.topic_id}&grade=${t.grade}&subject=${t.subject}`;
      row.appendChild(btn);
      $('weakList').appendChild(row);
    }
  }

  // Recent quizzes
  if (data.recent_quizzes.length) {
    $('recentEmpty').style.display = 'none';
    for (const q of data.recent_quizzes) {
      const d   = new Date(q.finished_at);
      const row = document.createElement('div');
      row.className = 'recent-row';
      row.innerHTML = `
        <div class="recent-row__info">
          <span class="recent-row__topic">${q.topic}</span>
          <span class="recent-row__meta">${q.subject_name} · ${d.toLocaleDateString()}</span>
        </div>
        <span class="recent-row__score recent-row__score--${pctClass(q.pct)}">${q.score}/${q.total}</span>`;
      $('recentList').appendChild(row);
    }
  }

  // Daily activity
  if (data.daily.length) {
    $('dailyEmpty').style.display = 'none';
    const max = Math.max(...data.daily.map(d => d.answered));
    for (const d of data.daily) {
      const col = document.createElement('div');
      col.className = 'daily-col';
      const h = Math.max(8, Math.round((d.answered / max) * 100));
      col.innerHTML = `
        <div class="daily-col__bar daily-col__bar--${pctClass(d.accuracy)}" style="height:${h}%"
             title="${d.day.slice(0, 10)}: ${d.correct}/${d.answered} (${d.accuracy}%)"></div>
        <span class="daily-col__label">${new Date(d.day).getDate()}</span>`;
      $('dailyChart').appendChild(col);
    }
  }
}

function buildStartGrid() {
  for (const [slug, name] of SUBJECTS) {
    const card = document.createElement('div');
    card.className = 'start-card';
    const title = document.createElement('span');
    title.className = 'start-card__name';
    title.textContent = name;
    card.appendChild(title);

    const grades = document.createElement('div');
    grades.className = 'start-card__grades';
    for (const g of GRADES) {
      const a = document.createElement('a');
      a.textContent = g;
      a.href = `./grades/chapters.html?grade=${g}&subject=${slug}`;
      grades.appendChild(a);
    }
    card.appendChild(grades);
    $('startGrid').appendChild(card);
  }
}

init();
