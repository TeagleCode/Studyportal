#!/usr/bin/env node
// One-off maintenance for grade-7 math:
//   1. Numbers chapters "N. title" and topics "N.M title" (book order) and
//      fixes chapter order_num, which the importer set to 1 for every file.
//   2. Rebalances chapters 1–3 (authored 100% multiple-choice) toward a
//      50/50 multiple-choice / open-answer split, so the balanced quiz draw
//      has open questions to pick from.
//
// Conversion rules — only questions that stand alone without options:
//   • parametric MC with an answer_formula  → open (answer is computed)
//   • static MC whose correct answer is a bare number → open
//   • never "რომელი…" (which-of-these) questions, never text answers
//
// Run: node scripts/rebalance-and-number.js [--dry-run]
const db = require('../db');

const DRY = process.argv.includes('--dry-run');

// Book order → title (matched by prefix against what's in the DB)
const BOOK_ORDER = [
  'გამეორება. ნატურალური რიცხვები',
  'რაციონალური რიცხვები. მონაცემთა',
  'ცვლადიანი გამოსახულება',
  'კოორდინატები. გეომეტრიული',
  'სიდიდეებს შორის დამოკიდებულებები',
  'სტატისტიკის ელემენტები',
];

const stripNum = s => s.replace(/^\s*\d+(\.\d+)?\.?\s+/, '');   // idempotent
const isWhichQuestion = t => /რომელი|რომელია|რომელ\s/.test(t);
// bare number, optional Georgian thousands dots, decimal comma, unit suffix
const NUMERIC_ANSWER = /^[-−]?\d{1,3}(\.\d{3})*(,\d+)?\s*(სმ|მ|კმ|კგ|გრ|ლარი|წთ|სთ|°|%)?$/;

async function main() {
  const [[grade]] = await db.execute('SELECT id FROM grades WHERE grade_num = 7');
  const [[subj]]  = await db.execute("SELECT id FROM subjects WHERE slug = 'math'");
  const [chapters] = await db.execute(
    'SELECT id, title, order_num FROM chapters WHERE grade_id=? AND subject_id=?', [grade.id, subj.id]);

  // ── 1. numbering ────────────────────────────────────────────────────────
  for (let i = 0; i < BOOK_ORDER.length; i++) {
    const num = i + 1;
    const ch = chapters.find(c => stripNum(c.title).startsWith(BOOK_ORDER[i]));
    if (!ch) { console.warn(`⚠ chapter not found for "${BOOK_ORDER[i]}"`); continue; }

    const newTitle = `${num}. ${stripNum(ch.title)}`;
    if (!DRY) await db.execute('UPDATE chapters SET title=?, order_num=? WHERE id=?', [newTitle, num, ch.id]);
    console.log(`თავი ${num}: ${newTitle}`);

    const [topics] = await db.execute(
      'SELECT id, title, order_num FROM topics WHERE chapter_id=? ORDER BY order_num, id', [ch.id]);
    for (let j = 0; j < topics.length; j++) {
      const t = topics[j];
      const tTitle = `${num}.${j + 1}. ${stripNum(t.title)}`;
      if (!DRY) await db.execute('UPDATE topics SET title=?, order_num=? WHERE id=?', [tTitle, j + 1, t.id]);
    }
    console.log(`   ${topics.length} თემა დანომრილია`);
  }

  // ── 2. rebalance chapters 1–3 ───────────────────────────────────────────
  let converted = 0, short = [];
  for (let i = 0; i < 3; i++) {
    const ch = chapters.find(c => stripNum(c.title).startsWith(BOOK_ORDER[i]));
    if (!ch) continue;
    const [topics] = await db.execute('SELECT id, title FROM topics WHERE chapter_id=? ORDER BY order_num', [ch.id]);

    for (const t of topics) {
      const [qs] = await db.execute(
        'SELECT id, question_text, question_type, is_parametric, answer_formula FROM questions WHERE topic_id=? ORDER BY id', [t.id]);
      const total   = qs.length;
      const already = qs.filter(q => q.question_type === 'text').length;
      const target  = Math.floor(total / 2) - already;          // how many more open we need
      if (target <= 0) continue;

      // candidates, best first
      const paramCand = [], staticCand = [];
      for (const q of qs) {
        if (q.question_type !== 'multiple_choice') continue;
        if (isWhichQuestion(q.question_text)) continue;
        if (q.is_parametric) {
          if (q.answer_formula) paramCand.push(q);
        } else {
          const [[ans]] = await db.execute(
            'SELECT answer_text FROM answers WHERE question_id=? AND is_correct=1 LIMIT 1', [q.id]);
          if (ans && NUMERIC_ANSWER.test(String(ans.answer_text).trim()))
            staticCand.push({ ...q, correct: String(ans.answer_text).trim() });
        }
      }

      const picked = [...paramCand, ...staticCand].slice(0, target);
      if (picked.length < target) short.push(`${t.title}: ${picked.length}/${target}`);

      for (const q of picked) {
        if (DRY) { converted++; continue; }
        if (q.is_parametric) {
          await db.execute(
            "UPDATE questions SET question_type='text', option_formulas=NULL, option_explanations=NULL WHERE id=?", [q.id]);
        } else {
          // keep both the plain and the dotted form as acceptable answers
          const plain = q.correct.replace(/\./g, '');
          const accept = [...new Set([q.correct, plain])];
          await db.execute(
            "UPDATE questions SET question_type='text', correct_answer=?, acceptable_answers=?, option_explanations=NULL WHERE id=?",
            [q.correct, JSON.stringify(accept), q.id]);
          await db.execute('DELETE FROM answers WHERE question_id=?', [q.id]);
        }
        converted++;
      }
    }
  }

  console.log(`\n${DRY ? '[dry run] would convert' : '✓ converted'} ${converted} question(s) to open answers`);
  if (short.length) {
    console.log(`⚠ ${short.length} topic(s) could not reach 50/50 with safe conversions:`);
    for (const s of short) console.log('   - ' + s);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
