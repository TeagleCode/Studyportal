#!/usr/bin/env node
// Bulk question importer. Format: docs/QUESTION-FORMAT.md
//
//   node scripts/import-questions.js content/<file>.json            append/upsert
//   node scripts/import-questions.js content/<file>.json --replace  wipe grade+subject first
//   node scripts/import-questions.js content/<file>.json --dry-run  validate only
//
// Validates everything (required fields, placeholder/variable consistency,
// formulas evaluate) before writing a single row.
const fs   = require('fs');
const path = require('path');
const { create, all } = require('mathjs');
const math = create(all);
const evaluate = math.evaluate;

const J = JSON.stringify;
const SUBJECT_SLUGS = ['georgian', 'math', 'english', 'physics', 'chemistry', 'history'];

// ── Validation ─────────────────────────────────────────────────────────────
const errors = [];
function err(where, msg) { errors.push(`${where}: ${msg}`); }

function sampleValues(variables, where) {
  const vals = {};
  const deferred = [];
  for (const [k, v] of Object.entries(variables)) {
    if (v && typeof v === 'object' && v.formula) { deferred.push([k, v]); continue; }
    if (!v || typeof v !== 'object' || !Number.isInteger(v.min) || !Number.isInteger(v.max)) {
      err(where, `variable "${k}" must be {min,max} integers or {formula}`);
      vals[k] = 1;
      continue;
    }
    if (v.min > v.max) err(where, `variable "${k}": min > max`);
    vals[k] = Math.floor(Math.random() * (v.max - v.min + 1)) + v.min;
  }
  for (const [k, v] of deferred) {
    try { vals[k] = +evaluate(v.formula, vals).toFixed(4); }
    catch (e) { err(where, `variable "${k}" formula "${v.formula}" failed: ${e.message}`); vals[k] = 1; }
  }
  return vals;
}

function checkFormula(formula, vals, where, label) {
  try {
    const r = evaluate(formula, vals);
    if (typeof r !== 'number' || !isFinite(r)) err(where, `${label} "${formula}" is not a finite number`);
    return r;
  } catch (e) { err(where, `${label} "${formula}" failed: ${e.message}`); return null; }
}

function checkPlaceholders(template, vals, where, label) {
  for (const m of String(template).matchAll(/\{(\w+)\}/g)) {
    const k = m[1];
    if (k !== 'answer' && !(k in vals)) err(where, `${label} uses {${k}} but no such variable`);
  }
}

function validateQuestion(q, where) {
  if (!q.text) err(where, 'missing "text"');
  if (!['multiple_choice', 'text'].includes(q.type)) { err(where, `bad "type": ${q.type}`); return; }
  if (q.difficulty !== undefined && !(Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 5))
    err(where, '"difficulty" must be an integer 1–5');

  if (q.parametric) {
    if (!q.variables || !Object.keys(q.variables).length) return err(where, 'parametric question needs "variables"');
    if (!q.formula) return err(where, 'parametric question needs "formula"');

    // 3 random draws to catch range-dependent failures
    for (let i = 0; i < 3; i++) {
      const vals = sampleValues(q.variables, where);
      if (errors.length && i > 0) break;
      checkFormula(q.formula, vals, where, 'formula');
      checkPlaceholders(q.text, vals, where, 'text');
      if (q.explanation_template) checkPlaceholders(q.explanation_template, vals, where, 'explanation_template');
      for (const s of q.explanation_steps || []) checkPlaceholders(s, vals, where, 'explanation_steps');
      if (q.type === 'multiple_choice') {
        if (!Array.isArray(q.options) || q.options.length < 2)
          { err(where, 'parametric MC needs 2+ option formulas'); break; }
        q.options.forEach((f, idx) => checkFormula(f, vals, where, `option[${idx}]`));
      }
    }
    if (q.explanation_steps && (!Array.isArray(q.explanation_steps) || q.explanation_steps.length < 2))
      err(where, '"explanation_steps" must be an array of 2+ steps');
  } else if (q.type === 'multiple_choice') {
    if (!Array.isArray(q.options) || q.options.length < 2) return err(where, 'static MC needs 2+ "options"');
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length)
      err(where, '"correct" must be a valid index into "options"');
    if (q.option_explanations) {
      for (const k of Object.keys(q.option_explanations)) {
        const idx = Number(k);
        if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length)
          err(where, `option_explanations key "${k}" is not a valid option index`);
        if (idx === q.correct) err(where, `option_explanations key "${k}" is the correct option`);
      }
    }
  } else {
    if (q.answer === undefined || q.answer === null || q.answer === '')
      err(where, 'static text question needs "answer"');
    if (q.acceptable && !Array.isArray(q.acceptable)) err(where, '"acceptable" must be an array');
  }

  const hasExplanation = q.explanation || q.explanation_template ||
    (q.explanation_steps && q.explanation_steps.length) ||
    (q.option_explanations && Object.keys(q.option_explanations).length);
  if (!hasExplanation) console.warn(`  ⚠ ${where}: no explanation — wrong answers will show nothing`);
}

function validateFile(data) {
  if (!Number.isInteger(data.grade)) err('file', '"grade" must be an integer (7–11)');
  if (!SUBJECT_SLUGS.includes(data.subject)) err('file', `"subject" must be one of: ${SUBJECT_SLUGS.join(', ')}`);
  if (!Array.isArray(data.chapters) || !data.chapters.length) return err('file', '"chapters" must be a non-empty array');

  data.chapters.forEach((ch, ci) => {
    const cw = `chapter[${ci}] "${ch.title || '?'}"`;
    if (!ch.title) err(cw, 'missing "title"');
    if (!Array.isArray(ch.topics) || !ch.topics.length) return err(cw, '"topics" must be a non-empty array');
    ch.topics.forEach((t, ti) => {
      const tw = `${cw} › topic[${ti}] "${t.title || '?'}"`;
      if (!t.title) err(tw, 'missing "title"');
      if (!Array.isArray(t.questions) || !t.questions.length) return err(tw, '"questions" must be a non-empty array');
      t.questions.forEach((q, qi) => validateQuestion(q, `${tw} › question[${qi}]`));
    });
  });
}

// ── DB mapping ─────────────────────────────────────────────────────────────
function toRow(q) {
  const row = {
    question_text: q.text,
    question_type: q.type,
    difficulty:    q.difficulty || 1,
    is_parametric: q.parametric ? 1 : 0,
    variables: null, answer_formula: null, correct_answer: null,
    acceptable_answers: null, option_formulas: null,
    explanation: q.explanation || null,
    explanation_template: q.explanation_template || null,
    explanation_steps: q.explanation_steps ? J(q.explanation_steps) : null,
    option_explanations: q.option_explanations ? J(q.option_explanations) : null,
    answers: null,
  };
  if (q.parametric) {
    row.variables      = J(q.variables);
    row.answer_formula = q.formula;
    if (q.type === 'multiple_choice')
      row.option_formulas = J(q.options.map((f, i) => ({ formula: f, is_correct: i === 0 })));
  } else if (q.type === 'multiple_choice') {
    row.answers = q.options.map((t, i) => [String(t), i === q.correct]);
  } else {
    row.correct_answer = String(q.answer);
    if (q.acceptable) row.acceptable_answers = J(q.acceptable.map(String));
  }
  return row;
}

async function main() {
  const args    = process.argv.slice(2);
  const file    = args.find(a => !a.startsWith('--'));
  const replace = args.includes('--replace');
  const dryRun  = args.includes('--dry-run');

  if (!file) {
    console.error('Usage: node scripts/import-questions.js content/<file>.json [--replace] [--dry-run]');
    process.exit(1);
  }

  let data;
  try { data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
  catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(1); }

  validateFile(data);
  const nQs = (data.chapters || []).flatMap(c => c.topics || []).reduce((n, t) => n + (t.questions?.length || 0), 0);
  if (errors.length) {
    console.error(`✗ ${errors.length} validation error(s):\n`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ Valid: grade ${data.grade} ${data.subject}, ${data.chapters.length} chapter(s), ${nQs} question(s)`);
  if (dryRun) { console.log('Dry run — nothing imported.'); process.exit(0); }

  const db   = require('../db');
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [[grade]] = await conn.execute('SELECT id FROM grades WHERE grade_num = ?', [data.grade]);
    const [[subj]]  = await conn.execute('SELECT id FROM subjects WHERE slug = ?', [data.subject]);
    if (!grade || !subj) throw new Error('grade/subject not seeded — run scripts/seed-content.js first');

    if (replace) {
      const [chs] = await conn.execute('SELECT id FROM chapters WHERE grade_id=? AND subject_id=?', [grade.id, subj.id]);
      for (const ch of chs) {
        const [tops] = await conn.execute('SELECT id FROM topics WHERE chapter_id=?', [ch.id]);
        for (const t of tops) {
          await conn.execute('DELETE aq FROM attempt_questions aq JOIN questions q ON aq.question_id=q.id WHERE q.topic_id=?', [t.id]);
          await conn.execute('DELETE FROM quiz_attempts WHERE topic_id=?', [t.id]);
          await conn.execute('DELETE FROM answers WHERE question_id IN (SELECT id FROM questions WHERE topic_id=?)', [t.id]);
          await conn.execute('DELETE FROM questions WHERE topic_id=?', [t.id]);
        }
        await conn.execute('DELETE FROM topics WHERE chapter_id=?', [ch.id]);
      }
      await conn.execute('DELETE FROM chapters WHERE grade_id=? AND subject_id=?', [grade.id, subj.id]);
      console.log('… replaced existing content for this grade+subject');
    }

    let inserted = 0;
    for (let ci = 0; ci < data.chapters.length; ci++) {
      const ch = data.chapters[ci];
      let [[chRow]] = await conn.execute(
        'SELECT id FROM chapters WHERE grade_id=? AND subject_id=? AND title=?', [grade.id, subj.id, ch.title]);
      if (!chRow) {
        const [r] = await conn.execute(
          'INSERT INTO chapters (grade_id, subject_id, title, order_num) VALUES (?,?,?,?)',
          [grade.id, subj.id, ch.title, ci + 1]);
        chRow = { id: r.insertId };
      }
      for (let ti = 0; ti < ch.topics.length; ti++) {
        const t = ch.topics[ti];
        let [[tRow]] = await conn.execute(
          'SELECT id FROM topics WHERE chapter_id=? AND title=?', [chRow.id, t.title]);
        if (!tRow) {
          const [r] = await conn.execute(
            'INSERT INTO topics (chapter_id, title, order_num) VALUES (?,?,?)', [chRow.id, t.title, ti + 1]);
          tRow = { id: r.insertId };
        }
        for (const q of t.questions) {
          const row = toRow(q);
          const [r] = await conn.execute(
            `INSERT INTO questions (topic_id, question_text, question_type, difficulty, is_parametric,
             variables, answer_formula, correct_answer, acceptable_answers, option_formulas,
             explanation, explanation_template, explanation_steps, option_explanations)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [tRow.id, row.question_text, row.question_type, row.difficulty, row.is_parametric,
             row.variables, row.answer_formula, row.correct_answer, row.acceptable_answers,
             row.option_formulas, row.explanation, row.explanation_template,
             row.explanation_steps, row.option_explanations]);
          if (row.answers)
            for (const [text, correct] of row.answers)
              await conn.execute('INSERT INTO answers (question_id, answer_text, is_correct) VALUES (?,?,?)',
                [r.insertId, text, correct ? 1 : 0]);
          inserted++;
        }
      }
    }

    await conn.commit();
    console.log(`✓ Imported ${inserted} question(s)`);
    process.exit(0);
  } catch (e) {
    await conn.rollback();
    console.error('✗ Import failed, rolled back:', e.message);
    process.exit(1);
  }
}

main();
