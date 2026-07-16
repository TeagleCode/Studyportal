#!/usr/bin/env node
// Migration: add quiz_attempts + attempt_questions tables to an existing DB.
// Safe to run more than once (CREATE TABLE IF NOT EXISTS).
// Run: node scripts/migrate-attempts.js
const db = require('../db');

async function main() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NULL,
      topic_id    INT NOT NULL,
      score       INT NOT NULL DEFAULT 0,
      total       INT NOT NULL DEFAULT 0,
      started_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL,
      FOREIGN KEY (user_id)  REFERENCES users(id),
      FOREIGN KEY (topic_id) REFERENCES topics(id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS attempt_questions (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      attempt_id       INT NOT NULL,
      question_id      INT NOT NULL,
      generated_values LONGTEXT,
      submitted_answer TEXT,
      is_correct       TINYINT(1) NULL,
      answered_at      TIMESTAMP NULL,
      FOREIGN KEY (attempt_id)  REFERENCES quiz_attempts(id),
      FOREIGN KEY (question_id) REFERENCES questions(id)
    )
  `);
  console.log('✓ quiz_attempts and attempt_questions tables ready');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
