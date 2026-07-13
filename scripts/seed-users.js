const bcrypt = require('bcrypt');
const db = require('../db');

const users = [
  { username: 'david', password: 'password123', email: 'david@example.com', first_name: 'David', last_name: 'Test' },
  { username: 'testuser', password: 'password123', email: 'test@example.com', first_name: 'Test', last_name: 'User' },
];

async function seed() {
  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 10);
    await db.execute(
      'INSERT INTO users (username, password_hash, email, first_name, last_name) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
      [user.username, hash, user.email, user.first_name, user.last_name]
    );
    console.log(`Added user: ${user.username}`);
  }
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
