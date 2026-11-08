const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const mailer = require('./auth.mailer');
const validation = require('./auth.validation');
const { registrationEnabled } = require('./auth.middleware');

const passwordCost = 12;
const resetLifetime = 60 * 60 * 1000;
const verificationLifetime = 24 * 60 * 60 * 1000;
const genericResetMessage = 'Jika email terdaftar dan dapat menerima email, tautan pemulihan akan dikirim.';
const resetUnavailableMessage = 'Pemulihan password belum siap. Administrator perlu mengatur provider email.';
const exposeLinksInDevelopment = () =>
    process.env.NODE_ENV !== 'production' && process.env.AUTH_EXPOSE_RESET_LINK === 'true';

function safeUser(user) {
    if (!user) return null;
    const {
        id, full_name, username, email, pending_email, email_verified_at,
        avatar, status, created_at, updated_at,
    } = user;
    return { id, full_name, username, email, pending_email, email_verified_at, avatar, status, created_at, updated_at };
}

function writeSecurityLog(userId, event) {
    db.prepare('INSERT INTO security_logs (user_id, event) VALUES (?, ?)').run(userId, event);
}

function tokenHash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function publicBaseUrl(req) {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    if (process.env.NODE_ENV === 'production') throw new Error('PUBLIC_BASE_URL belum dikonfigurasi.');
    return `${req.protocol}://${req.get('host')}`;
}

function createRawToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
    });
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((error) => error ? reject(error) : resolve());
    });
}

function validResetDelivery() {
    return mailer.isConfigured() || exposeLinksInDevelopment();
}

exports.me = (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: safeUser(req.user) });
};

exports.register = async (req, res, next) => {
    if (!registrationEnabled()) return res.status(403).json({ message: 'Registrasi akun saat ini dinonaktifkan.' });

    const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
    const username = validation.normalizeUsername(req.body.username);
    const email = validation.normalizeEmail(req.body.email);
    const { password, confirm_password: confirmPassword } = req.body;

    if (!validation.isValidFullName(fullName)) return res.status(400).json({ message: 'Nama lengkap wajib diisi (2–100 karakter).' });
    if (!validation.isValidUsername(username)) return res.status(400).json({ message: 'Username harus 3–30 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung.' });
    if (!validation.isValidEmail(email)) return res.status(400).json({ message: 'Format email tidak valid.' });
    const passwordIssues = validation.passwordErrors(password);
    if (passwordIssues.length) return res.status(400).json({ message: passwordIssues.join(' ') });
    if (password !== confirmPassword) return res.status(400).json({ message: 'Konfirmasi password tidak sama.' });

    try {
        const passwordHash = await bcrypt.hash(password, passwordCost);
        const createUser = db.transaction(() => {
            const columns = new Set(db.pragma('table_info(users)').map((column) => column.name));
            const insertColumns = ['full_name', 'username', 'email', 'password_hash'];
            const insertValues = [fullName, username, email, passwordHash];

            if (columns.has('name')) {
                insertColumns.splice(1, 0, 'name');
                insertValues.splice(1, 0, fullName);
            }
            if (columns.has('password')) {
                insertColumns.push('password');
                insertValues.push('');
            }

            const placeholders = insertColumns.map(() => '?').join(', ');
            const result = db.prepare(`
                INSERT INTO users (${insertColumns.join(', ')})
                VALUES (${placeholders})
            `).run(...insertValues);
            db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(result.lastInsertRowid);
            return result.lastInsertRowid;
        });
        const userId = createUser();
        res.status(201).json({ message: 'Akun berhasil dibuat. Silakan login.', userId });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ message: 'Username atau email sudah digunakan.' });
        }
        next(error);
    }
};

exports.login = async (req, res, next) => {
    const identifier = typeof req.body.identifier === 'string' ? req.body.identifier.trim() : '';
    const password = req.body.password;
    if (!identifier || typeof password !== 'string' || identifier.length > 254 || password.length > 128) {
        return res.status(400).json({ message: 'Email/username dan password wajib diisi.' });
    }

    try {
        const user = db.prepare(`
            SELECT * FROM users
            WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
        `).get(identifier, identifier);
        const dummyHash = '$2b$12$4s4e1LrJK8jR2WXu8fh5nu0.IeMczLrxxJ9mDgUVpj2jKObi.r8W.';
        const passwordMatches = await bcrypt.compare(password, user?.password_hash || dummyHash);

        if (!user || user.status !== 'active' || !passwordMatches) {
            return res.status(401).json({ message: 'Email/username atau password tidak sesuai.' });
        }

        await regenerateSession(req);
        req.session.userId = user.id;
        req.session.cookie.maxAge = req.body.remember_me === true ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        writeSecurityLog(user.id, 'login_success');
        await saveSession(req);
        res.set('Cache-Control', 'no-store');
        res.json({ user: safeUser(user), csrfToken: req.session.csrfToken });
    } catch (error) {
        next(error);
    }
};

exports.logout = async (req, res, next) => {
    const userId = req.user.id;
    try {
        writeSecurityLog(userId, 'logout');
        req.session.destroy((error) => {
            if (error) return next(error);
            res.clearCookie('campusplus.sid', { httpOnly: true, sameSite: 'lax', secure: req.secure });
            res.set('Cache-Control', 'no-store');
            res.json({ message: 'Kamu berhasil logout.' });
        });
    } catch (error) {
        next(error);
    }
};

exports.requestPasswordReset = async (req, res, next) => {
    if (!validResetDelivery()) return res.status(503).json({ message: resetUnavailableMessage });
    const email = validation.normalizeEmail(req.body.email);
    if (!validation.isValidEmail(email)) return res.status(400).json({ message: 'Masukkan alamat email yang valid.' });

    try {
        const user = db.prepare('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE AND status = ?').get(email, 'active');
        if (!user) return res.json({ message: genericResetMessage });

        const rawToken = createRawToken();
        const expiresAt = Date.now() + resetLifetime;
        db.transaction(() => {
            db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now(), user.id);
            db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
                .run(user.id, tokenHash(rawToken), expiresAt);
            db.prepare("INSERT INTO security_logs (user_id, event) VALUES (?, 'password_reset_requested')").run(user.id);
        })();

        const link = `${publicBaseUrl(req)}/reset-password?token=${encodeURIComponent(rawToken)}`;
        try {
            if (mailer.isConfigured()) {
                await mailer.send({
                    to: user.email,
                    subject: 'Reset password CampusPlus',
                    text: `Gunakan tautan ini dalam 60 menit untuk membuat password baru: ${link}`,
                    html: `<p>Gunakan tautan ini dalam 60 menit untuk membuat password baru.</p><p><a href="${link}">Reset password</a></p>`,
                });
            }
        } catch (error) {
            db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), tokenHash(rawToken));
            console.error('Email reset gagal dikirim.');
            return res.status(503).json({ message: resetUnavailableMessage });
        }

        res.json({
            message: genericResetMessage,
            ...(exposeLinksInDevelopment() && !mailer.isConfigured() ? { developmentResetUrl: link } : {}),
        });
    } catch (error) {
        next(error);
    }
};

exports.resetPassword = async (req, res, next) => {
    const { token, password, confirm_password: confirmPassword } = req.body;
    const passwordIssues = validation.passwordErrors(password);
    if (passwordIssues.length) return res.status(400).json({ message: passwordIssues.join(' ') });
    if (password !== confirmPassword) return res.status(400).json({ message: 'Konfirmasi password tidak sama.' });
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
        return res.status(400).json({ message: 'Token reset tidak valid atau kedaluwarsa.' });
    }

    try {
        const record = db.prepare(`
            SELECT id, user_id FROM password_reset_tokens
            WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
        `).get(tokenHash(token), Date.now());
        if (!record) return res.status(400).json({ message: 'Token reset tidak valid atau kedaluwarsa.' });

        const passwordHash = await bcrypt.hash(password, passwordCost);
        const tokenConsumed = db.transaction(() => {
            const consumed = db.prepare(`
                UPDATE password_reset_tokens SET used_at = ?
                WHERE id = ? AND used_at IS NULL AND expires_at > ?
            `).run(Date.now(), record.id, Date.now());
            if (consumed.changes !== 1) return false;
            db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(passwordHash, record.user_id);
            db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
                .run(Date.now(), record.user_id);
            db.prepare("INSERT INTO security_logs (user_id, event) VALUES (?, 'password_reset')").run(record.user_id);
            db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(record.user_id);
            return true;
        })();
        if (!tokenConsumed) return res.status(400).json({ message: 'Token reset tidak valid atau kedaluwarsa.' });
        res.json({ message: 'Password berhasil diperbarui. Silakan login kembali.' });
    } catch (error) {
        next(error);
    }
};

exports.verifyEmailChange = (req, res, next) => {
    const { token } = req.body;
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
        return res.status(400).json({ message: 'Tautan verifikasi tidak valid atau kedaluwarsa.' });
    }

    try {
        const record = db.prepare(`
            SELECT id, user_id, new_email FROM email_change_tokens
            WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
        `).get(tokenHash(token), Date.now());
        if (!record) return res.status(400).json({ message: 'Tautan verifikasi tidak valid atau kedaluwarsa.' });

        const verify = db.transaction(() => {
            const consumed = db.prepare(`
                UPDATE email_change_tokens SET used_at = ?
                WHERE id = ? AND used_at IS NULL AND expires_at > ?
            `).run(Date.now(), record.id, Date.now());
            if (consumed.changes !== 1) throw Object.assign(new Error('Tautan verifikasi tidak valid atau kedaluwarsa.'), { code: 'EMAIL_TOKEN_CONSUMED' });
            const conflict = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(record.new_email, record.user_id);
            if (conflict) throw Object.assign(new Error('Email sudah digunakan akun lain.'), { code: 'EMAIL_CONFLICT' });
            db.prepare(`
                UPDATE users SET email = ?, pending_email = NULL, email_verified_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(record.new_email, record.user_id);
            db.prepare("INSERT INTO security_logs (user_id, event) VALUES (?, 'email_changed')").run(record.user_id);
        });
        verify();
        res.json({ message: 'Email berhasil diverifikasi dan diperbarui.' });
    } catch (error) {
        if (error.code === 'EMAIL_CONFLICT' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ message: 'Email sudah digunakan akun lain.' });
        }
        if (error.code === 'EMAIL_TOKEN_CONSUMED') return res.status(400).json({ message: error.message });
        next(error);
    }
};
