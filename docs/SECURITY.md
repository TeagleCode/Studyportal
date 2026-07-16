# Security notes — StudyPortal 2.0

Result of the security pass (plan task, 11 Jul 2026). Verified / fixed:

## Verified
- **Correct answers never reach the browser.** `/api/test/start` sends only
  `question_text`, `question_type`, and `options: [{id, answer_text}]`.
  Correct option ids, `answer_formula`, `correct_answer`, `acceptable_answers`,
  and explanations stay in the server-side session (`testSessions`).
- **All grading is server-side.** The client posts the raw answer to
  `/api/test/answer`; correctness, the correct answer, and explanations come
  back only *after* the answer is recorded.
- **No `eval()` anywhere.** All formula evaluation goes through mathjs.

## Fixed in this pass
- **Static file leak (critical).** `express.static` served the project root:
  `GET /.env` exposed the DB password, and `/scripts/seed-*.js` exposed every
  question with its correct answer. Now only `pages/`, `style/`, `img/`,
  `uploads/`, and a whitelist of client scripts are served.
- **Score farming.** `/api/test/answer` could be called repeatedly for the same
  `questionIndex`, incrementing the score each time (→ unlimited rubies).
  Re-answers are now rejected with `409 already_answered`.
- **mathjs hardening.** Formulas evaluate through a restricted instance with
  `import`, `createUnit`, `evaluate`, `parse`, `simplify`, `derivative`
  disabled (the mitigation recommended by mathjs' security docs). Formulas are
  author-written, not user input, so this is defense in depth.

## Fixed in the loose-ends pass (17 Jul 2026)
- **Session tokens.** `/api/login` now issues a bearer token (7-day TTL,
  in-memory). All user-specific endpoints (`/api/user/*`, `/api/progress/*`)
  require it and only serve the token's own account (403 otherwise).
  `/api/test/start` credits rubies to the token's user and ignores any
  client-sent username; guests can still take quizzes.
- **Login rate limiting.** Max 10 attempts per IP per 15 minutes → 429.
- Avatar upload now requires auth (was: any client could overwrite any
  user's avatar).

## Known gaps (accepted for now, revisit before real users)
- Tokens are in-memory: a server restart logs everyone out (acceptable).
- Tokens live in `sessionStorage` and go over plain HTTP locally — use HTTPS
  when deployed.
- `.env` is git-ignored but present locally — rotate the DB password if it
  ever leaks.
