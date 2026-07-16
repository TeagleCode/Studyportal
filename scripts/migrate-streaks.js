#!/usr/bin/env node
// Migration: add user_streaks table and backfill it from existing
// quiz_attempts history (so past activity counts toward streaks).
// Safe to run more than once. Run: node scripts/migrate-streaks.js
const db = require('../db');

const CAP = 200;
// finished_at is stored with the DB server's clock (UTC in the container);
// shift to this machine's local timezone before taking the calendar date.
const TZ_OFFSET_MIN = -new Date().getTimezoneOffset();

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');            // YYYY-MM-DD
}

async function main() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_streaks (
      user_id          INT PRIMARY KEY,
      current_streak   INT NOT NULL DEFAULT 0,
      longest_streak   INT NOT NULL DEFAULT 0,
      last_active_date DATE NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const [users] = await db.execute('SELECT id FROM users');
  let backfilled = 0;

  for (const { id } of users) {
    const [days] = await db.execute(`
      SELECT DISTINCT DATE_FORMAT(finished_at + INTERVAL ? MINUTE, '%Y-%m-%d') AS day
      FROM quiz_attempts
      WHERE user_id = ? AND finished_at IS NOT NULL
      ORDER BY day
    `, [TZ_OFFSET_MIN, id]);
    if (!days.length) continue;

    const dayMs = 86400000;
    const stamps = days.map(r => Date.parse(r.day));

    let longest = 1, run = 1, current = 1;
    for (let i = 1; i < stamps.length; i++) {
      run = (stamps[i] - stamps[i - 1] === dayMs) ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    const last = days[days.length - 1].day;
    // current run = run ending on the most recent active day, but it only
    // still counts if that day is today or yesterday
    current = 1;
    for (let i = stamps.length - 1; i > 0; i--) {
      if (stamps[i] - stamps[i - 1] === dayMs) current++;
      else break;
    }
    if (last !== localDate(0) && last !== localDate(-1)) current = 0;

    await db.execute(`
      INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE current_streak = VALUES(current_streak),
                              longest_streak = GREATEST(longest_streak, VALUES(longest_streak)),
                              last_active_date = VALUES(last_active_date)
    `, [id, Math.min(current, CAP), Math.min(longest, CAP), last]);
    backfilled++;
  }

  console.log(`✓ user_streaks table ready (${backfilled} user(s) backfilled)`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
