const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'studyportal',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'studyportal',
});

module.exports = pool;
