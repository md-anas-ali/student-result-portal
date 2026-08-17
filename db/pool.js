// Single shared PostgreSQL connection pool.
// Render Free + Neon: keep pool small, SSL required.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 5, // Render free tier / Neon pooled connections: keep this conservative
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

module.exports = pool;
