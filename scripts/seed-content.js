const db = require('../db');

async function seed() {
  // Grades
  for (const n of [7, 8, 9, 10, 11]) {
    await db.execute(
      'INSERT INTO grades (grade_num) VALUES (?) ON DUPLICATE KEY UPDATE grade_num=grade_num',
      [n]
    );
  }

  // Subjects
  const subjects = [
    ['georgian',  'ქართული'],
    ['math',      'მათემატიკა'],
    ['english',   'ინგლისური'],
    ['physics',   'ფიზიკა'],
    ['chemistry', 'ქიმია'],
    ['history',   'ისტორია'],
  ];
  for (const [slug, display_name] of subjects) {
    await db.execute(
      'INSERT INTO subjects (slug, display_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)',
      [slug, display_name]
    );
  }

  // Sample content: Grade 7 Math
  const [[grade]] = await db.execute('SELECT id FROM grades WHERE grade_num = 7');
  const [[subject]] = await db.execute('SELECT id FROM subjects WHERE slug = "math"');

  const chapters = [
    {
      title: 'თავი 1: ბუნებრივი რიცხვები',
      topics: [
        {
          title: 'მიმატება და გამოკლება',
          questions: [
            { q: 'რა არის 15 + 27?',       answers: ['42', '41', '43', '40'], correct: 0 },
            { q: 'რა არის 100 - 38?',      answers: ['62', '72', '58', '68'], correct: 0 },
            { q: 'რა არის 56 + 44?',       answers: ['100', '99', '101', '98'], correct: 0 },
            { q: 'რა არის 200 - 75?',      answers: ['125', '135', '115', '120'], correct: 0 },
            { q: 'რა არის 123 + 456?',     answers: ['579', '589', '569', '599'], correct: 0 },
          ],
        },
        {
          title: 'გამრავლება და გაყოფა',
          questions: [
            { q: 'რა არის 6 × 7?',         answers: ['42', '36', '48', '54'], correct: 0 },
            { q: 'რა არის 81 ÷ 9?',        answers: ['9', '8', '7', '11'],   correct: 0 },
            { q: 'რა არის 12 × 12?',       answers: ['144', '124', '132', '148'], correct: 0 },
            { q: 'რა არის 144 ÷ 12?',      answers: ['12', '11', '13', '14'], correct: 0 },
            { q: 'რა არის 25 × 4?',        answers: ['100', '90', '110', '95'], correct: 0 },
          ],
        },
      ],
    },
    {
      title: 'თავი 2: წილადები',
      topics: [
        {
          title: 'მარტივი წილადები',
          questions: [
            { q: 'რა არის 1/2 + 1/2?',    answers: ['1', '1/4', '2', '1/2'], correct: 0 },
            { q: 'რა არის 3/4 - 1/4?',    answers: ['1/2', '2/4', '1/4', '3/8'], correct: 0 },
            { q: 'რომელი არის უდიდესი?',  answers: ['3/4', '1/2', '2/3', '1/4'], correct: 0 },
            { q: 'რა არის 2/3 × 3?',      answers: ['2', '3', '1', '6'],     correct: 0 },
            { q: 'რა არის 1/4 × 8?',      answers: ['2', '4', '1', '3'],     correct: 0 },
          ],
        },
        {
          title: 'ათწილადები',
          questions: [
            { q: 'რა არის 0.5 + 0.5?',    answers: ['1', '0.10', '1.5', '0.55'], correct: 0 },
            { q: 'რა არის 1.5 × 2?',      answers: ['3', '2.5', '3.5', '2'],    correct: 0 },
            { q: 'რა არის 2.4 ÷ 0.8?',    answers: ['3', '2', '4', '1.6'],      correct: 0 },
            { q: 'რა არის 0.25 × 4?',     answers: ['1', '0.4', '2', '0.8'],    correct: 0 },
            { q: 'რა არის 3.6 - 1.8?',    answers: ['1.8', '2.0', '1.6', '2.2'], correct: 0 },
          ],
        },
      ],
    },
  ];

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    const [chResult] = await db.execute(
      'INSERT INTO chapters (grade_id, subject_id, title, order_num) VALUES (?, ?, ?, ?)',
      [grade.id, subject.id, ch.title, ci + 1]
    );
    const chapterId = chResult.insertId;

    for (let ti = 0; ti < ch.topics.length; ti++) {
      const t = ch.topics[ti];
      const [tResult] = await db.execute(
        'INSERT INTO topics (chapter_id, title, order_num) VALUES (?, ?, ?)',
        [chapterId, t.title, ti + 1]
      );
      const topicId = tResult.insertId;

      for (const qd of t.questions) {
        const [qResult] = await db.execute(
          'INSERT INTO questions (topic_id, question_text) VALUES (?, ?)',
          [topicId, qd.q]
        );
        const questionId = qResult.insertId;

        for (let ai = 0; ai < qd.answers.length; ai++) {
          await db.execute(
            'INSERT INTO answers (question_id, answer_text, is_correct) VALUES (?, ?, ?)',
            [questionId, qd.answers[ai], ai === qd.correct]
          );
        }
      }
    }
  }

  console.log('Content seeded.');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
