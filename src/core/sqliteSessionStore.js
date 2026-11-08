const session = require('express-session');

class SqliteSessionStore extends session.Store {
    constructor(db) {
        super();
        this.db = db;
        this.getStatement = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
        this.setStatement = db.prepare(`
            INSERT INTO sessions (sid, sess, expires)
            VALUES (?, ?, ?)
            ON CONFLICT (sid) DO UPDATE SET
                sess = excluded.sess,
                expires = excluded.expires
        `);
        this.touchStatement = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
        this.destroyStatement = db.prepare('DELETE FROM sessions WHERE sid = ?');
        this.pruneStatement = db.prepare('DELETE FROM sessions WHERE expires <= ?');
        this.pruneStatement.run(Date.now());
    }

    get(sessionId, callback) {
        try {
            const row = this.getStatement.get(sessionId);
            if (!row) return callback(null, null);
            if (row.expires <= Date.now()) {
                this.destroyStatement.run(sessionId);
                return callback(null, null);
            }
            callback(null, JSON.parse(row.sess));
        } catch (error) {
            callback(error);
        }
    }

    set(sessionId, sessionData, callback = () => {}) {
        try {
            const cookieExpiry = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + (sessionData.cookie?.maxAge || 8 * 60 * 60 * 1000);
            this.setStatement.run(sessionId, JSON.stringify(sessionData), cookieExpiry);
            this.pruneStatement.run(Date.now());
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    touch(sessionId, sessionData, callback = () => {}) {
        try {
            const cookieExpiry = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + (sessionData.cookie?.maxAge || 8 * 60 * 60 * 1000);
            this.touchStatement.run(cookieExpiry, sessionId);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    destroy(sessionId, callback = () => {}) {
        try {
            this.destroyStatement.run(sessionId);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
}

module.exports = SqliteSessionStore;
