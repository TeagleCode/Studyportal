const params  = new URLSearchParams(window.location.search);
const grade   = params.get('grade')   || '7';
const subject = params.get('subject') || 'math';

const subjectNames = {
  georgian:  'ქართული',
  math:      'მათემატიკა',
  english:   'ინგლისური',
  physics:   'ფიზიკა',
  chemistry: 'ქიმია',
  history:   'ისტორია',
};

const suffixes = { 7:'th', 8:'th', 9:'th', 10:'th', 11:'th' };
document.getElementById('navContext').textContent =
  `Grade ${grade} — ${subjectNames[subject] || subject}`;
document.getElementById('navBack').href =
  `./subjects.html?grade=${grade}`;
document.title = `StudyPortal - Grade ${grade} ${subjectNames[subject]}`;

async function load() {
  const list = document.getElementById('chaptersList');
  try {
    const res = await fetch(`/api/chapters/${grade}/${subject}`);
    const chapters = await res.json();

    if (!chapters.length) {
      list.innerHTML = '<p class="empty">No chapters available yet for this subject.</p>';
      return;
    }

    chapters.forEach((ch, i) => {
      const card = document.createElement('div');
      card.className = 'chapter-card';

      const header = document.createElement('button');
      header.className = 'chapter-card__header';
      header.innerHTML = `
        <span class="chapter-card__title">${ch.title}</span>
        <span class="chapter-card__chevron">›</span>
      `;

      const body = document.createElement('div');
      body.className = 'chapter-card__body';

      if (ch.topics.length) {
        const ul = document.createElement('ul');
        ul.className = 'topic-list';
        ch.topics.forEach(t => {
          const li = document.createElement('li');
          const link = document.createElement('a');
          link.className = 'topic-list__item';
          link.textContent = t.title;
          link.href = `../test.html?topicId=${t.id}&grade=${grade}&subject=${subject}`;
          li.appendChild(link);
          ul.appendChild(li);
        });
        body.appendChild(ul);
      } else {
        body.innerHTML = '<p class="empty">No topics yet.</p>';
      }

      header.addEventListener('click', () => {
        const open = card.classList.toggle('open');
        body.style.maxHeight = open ? body.scrollHeight + 'px' : '0';
      });

      card.appendChild(header);
      card.appendChild(body);
      list.appendChild(card);
    });

  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="empty">Failed to load chapters.</p>';
  }
}

load();
