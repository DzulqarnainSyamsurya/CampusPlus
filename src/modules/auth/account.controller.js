const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const mailer = require('./auth.mailer');
const validation = require('./auth.validation');

const avatarDirectory = process.env.CAMPUSPLUS_AVATAR_DIR || path.join(__dirname, '../../private/uploads/avatars');
const passwordCost = 12;
const emailTokenLifetime = 24 * 60 * 60 * 1000;

function safeEmailVerificationLinksEnabled() {
    return process.env.NODE_ENV !== 'production' && process.env.AUTH_EXPOSE_RESET_LINK === 'true';
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function getPublicBaseUrl(req) {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    if (process.env.NODE_ENV === 'production') throw new Error('PUBLIC_BASE_URL belum dikonfigurasi.');
    return `${req.protocol}://${req.get('host')}`;
}

function validateAvatar(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 2 * 1024 * 1024) return null;
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: '.png', mime: 'image/png' };
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
    return null;
}

function safeStoredAvatar(filename) {
    return typeof filename === 'string' && /^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename);
}

function settingsForUser(userId) {
    return db.prepare('SELECT theme, language, timezone, notifications_json FROM user_settings WHERE user_id = ?').get(userId);
}

exports.getProfile = (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: req.user, settings: settingsForUser(req.user.id) });
};

exports.updateProfile = async (req, res, next) => {
    const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
    const username = validation.normalizeUsername(req.body.username);
    const requestedEmail = validation.normalizeEmail(req.body.email);

    if (!validation.isValidFullName(fullName)) return res.status(400).json({ message: 'Nama lengkap wajib diisi (2–100 karakter).' });
    if (!validation.isValidUsername(username)) return res.status(400).json({ message: 'Username tidak valid.' });
    if (!validation.isValidEmail(requestedEmail)) return res.status(400).json({ message: 'Alamat email tidak valid.' });

    const usernameConflict = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, req.user.id);
    if (usernameConflict) return res.status(409).json({ message: 'Username sudah digunakan.' });

    const emailChanged = requestedEmail !== req.user.email.toLowerCase();
    try {
        if (emailChanged) {
            if (!mailer.isConfigured() && !safeEmailVerificationLinksEnabled()) {
                return res.status(503).json({ message: 'Email belum dapat diubah. Administrator perlu mengatur provider email.' });
            }
            const emailConflict = db.prepare(`
                SELECT id FROM users WHERE (email = ? COLLATE NOCASE OR pending_email = ? COLLATE NOCASE) AND id != ?
            `).get(requestedEmail, requestedEmail, req.user.id);
            if (emailConflict) return res.status(409).json({ message: 'Email sudah digunakan akun lain.' });

            const token = crypto.randomBytes(32).toString('base64url');
            const tokenDigest = hashToken(token);
            db.transaction(() => {
                db.prepare('UPDATE email_change_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now(), req.user.id);
                db.prepare('INSERT INTO email_change_tokens (user_id, new_email, token_hash, expires_at) VALUES (?, ?, ?, ?)')
                    .run(req.user.id, requestedEmail, tokenDigest, Date.now() + emailTokenLifetime);
                db.prepare(`
                    UPDATE users SET full_name = ?, username = ?, pending_email = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(fullName, username, requestedEmail, req.user.id);
                db.prepare("INSERT INTO security_logs (user_id, event) VALUES (?, 'email_change_requested')").run(req.user.id);
            })();

            const verificationUrl = `${getPublicBaseUrl(req)}/verify-email?token=${encodeURIComponent(token)}`;
            try {
                if (mailer.isConfigured()) {
                    await mailer.send({
                        to: requestedEmail,
                        subject: 'Verifikasi perubahan email CampusPlus',
                        text: `Konfirmasi alamat email baru dalam 24 jam: ${verificationUrl}`,
                        html: `<p>Konfirmasi alamat email baru dalam 24 jam.</p><p><a href="${verificationUrl}">Verifikasi email</a></p>`,
                    });
                }
            } catch (error) {
                db.prepare('UPDATE email_change_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), tokenDigest);
                db.prepare('UPDATE users SET pending_email = NULL WHERE id = ?').run(req.user.id);
                console.error('Email verifikasi perubahan email gagal dikirim.');
                return res.status(503).json({ message: 'Email verifikasi gagal dikirim. Periksa konfigurasi email lalu coba lagi.' });
            }

            writeSecurityLog(req.user.id, 'profile_updated');
            return res.json({
                message: 'Profil tersimpan. Perubahan email menunggu verifikasi.',
                emailVerificationRequired: true,
                ...(safeEmailVerificationLinksEnabled() && !mailer.isConfigured() ? { developmentVerificationUrl: verificationUrl } : {}),
            });
        }

        db.prepare(`
            UPDATE users SET full_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(fullName, username, req.user.id);
        writeSecurityLog(req.user.id, 'profile_updated');
        const user = db.prepare(`
            SELECT id, full_name, username, email, pending_email, email_verified_at, avatar, status, created_at, updated_at
            FROM users WHERE id = ?
        `).get(req.user.id);
        res.json({ message: 'Profil berhasil diperbarui.', user });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'Username atau email sudah digunakan.' });
        next(error);
    }
};

exports.uploadAvatar = async (req, res, next) => {
    if (!req.file) return res.status(400).json({ message: 'Pilih file gambar terlebih dahulu.' });
    const image = validateAvatar(req.file.buffer);
    if (!image) return res.status(400).json({ message: 'File harus berupa gambar PNG, JPEG, atau WebP yang valid (maksimal 2 MB).' });

    const filename = `${crypto.randomUUID()}${image.ext}`;
    const targetPath = path.join(avatarDirectory, filename);
    try {
        await fs.mkdir(avatarDirectory, { recursive: true });
        await fs.writeFile(targetPath, req.file.buffer, { flag: 'wx', mode: 0o600 });
        const previousAvatar = req.user.avatar;
        db.prepare('UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(filename, req.user.id);
        writeSecurityLog(req.user.id, 'avatar_updated');
        if (safeStoredAvatar(previousAvatar)) {
            await fs.unlink(path.join(avatarDirectory, previousAvatar)).catch(() => {});
        }
        res.json({ message: 'Foto profil berhasil diperbarui.', avatar: '/api/account/avatar' });
    } catch (error) {
        await fs.unlink(targetPath).catch(() => {});
        next(error);
    }
};

exports.getAvatar = async (req, res, next) => {
    if (!safeStoredAvatar(req.user.avatar)) return res.status(404).json({ message: 'Foto profil belum tersedia.' });
    const filename = path.basename(req.user.avatar);
    const image = validateAvatar(await fs.readFile(path.join(avatarDirectory, filename)).catch(() => null));
    if (!image) return res.status(404).json({ message: 'Foto profil tidak tersedia.' });
    res.set({ 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(path.join(avatarDirectory, filename), (error) => { if (error && !res.headersSent) next(error); });
};

exports.getSettings = (req, res) => {
    res.json(settingsForUser(req.user.id));
};

exports.updateSettings = (req, res) => {
    const { theme, language, timezone, notifications } = req.body;
    if (!['light', 'dark', 'system'].includes(theme)) return res.status(400).json({ message: 'Tema tidak valid.' });
    if (!['id', 'en'].includes(language)) return res.status(400).json({ message: 'Bahasa tidak valid.' });
    if (typeof timezone !== 'string' || timezone.length > 64) return res.status(400).json({ message: 'Zona waktu tidak valid.' });
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
        return res.status(400).json({ message: 'Zona waktu tidak dikenal.' });
    }
    if (!notifications || typeof notifications !== 'object' || Array.isArray(notifications) ||
        typeof notifications.email !== 'boolean' || typeof notifications.browser !== 'boolean') {
        return res.status(400).json({ message: 'Preferensi notifikasi tidak valid.' });
    }

    db.prepare(`
        INSERT INTO user_settings (user_id, theme, language, timezone, notifications_json, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE SET
            theme = excluded.theme,
            language = excluded.language,
            timezone = excluded.timezone,
            notifications_json = excluded.notifications_json,
            updated_at = CURRENT_TIMESTAMP
    `).run(req.user.id, theme, language, timezone, JSON.stringify(notifications));
    writeSecurityLog(req.user.id, 'settings_updated');
    res.json({ message: 'Pengaturan berhasil disimpan.', settings: settingsForUser(req.user.id) });
};

exports.changePassword = async (req, res, next) => {
    const { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword } = req.body;
    const issues = validation.passwordErrors(newPassword);
    if (issues.length) return res.status(400).json({ message: issues.join(' ') });
    if (newPassword !== confirmPassword) return res.status(400).json({ message: 'Konfirmasi password tidak sama.' });

    try {
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
        if (!await bcrypt.compare(currentPassword || '', user.password_hash)) {
            return res.status(400).json({ message: 'Password saat ini tidak sesuai.' });
        }
        if (await bcrypt.compare(newPassword, user.password_hash)) {
            return res.status(400).json({ message: 'Gunakan password baru yang berbeda.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, passwordCost);
        db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, req.user.id);
        const sessions = db.prepare('SELECT sid, sess FROM sessions').all();
        const removeSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
        sessions.forEach((row) => {
            try {
                if (row.sid !== req.sessionID && JSON.parse(row.sess).userId === req.user.id) removeSession.run(row.sid);
            } catch {}
        });
        writeSecurityLog(req.user.id, 'password_changed');
        const rememberMaxAge = req.session.cookie.maxAge;
        req.session.regenerate((error) => {
            if (error) return next(error);
            req.session.userId = req.user.id;
            req.session.cookie.maxAge = rememberMaxAge;
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');
            req.session.save((saveError) => {
                if (saveError) return next(saveError);
                res.json({ message: 'Password berhasil diperbarui. Sesi lain telah dikeluarkan.', csrfToken: req.session.csrfToken });
            });
        });
    } catch (error) {
        next(error);
    }
};

exports.getSecurityLogs = (req, res) => {
    const logs = db.prepare(`
        SELECT event, created_at FROM security_logs
        WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50
    `).all(req.user.id);
    res.json(logs);
};

function writeSecurityLog(userId, event) {
    db.prepare('INSERT INTO security_logs (user_id, event) VALUES (?, ?)').run(userId, event);
}
