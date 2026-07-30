# StudyPortal error codes

Every error the website shows ends with a code in brackets, e.g.
`Incorrect password. Please try again. [SP-101]`. Look the code up here to
know exactly what went wrong. The server also returns the code in every error
response as `{ "error": "...", "code": "SP-xxx" }` (see `ERROR_CODES` in
`server.js` — keep the two in sync).

## SP-0xx — connection problems (detected by the browser)

| Code | Meaning | What to do |
|------|---------|------------|
| SP-000 | The browser could not reach the server at all. The Node server is down, the tunnel is closed, or the visitor has no internet. | Start the server (`npm start`) and/or the tunnel (`bash scripts/share.sh`); check your connection. |

## SP-1xx — accounts, login & signup

| Code | Meaning | What to do |
|------|---------|------------|
| SP-100 | Login: no account with that username exists. | Check the spelling or sign up first. |
| SP-101 | Login / password change: the password is wrong. | Try again; case matters. |
| SP-102 | Too many attempts from this device (10 per 15 minutes). Login and signup share this limit. | Wait 15 minutes and try again. |
| SP-103 | Your session is invalid — expired (7 days), the server restarted, or you logged in on another device (only one active session per account is allowed). | Log in again. |
| SP-104 | You tried to access another user's data (their profile or progress). | Only your own account's data is accessible. |
| SP-105 | The username is invalid: it must be 3–30 characters using letters (Latin or Georgian), digits, `_`, `.` or `-`. | Pick a valid username. |
| SP-106 | The password is too weak: minimum 6 characters. | Pick a longer password. |
| SP-107 | That username is already taken (signup or username change). | Pick a different name. |
| SP-108 | Signup: the two password fields don't match (checked in the browser). | Retype them. |
| SP-109 | Avatar upload: no file was selected. | Choose an image first (max 2 MB). |

## SP-2xx — quizzes

| Code | Meaning | What to do |
|------|---------|------------|
| SP-200 | The quiz session doesn't exist — it expired (2 h), was already finished, or the server restarted mid-quiz. | Start the quiz again. |
| SP-201 | The submitted question number isn't part of this quiz. Usually a client bug. | Reload and retry; report if it repeats. |
| SP-202 | This question was already answered — answers can't be changed or resubmitted. | Move on to the next question. |

## SP-3xx — missing data

| Code | Meaning | What to do |
|------|---------|------------|
| SP-300 | The requested user/data was not found (e.g. account deleted). | Check the account still exists. |

## SP-5xx — server problems

| Code | Meaning | What to do |
|------|---------|------------|
| SP-500 | Unexpected server error. Details are in the server console/log. | Check the server log; report what you were doing. |
| SP-501 | The server is running but **cannot reach the database** — the MariaDB container is stopped or unreachable. This is the usual cause of "everything suddenly broken" after a reboot. | `podman start studyportal-test-db` (or `bash scripts/share.sh`, which now starts it automatically). |
