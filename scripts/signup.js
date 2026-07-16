document.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const confirm  = document.getElementById('confirm').value;

  const existing = document.getElementById('signup-error');
  if (existing) existing.remove();

  function showError(message) {
    const errorEl = document.createElement('p');
    errorEl.id = 'signup-error';
    errorEl.textContent = message;
    document.querySelector('form').appendChild(errorEl);
  }

  if (!/^[a-zA-Z0-9_.ა-ჰ-]{3,30}$/.test(username)) {
    return showError('Username must be 3–30 characters (letters, numbers, _ . -).');
  }
  if (password.length < 6) {
    return showError('Password must be at least 6 characters.');
  }
  if (password !== confirm) {
    return showError('Passwords do not match.');
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
      showError('That username is already taken.');
    } else if (data.error === 'invalid_username') {
      showError('Username must be 3–30 characters (letters, numbers, _ . -).');
    } else if (data.error === 'weak_password') {
      showError('Password must be at least 6 characters.');
    } else if (data.error === 'too_many_attempts') {
      showError('Too many attempts. Please wait 15 minutes and try again.');
    } else {
      showError('Something went wrong. Please try again later.');
    }
  } catch (err) {
    console.error(err);
    showError('Could not reach the server. Please try again.');
  }
});
