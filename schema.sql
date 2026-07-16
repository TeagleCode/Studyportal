-- ── Users ────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE,
  first_name    VARCHAR(100),
  last_name     VARCHAR(100),
  avatar_url    VARCHAR(500),
  rubies        INT DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Grades (7–11) ────────────────────────────────────────────────────────
CREATE TABLE grades (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  grade_num TINYINT NOT NULL UNIQUE
);

-- ── Subjects ─────────────────────────────────────────────────────────────
CREATE TABLE subjects (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(50)  NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL
);

-- ── Chapters ─────────────────────────────────────────────────────────────
CREATE TABLE chapters (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  grade_id   INT NOT NULL,
  subject_id INT NOT NULL,
  title      VARCHAR(255) NOT NULL,
  order_num  INT DEFAULT 0,
  FOREIGN KEY (grade_id)   REFERENCES grades(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

-- ── Topics ───────────────────────────────────────────────────────────────
CREATE TABLE topics (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  chapter_id INT NOT NULL,
  title      VARCHAR(255) NOT NULL,
  order_num  INT DEFAULT 0,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- ── Questions ────────────────────────────────────────────────────────────
-- question_type: 'multiple_choice' | 'text'
-- is_parametric: 1 = generated values each attempt, 0 = static
--
-- Static MC:   fill answers table; option_formulas NULL
-- Parametric:  variables JSON, answer_formula mathjs expr,
--              option_formulas JSON array [{formula,is_correct}]
--
-- Explanations (shown on wrong answer):
--   explanation          – plain text (static questions)
--   explanation_template – template with {var} placeholders (parametric)
--   explanation_steps    – JSON array of step strings/templates; shown
--                          one at a time with "Show next step" button
--   option_explanations  – JSON object keyed by option index:
--                          {"0": "Why A is wrong", "2": "Why C is wrong"}
CREATE TABLE questions (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  topic_id             INT NOT NULL,
  question_text        TEXT NOT NULL,
  question_type        ENUM('multiple_choice','text') DEFAULT 'multiple_choice',
  difficulty           TINYINT DEFAULT 1,
  is_parametric        TINYINT(1) DEFAULT 0,
  variables            LONGTEXT,          -- JSON: {"a":{"min":1,"max":9}, "b":{"formula":"a*2"}}
  answer_formula       TEXT,              -- mathjs expression using variable names
  correct_answer       TEXT,              -- for static text questions
  acceptable_answers   LONGTEXT,          -- JSON array of also-acceptable strings
  option_formulas      LONGTEXT,          -- JSON [{formula,is_correct}, ...]; index 0 = correct
  explanation          TEXT,              -- plain text explanation (static)
  explanation_template TEXT,              -- template with {var}/{answer} placeholders (parametric)
  explanation_steps    TEXT,              -- JSON array of step strings/templates
  option_explanations  LONGTEXT,          -- JSON {"optionIndex": "explanation text"}
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

-- ── Answers (for static MC questions) ────────────────────────────────────
CREATE TABLE answers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  question_id INT NOT NULL,
  answer_text TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- ── Quiz attempts ─────────────────────────────────────────────────────────
-- One row per quiz a student starts. user_id is NULL for guests.
CREATE TABLE quiz_attempts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,
  topic_id    INT NOT NULL,
  score       INT NOT NULL DEFAULT 0,
  total       INT NOT NULL DEFAULT 0,
  started_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  FOREIGN KEY (user_id)  REFERENCES users(id),
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

-- ── User streaks ──────────────────────────────────────────────────────────
-- Duolingo-style daily streak: bumped when a logged-in user finishes a quiz.
-- Kept as its own table (not derived from quiz_attempts) so streak history
-- survives content re-imports that delete old attempts. Streak caps at 200.
CREATE TABLE user_streaks (
  user_id          INT PRIMARY KEY,
  current_streak   INT NOT NULL DEFAULT 0,
  longest_streak   INT NOT NULL DEFAULT 0,
  last_active_date DATE NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ── Attempt questions ─────────────────────────────────────────────────────
-- One row per question served in an attempt. generated_values stores the
-- exact parametric values the student saw, so grading and explanations can
-- always be reproduced for that attempt.
CREATE TABLE attempt_questions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id       INT NOT NULL,
  question_id      INT NOT NULL,
  generated_values LONGTEXT,          -- JSON: {"a":4,"b":7} (NULL for static)
  submitted_answer TEXT,
  is_correct       TINYINT(1) NULL,   -- NULL = never answered
  answered_at      TIMESTAMP NULL,
  FOREIGN KEY (attempt_id)  REFERENCES quiz_attempts(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);
