const username = sessionStorage.getItem('username');
const token    = sessionStorage.getItem('token');
if (!username || !token) window.location.href = '../login.html';
const AUTH = { Authorization: `Bearer ${token}` };

function showMsg(id, text, ok) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'account__msg ' + (ok ? 'account__msg--ok' : 'account__msg--err');
}

// Load current user data
fetch(`/api/user/${username}`, { headers: AUTH })
  .then(r => r.json())
  .then(data => {
    if (data.avatar_url) {
      document.getElementById('currentAvatar').src = data.avatar_url;
      document.getElementById('currentAvatar').style.display = 'block';
      document.getElementById('avatarPlaceholder').style.display = 'none';
    }
    document.getElementById('newUsername').placeholder = data.username;
  });

// Avatar upload
document.getElementById('avatarForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('avatarInput').files[0];
  if (!file) return showMsg('avatarMsg', 'Please select a file.', false);

  const form = new FormData();
  form.append('avatar', file);

  const res = await fetch('/api/user/avatar', { method: 'POST', headers: AUTH, body: form });
  const data = await res.json();

  if (res.ok) {
    document.getElementById('currentAvatar').src = data.avatar_url;
    document.getElementById('currentAvatar').style.display = 'block';
    document.getElementById('avatarPlaceholder').style.display = 'none';
    showMsg('avatarMsg', 'Profile picture updated.', true);
  } else {
    showMsg('avatarMsg', data.error || 'Failed to upload.', false);
  }
});

// Change username
document.getElementById('usernameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newUsername = document.getElementById('newUsername').value.trim();

  const res = await fetch('/api/user/username', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ newUsername }),
  });
  const data = await res.json();

  if (res.ok) {
    sessionStorage.setItem('username', newUsername);
    showMsg('usernameMsg', 'Username updated.', true);
    document.getElementById('newUsername').placeholder = newUsername;
    document.getElementById('newUsername').value = '';
  } else {
    showMsg('usernameMsg', data.error === 'taken' ? 'Username already taken.' : 'Failed to update.', false);
  }
});

// Change password
document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;

  const res = await fetch('/api/user/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json();

  if (res.ok) {
    showMsg('passwordMsg', 'Password updated.', true);
    document.getElementById('passwordForm').reset();
  } else {
    const msg = data.error === 'wrong_password' ? 'Current password is incorrect.' : 'Failed to update.';
    showMsg('passwordMsg', msg, false);
  }
});
