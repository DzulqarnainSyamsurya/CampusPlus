
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const databasePath = process.env.CAMPUSPLUS_DB_PATH ||
    path.join(__dirname, '../../campusplus.db');

// Membuat atau membuka database
const db = new Database(databasePath);

// Mengaktifkan foreign key
db.pragma('foreign_keys = ON');

// Membuat tabel pengguna
db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'Informasi Akademik',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_name TEXT NOT NULL,
        lecturer TEXT NOT NULL,
        day TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        room TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        course_name TEXT NOT NULL,
        deadline DATETIME NOT NULL,
        status TEXT DEFAULT 'Belum Dikerjakan',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedule_exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        occurrence_date TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        room TEXT,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (schedule_id, occurrence_date)
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_date
    ON schedule_exceptions (occurrence_date);

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        pending_email TEXT COLLATE NOCASE,
        email_verified_at TEXT,
        password_hash TEXT NOT NULL,
        avatar TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_user
    ON password_reset_tokens (user_id, expires_at);

    CREATE TABLE IF NOT EXISTS email_change_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        new_email TEXT NOT NULL COLLATE NOCASE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_change_pending_user
    ON email_change_tokens (user_id) WHERE used_at IS NULL;

    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
        language TEXT NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en')),
        timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
        notifications_json TEXT NOT NULL DEFAULT '{"email":true,"browser":true}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS security_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_security_logs_user_created
    ON security_logs (user_id, created_at DESC, id DESC);
`);

const migrateUsers = db.transaction(() => {
    const userColumns = new Set(db.pragma('table_info(users)').map((column) => column.name));
    const additions = {
        full_name: 'TEXT',
        username: 'TEXT',
        pending_email: 'TEXT',
        email_verified_at: 'TEXT',
        password_hash: 'TEXT',
        avatar: 'TEXT',
        status: "TEXT NOT NULL DEFAULT 'active'",
        updated_at: 'TEXT'
    };

    for (const [column, type] of Object.entries(additions)) {
        if (!userColumns.has(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${type}`);
    }

    const hasLegacyName = userColumns.has('name');
    const hasLegacyPassword = userColumns.has('password');
    const users = db.prepare('SELECT * FROM users').all();
    const updateUser = db.prepare(`
        UPDATE users SET full_name = ?, username = ?, password_hash = ?, status = ?,
            updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP) WHERE id = ?
    `);
    const clearLegacyPassword = hasLegacyPassword
        ? db.prepare("UPDATE users SET password = '' WHERE id = ?")
        : null;

    for (const user of users) {
        const fullName = user.full_name?.trim() || (hasLegacyName ? user.name?.trim() : '') || `Mahasiswa ${user.id}`;
        const username = user.username?.trim() || `student${user.id}`;
        const legacyPassword = hasLegacyPassword ? user.password : null;
        let passwordHash = user.password_hash;
        let status = user.status || 'active';

        if (!passwordHash && typeof legacyPassword === 'string' && legacyPassword.length > 0) {
            passwordHash = /^\$2[aby]\$\d\d\$/.test(legacyPassword)
                ? legacyPassword
                : bcrypt.hashSync(legacyPassword, 12);
        }
        if (!passwordHash) status = 'disabled';

        updateUser.run(fullName, username, passwordHash || '', status, user.id);
        if (clearLegacyPassword && legacyPassword) clearLegacyPassword.run(user.id);
    }
});

migrateUsers();

db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
    ON users (username COLLATE NOCASE);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users (email COLLATE NOCASE);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pending_email_unique
    ON users (pending_email COLLATE NOCASE) WHERE pending_email IS NOT NULL;
`);

console.log('Database CampusPlus berhasil terhubung.');

module.exports = db;
