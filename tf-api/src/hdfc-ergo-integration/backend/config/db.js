'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

/**
 * Shared MySQL connection pool for the tf_api_dev database (hdfcmmv lives here).
 *
 * Two ways to configure (either works):
 *   1) A single connection string:
 *        DATABASE_URL="mysql://root:password@localhost:3306/tf_api_dev"
 *   2) Separate vars:
 *        DB_HOST=localhost  DB_PORT=3306  DB_USER=root
 *        DB_PASSWORD=...     DB_NAME=tf_api_dev
 *
 * DATABASE_URL (if present) wins, so it reuses the same config as the rest of
 * the app.
 */
function buildPoolConfig() {
  const base = {
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };

  if (process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      return {
        ...base,
        host: u.hostname || 'localhost',
        port: u.port ? parseInt(u.port, 10) : 3306,
        user: decodeURIComponent(u.username || 'root'),
        password: decodeURIComponent(u.password || ''),
        database: (u.pathname || '').replace(/^\//, '') || 'tf_api_dev',
      };
    } catch (e) {
      console.error('Invalid DATABASE_URL, falling back to DB_* vars:', e.message);
    }
  }

  return {
    ...base,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tf_api_dev',
  };
}

const pool = mysql.createPool(buildPoolConfig());

// Quick startup check so a bad password/host is obvious in the logs.
async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    const cfg = buildPoolConfig();
    console.log(`MySQL connected: ${cfg.database} @ ${cfg.host}:${cfg.port}`);
  } finally {
    conn.release();
  }
}

module.exports = { pool, ping };
