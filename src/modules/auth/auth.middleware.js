const crypto = require('node:crypto');
const db = require('../../config/database');

exports.registrationEnabled = () => process.env.REGISTRATION_ENABLED !== 'false';

exports.ensureCsrfToken = (req, res) => {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: req.session.csrfToken });
};

exports.csrfProtection = (req, res, next) => {
    const expected = req.session?.csrfToken;
    const provided = req.get('x-csrf-token');

    if (
        typeof expected !== 'string' || typeof provided !== 'string' ||
        expected.length !== provided.length ||
        !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    ) {
        return res.status(403).json({ message: 'Permintaan tidak dapat diverifikasi. Muat ulang halaman dan coba lagi.' });
    }

    next();
};

exports.requireAuth = (req, res, next) => {
    const userId = req.session?.userId;
    if (!Number.isInteger(userId)) {
        return res.status(401).json({ message: 'Silakan login untuk melanjutkan.' });
    }

    try {
        const user = db.prepare(`
            SELECT id, full_name, username, email, pending_email, email_verified_at,
                   avatar, status, created_at, updated_at
            FROM users WHERE id = ?
        `).get(userId);

        if (!user || user.status !== 'active') {
            return req.session.destroy(() => {
                res.clearCookie('campusplus.sid');
                res.status(401).json({ message: 'Silakan login untuk melanjutkan.' });
            });
        }

        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
};
