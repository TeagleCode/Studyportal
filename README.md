# StudyPortal 2.0 — Login Backend

## Your project structure after integrating these files:

```
STUDYPORTAL 2.0/
├── img/
│   └── portal.png
├── pages/
├── scripts/
│   └── login.js          ← replace with the one from this zip
├── style/login/
│   ├── login.css
│   ├── login.css.map
│   └── login.scss
├── login.html            ← your existing file, no changes needed
├── db.js                 ← NEW: add to root
├── server.js             ← NEW: add to root
├── schema.sql            ← NEW: add to root, run once in MySQL
└── package.json          ← NEW: add to root
```

## Setup

1. Place all files from this zip into your project root (except `scripts/login.js` which goes in your existing `scripts/` folder).

2. Install dependencies:
   ```
   npm install
   ```

3. Open `db.js` and fill in your MySQL credentials:
   ```js
   user: 'your_db_user',
   password: 'your_db_password',
   database: 'your_db_name',
   ```

4. Run `schema.sql` once in your MySQL client to create the users table.

5. Start the server:
   ```
   npm start
   ```

6. Open http://localhost:3000 — your login page will appear.
