# Question-writing format (locked 13 Jul 2026)

This is the single source of truth for writing StudyPortal questions. Every
subject/grade is authored as one JSON file in `content/` and loaded with:

```
node scripts/import-questions.js content/<file>.json            # validate + import (append)
node scripts/import-questions.js content/<file>.json --replace  # wipe grade+subject first
node scripts/import-questions.js content/<file>.json --dry-run  # validate only, no DB writes
```

See `content/example-questions.json` for a working file with all 4 types.

## File shape

```json
{
  "grade": 7,
  "subject": "math",
  "chapters": [
    {
      "title": "თავი 1: ბუნებრივი რიცხვები",
      "topics": [
        {
          "title": "მიმატება და გამოკლება",
          "questions": [ /* question objects, see below */ ]
        }
      ]
    }
  ]
}
```

- `subject` is the slug from the `subjects` table
  (`math`, `georgian`, `english`, `physics`, `chemistry`, `history`).
- Chapters and topics keep the order they appear in the file.
- Target size: ~20 questions per topic so a 10-question quiz stays varied.

## The 4 question types

### 1. Static multiple choice (humanities, facts)

```json
{
  "type": "multiple_choice",
  "text": "რომელ წელს დაარსდა თბილისი?",
  "options": ["V საუკუნეში", "X საუკუნეში", "III საუკუნეში", "XII საუკუნეში"],
  "correct": 0,
  "explanation": "თბილისი V საუკუნეში დაარსდა ვახტანგ გორგასლის მიერ.",
  "option_explanations": { "1": "X საუკუნეში თბილისი უკვე დედაქალაქი იყო." },
  "difficulty": 1
}
```

- `options`: 2–6 strings. `correct`: index into `options`.
- `explanation` (recommended): shown on any wrong answer.
- `option_explanations` (optional): keyed by the index of the **wrong** option
  the student picked; shown *in addition to* `explanation`.

### 2. Static text answer

```json
{
  "type": "text",
  "text": "დაასახელეთ საქართველოს დედაქალაქი.",
  "answer": "თბილისი",
  "acceptable": ["tbilisi", "თბილისში"],
  "explanation": "საქართველოს დედაქალაქი თბილისია."
}
```

- Grading normalizes both sides: lowercase, trim, punctuation stripped,
  Unicode NFC (Georgian-safe). Numbers also match numerically
  ("0.5" = "1/2" = "0,5", tolerance ±1%).
- `acceptable` (optional): synonyms / alternate spellings / other scripts.

### 3. Parametric text (numeric answer)

```json
{
  "type": "text",
  "parametric": true,
  "text": "რას უდრის {a} + {b}?",
  "variables": { "a": { "min": 12, "max": 89 }, "b": { "min": 12, "max": 89 } },
  "formula": "a + b",
  "explanation_template": "შეკრიბეთ: {a} + {b} = {answer}.",
  "explanation_steps": [
    "ჯერ შეკრიბეთ ერთეულები.",
    "შემდეგ ათეულები.",
    "{a} + {b} = {answer}."
  ]
}
```

- `variables`: each is `{ "min": int, "max": int }` (random integer, inclusive)
  or `{ "formula": "a * 2" }` (derived from earlier variables).
- `formula`: mathjs expression over the variables → the correct answer.
- Templates (`text`, `explanation_template`, steps) use `{var}` placeholders;
  `{answer}` is also available in explanations. Every placeholder must be a
  defined variable — the importer rejects the file otherwise.
- `explanation_steps` (optional, recommended for multi-step problems): shown
  one at a time ("Show next step"). If present, use 2+ steps.

### 4. Parametric multiple choice

```json
{
  "type": "multiple_choice",
  "parametric": true,
  "text": "რას უდრის {a} × {b}?",
  "variables": { "a": { "min": 3, "max": 12 }, "b": { "min": 3, "max": 12 } },
  "formula": "a * b",
  "options": ["a * b", "a * b + a", "a * b - b", "a + b"],
  "explanation_template": "{a} × {b} = {answer}."
}
```

- `options` are **formulas**, not text. **Index 0 is the correct one**; the
  rest are distractors (write them as typical mistakes: forgot a carry,
  added instead of multiplied, off by one factor…).
- Distractors that collide with the correct value for some variable draws are
  fine occasionally, but check ranges so it's rare.

## Checklist before importing a file

1. Every question has `type` and `text`.
2. MC static: `options` + `correct`. MC parametric: `formula` + option
   formulas with the correct one at index 0.
3. Text static: `answer`. Text parametric: `variables` + `formula`.
4. Every `{placeholder}` is a defined variable (or `answer`).
5. Wrong answers always have something to show: `explanation`,
   `explanation_template`, or `option_explanations`.
6. `difficulty` 1–5 (default 1).
7. Run with `--dry-run` — the importer validates all of the above and
   test-evaluates every formula with random variable draws before touching
   the database.
