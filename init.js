require('dotenv').config();
const pool = require('./pool');

async function init() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── users ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nickname    TEXT NOT NULL UNIQUE,
        password    TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'mother'
                      CHECK (role IN ('mother','psychologist','admin')),
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── groups ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT NOT NULL UNIQUE,
        description  TEXT NOT NULL,
        max_size     INT  NOT NULL DEFAULT 50,
        created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── group_members ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id  UUID REFERENCES groups(id) ON DELETE CASCADE,
        user_id   UUID REFERENCES users(id)  ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, user_id)
      );
    `);

    // ── posts ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id    UUID REFERENCES users(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        content      TEXT NOT NULL,
        is_anonymous BOOLEAN NOT NULL DEFAULT false,
        status       TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','flagged','removed')),
        reports      INT  NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── comments ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id      UUID REFERENCES posts(id) ON DELETE CASCADE,
        author_id    UUID REFERENCES users(id) ON DELETE SET NULL,
        content      TEXT NOT NULL,
        is_anonymous BOOLEAN NOT NULL DEFAULT false,
        status       TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','flagged','removed')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── chat_rooms ──────────────────────────────────────────────────────────
    // type: 'group' (linked to a support group) | 'direct' (mother ↔ psychologist) | 'general'
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_rooms (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT,
        type       TEXT NOT NULL DEFAULT 'general'
                     CHECK (type IN ('group','direct','general')),
        group_id   UUID REFERENCES groups(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── chat_room_members ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_room_members (
        room_id   UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
        user_id   UUID REFERENCES users(id)      ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (room_id, user_id)
      );
    `);

    // ── messages ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id      UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
        sender_id    UUID REFERENCES users(id)      ON DELETE SET NULL,
        content      TEXT NOT NULL,
        is_anonymous BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Create default admin account if none exists ─────────────────────────
    const bcrypt = require('bcryptjs');
    const adminExists = await client.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
    );
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(
        `INSERT INTO users (nickname, password, role) VALUES ($1, $2, 'admin')`,
        ['Admin', hash]
      );
      console.log('✅  Default admin created  →  nickname: Admin  /  password: admin123');
    }

    // ── Create a general chat room if none exists ───────────────────────────
    const generalExists = await client.query(
      `SELECT id FROM chat_rooms WHERE type = 'general' LIMIT 1`
    );
    if (generalExists.rows.length === 0) {
      await client.query(
        `INSERT INTO chat_rooms (name, type) VALUES ('General Circle', 'general')`
      );
      console.log('✅  General chat room created');
    }

    await client.query('COMMIT');
    console.log('✅  All tables initialised successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  DB init failed:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

init().catch(() => process.exit(1));
