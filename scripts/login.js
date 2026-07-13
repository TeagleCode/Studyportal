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
      window.location.href = './pages/home.html';
      return;
    }

    let message = '';
    if (data.error === 'not_registered') {
      message = 'This account does not exist. Please sign up first.';
    } else if (data.error === 'wrong_password') {
      message = 'Incorrect password. Please try again.';
    } else {
      message = 'Something went wrong. Please try again later.';
    }

    const errorEl = document.createElement('p');
    errorEl.id = 'login-error';
    errorEl.textContent = message;
    document.querySelector('form').appendChild(errorEl);

  } catch (err) {
    console.error(err);
  }
});
