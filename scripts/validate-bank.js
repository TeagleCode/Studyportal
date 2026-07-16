#!/usr/bin/env node
// Reviews every question already in the database, the way the engine will use
// it: generates variables (20 draws for parametric), evaluates all formulas,
// fills all templates, and checks MC questions have exactly one correct
// option. Run after seeding/importing:  node scripts/validate-bank.js
const db = require('../db');
const { create, all } = require('mathjs');
const math = create(all);
const evaluate = math.evaluate;

const problems = [];

function generateValues(variables) {
  const vals = {};
  const deferred = [];
  for (const [k, r] of Object.entries(variables)) {
    if (r.formula) deferred.push([k, r]);
    else vals[k] = Math.floor(Math.random() * (r.max - r.min + 1)) + r.min;
  }
  for (const [k, r] of deferred) vals[k] = +evaluate(r.formula, vals).toFixed(4);
  return vals;
}

function unfilled(template, vals) {
  const left = [];
  for (const m of String(template).matchAll(/\{(\w+)\}/g))
    if (m[1] !== 'answer' && !(m[1] in vals)) left.push(m[1]);
  return left;
}

async function main() {
  const [rows] = await db.execute(`
    SELECT q.*, t.title AS topic, c.title AS chapter, s.slug AS subject, g.grade_num
    FROM questions q
    JOIN topics t   ON q.topic_id = t.id
    JOIN chapters c ON t.chapter_id = c.id
    JOIN subjects s ON c.subject_id = s.id
    JOIN grades g   ON c.grade_id = g.id
  `);
  console.log(`Reviewing ${rows.length} questions…`);

  for (const q of rows) {
    const where = `[q${q.id}] g${q.grade_num} ${q.subject} › ${q.chapter} › ${q.topic}`;
    const flag  = msg => problems.push(`${where}: ${msg}`);

    const hasExplanation = q.explanation || q.explanation_template ||
      q.explanation_steps || q.option_explanations;
    if (!hasExplanation) flag('no explanation of any kind');

    if (q.is_parametric) {
      let vars;
      try { vars = JSON.parse(q.variables || '{}'); }
      catch { flag('variables JSON does not parse'); continue; }
      if (!Object.keys(vars).length) { flag('parametric but no variables'); continue; }

      for (let i = 0; i < 20; i++) {
        let vals;
        try { vals = generateValues(vars); }
        catch (e) { flag(`variable generation failed: ${e.message}`); break; }

        let answer = null;
        if (q.answer_formula) {
          try {
            answer = +evaluate(q.answer_formula, vals).toFixed(4);
            if (!isFinite(answer)) { flag(`answer_formula gave ${answer} for ${JSON.stringify(vals)}`); break; }
          } catch (e) { flag(`answer_formula failed: ${e.message}`); break; }
        } else { flag('parametric but no answer_formula'); break; }

        const uf = unfilled(q.question_text, vals);
        if (uf.length) { flag(`question_text has undefined placeholder(s): {${uf.join('}, {')}}`); break; }
        if (q.explanation_template) {
          const ue = unfilled(q.explanation_template, vals);
          if (ue.length) { flag(`explanation_template has undefined placeholder(s): {${ue.join('}, {')}}`); break; }
        }

        if (q.question_type === 'multiple_choice') {
          let formulas;
          try { formulas = JSON.parse(q.option_formulas || '[]'); }
          catch { flag('option_formulas JSON does not parse'); break; }
          if (formulas.length < 2) { flag('parametric MC with <2 option formulas'); break; }
          if (formulas.filter(f => f.is_correct).length !== 1) { flag('must have exactly 1 correct option formula'); break; }

          const opts = [];
          let bad = false;
          for (const f of formulas) {
            try { opts.push({ v: +evaluate(f.formula, vals).toFixed(2), correct: !!f.is_correct }); }
            catch (e) { flag(`option formula "${f.formula}" failed: ${e.message}`); bad = true; break; }
          }
          if (bad) break;
          const correctOpt = opts.find(o => o.correct);
          if (Math.abs(correctOpt.v - answer) > 0.05)
            { flag(`correct option (${correctOpt.v}) ≠ answer_formula (${answer}) for ${JSON.stringify(vals)}`); break; }
          const dup = opts.filter(o => !o.correct && Math.abs(o.v - correctOpt.v) < 1e-9);
          if (dup.length && i === 19)
            console.warn(`  ⚠ ${where}: a distractor can equal the correct value (last draw ${JSON.stringify(vals)})`);
        }
      }
    } else if (q.question_type === 'multiple_choice') {
      const [answers] = await db.execute('SELECT is_correct FROM answers WHERE question_id = ?', [q.id]);
      if (answers.length < 2) flag('static MC with <2 answers');
      if (answers.filter(a => a.is_correct).length !== 1) flag('must have exactly 1 correct answer row');
    } else {
      if (!q.correct_answer) flag('static text with no correct_answer');
      if (q.acceptable_answers) {
        try { if (!Array.isArray(JSON.parse(q.acceptable_answers))) flag('acceptable_answers is not an array'); }
        catch { flag('acceptable_answers JSON does not parse'); }
      }
    }
  }

  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s):`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✓ Question bank looks good');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
