const { Pool, types } = require('pg');

// pg returns BIGINT (int8) as strings by default — parse them as JS numbers.
// Telegram IDs fit safely in Number (< 2^53).
types.setTypeParser(20, (val) => parseInt(val, 10));

// SSL configuration:
//   - If DATABASE_CA_CERT is set, verify the server certificate against it (secure).
//   - If DATABASE_SSL_VERIFY=true, enforce verification without a custom CA
//     (works when the server uses a trusted public CA).
//   - Otherwise fall back to rejectUnauthorized:false for managed Postgres hosts
//     that use self-signed certs (e.g. Railway, Render). A warning is logged.
function buildSslConfig() {
  if (process.env.DATABASE_CA_CERT) {
    return { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT };
  }
  if (process.env.DATABASE_SSL_VERIFY === 'true') {
    return { rejectUnauthorized: true };
  }
  console.warn(
    '⚠️  PostgreSQL SSL: rejectUnauthorized=false — соединение не проверяет сертификат сервера.\n' +
    '   Для продакшена задайте DATABASE_CA_CERT или DATABASE_SSL_VERIFY=true.'
  );
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? buildSslConfig() : false,
});

// ---------------------------------------------------------------------------
// Thin helpers that mimic common query patterns
// ---------------------------------------------------------------------------

const db = {
  // Run raw SQL
  query(text, params) {
    return pool.query(text, params);
  },

  // SELECT * FROM table WHERE k1=$1 AND k2=$2 LIMIT 1
  async findOne(table, conditions) {
    const keys = Object.keys(conditions);
    const vals = Object.values(conditions);
    const where = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
    const { rows } = await pool.query(
      `SELECT * FROM "${table}" WHERE ${where} LIMIT 1`,
      vals
    );
    return rows[0] || null;
  },

  // SELECT * FROM table [WHERE ...] [ORDER BY ...]
  async findMany(table, conditions = {}, orderBy = 'created_at DESC') {
    const keys = Object.keys(conditions);
    const vals = Object.values(conditions);
    let sql = `SELECT * FROM "${table}"`;
    if (keys.length) {
      const where = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
      sql += ` WHERE ${where}`;
    }
    sql += ` ORDER BY ${orderBy}`;
    const { rows } = await pool.query(sql, vals);
    return rows;
  },

  // INSERT INTO table (...) VALUES (...) RETURNING *
  async insertOne(table, data) {
    const keys = Object.keys(data);
    const vals = Object.values(data);
    const cols   = keys.map((k) => `"${k}"`).join(', ');
    const params = keys.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO "${table}" (${cols}) VALUES (${params}) RETURNING *`,
      vals
    );
    return rows[0];
  },

  // UPDATE table SET k1=$1,... WHERE ck1=$n,...
  async updateOne(table, data, conditions) {
    const dataKeys = Object.keys(data);
    const dataVals = Object.values(data);
    const condKeys = Object.keys(conditions);
    const condVals = Object.values(conditions);
    const set   = dataKeys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const where = condKeys.map((k, i) => `"${k}" = $${dataKeys.length + i + 1}`).join(' AND ');
    await pool.query(
      `UPDATE "${table}" SET ${set} WHERE ${where}`,
      [...dataVals, ...condVals]
    );
  },

  // COUNT(*)
  async count(table, conditions = {}) {
    const keys = Object.keys(conditions);
    const vals = Object.values(conditions);
    let sql = `SELECT COUNT(*)::int AS n FROM "${table}"`;
    if (keys.length) {
      const where = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
      sql += ` WHERE ${where}`;
    }
    const { rows } = await pool.query(sql, vals);
    return rows[0].n;
  },
};

// ---------------------------------------------------------------------------
// Schema initialisation — creates tables if they don't exist
// ---------------------------------------------------------------------------

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username    TEXT,
      first_name  TEXT,
      last_name   TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id             SERIAL PRIMARY KEY,
      seller_id      BIGINT NOT NULL,
      title          TEXT   NOT NULL,
      description    TEXT,
      category       TEXT   NOT NULL,
      price          FLOAT  NOT NULL,
      currency       TEXT   NOT NULL DEFAULT 'TON',
      delivery_days  INT    NOT NULL,
      status         TEXT   NOT NULL DEFAULT 'active',
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id                    SERIAL PRIMARY KEY,
      service_id            INT,
      buyer_id              BIGINT NOT NULL,
      seller_id             BIGINT NOT NULL,
      amount                FLOAT  NOT NULL,
      currency              TEXT   NOT NULL,
      commission            FLOAT,
      seller_amount         FLOAT,
      status                TEXT   NOT NULL DEFAULT 'pending_payment',
      cryptobot_invoice_id  TEXT,
      cryptobot_payment_id  TEXT,
      requirements          TEXT,
      service_title         TEXT,
      seller_name           TEXT,
      buyer_name            TEXT,
      dispute_reason        TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      paid_at               TIMESTAMPTZ,
      completed_at          TIMESTAMPTZ,
      delivered_at          TIMESTAMPTZ,
      disputed_at           TIMESTAMPTZ,
      refunded_at           TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id           SERIAL PRIMARY KEY,
      order_id     INT,
      reviewer_id  BIGINT NOT NULL,
      seller_id    BIGINT NOT NULL,
      rating       INT    NOT NULL,
      comment      TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id          SERIAL PRIMARY KEY,
      seller_id   BIGINT NOT NULL,
      username    TEXT   NOT NULL,
      description TEXT,
      price       INT    NOT NULL,
      status      TEXT   NOT NULL DEFAULT 'active',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id                SERIAL PRIMARY KEY,
      listing_id        INT,
      buyer_id          BIGINT NOT NULL,
      seller_id         BIGINT NOT NULL,
      amount            INT    NOT NULL,
      status            TEXT   NOT NULL DEFAULT 'pending',
      stars_payment_id  TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Safe migrations — add columns introduced after initial schema
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_url          TEXT`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_days    INT`);
  await pool.query(`ALTER TABLE users  ADD COLUMN IF NOT EXISTS is_banned        BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payout_cryptobot_notice_at TIMESTAMPTZ`);

  console.log('✅ PostgreSQL: таблицы готовы');
}

module.exports = { db, initDb };
