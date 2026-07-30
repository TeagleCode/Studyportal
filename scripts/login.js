document.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  // Remove any existing error message
  const existing = document.getElementById('login-error');
  if (existing) existing.remove();

  try {
    const response = await fetch('/api/login', {
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

    let message = '';
    if (data.error === 'not_registered') {
      message = 'This account does not exist. Please sign up first.';
    } else if (data.error === 'wrong_password') {
      message = 'Incorrect password. Please try again.';
    } else if (data.error === 'too_many_attempts') {
      message = 'Too many login attempts. Please wait 15 minutes and try again.';
    } else if (data.error === 'database_unavailable') {
      message = 'The database is not reachable right now. Please tell the site owner.';
    } else {
      message = 'Something went wrong. Please try again later.';
    }
    showError(message, data.code);

  } catch (err) {
    console.error(err);
    showError('Cannot reach the server. Check your connection and try again.', 'SP-000');
  }
});

// Error codes are documented in docs/ERROR-CODES.md
function showError(message, code) {
  const errorEl = document.createElement('p');
  errorEl.id = 'login-error';
  errorEl.textContent = `${message} [${code || 'SP-500'}]`;
  document.querySelector('form').appendChild(errorEl);
}
