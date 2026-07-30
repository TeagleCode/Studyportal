document.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const confirm  = document.getElementById('confirm').value;

  const existing = document.getElementById('signup-error');
  if (existing) existing.remove();

  // Error codes are documented in docs/ERROR-CODES.md
  function showError(message, code) {
    const errorEl = document.createElement('p');
    errorEl.id = 'signup-error';
    errorEl.textContent = `${message} [${code || 'SP-500'}]`;
    document.querySelector('form').appendChild(errorEl);
  }

  if (!/^[a-zA-Z0-9_.ა-ჰ-]{3,30}$/.test(username)) {
    return showError('Username must be 3–30 characters (letters, numbers, _ . -).', 'SP-105');
  }
  if (password.length < 6) {
    return showError('Password must be at least 6 characters.', 'SP-106');
  }
  if (password !== confirm) {
    return showError('Passwords do not match.', 'SP-108');
  }

  try {
    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      sessionStorage.setItem('username', username);
      sessionStorage.setItem('token', data.token);
      window.location.href = './pages/home.html';
      return;
    }

    if (data.error === 'taken') {
      showError('That username is already taken.', data.code);
    } else if (data.error === 'invalid_username') {
      showError('Username must be 3–30 characters (letters, numbers, _ . -).', data.code);
    } else if (data.error === 'weak_password') {
      showError('Password must be at least 6 characters.', data.code);
    } else if (data.error === 'too_many_attempts') {
      showError('Too many attempts. Please wait 15 minutes and try again.', data.code);
    } else if (data.error === 'database_unavailable') {
      showError('The database is not reachable right now. Please tell the site owner.', data.code);
    } else {
      showError('Something went wrong. Please try again later.', data.code);
    }
  } catch (err) {
    console.error(err);
    showError('Cannot reach the server. Check your connection and try again.', 'SP-000');
  }
});
