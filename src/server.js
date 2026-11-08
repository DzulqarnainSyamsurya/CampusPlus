require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./config/database');
const session = require('express-session');
const SqliteSessionStore = require('./core/sqliteSessionStore');
const authRoutes = require('./modules/auth/auth.routes');
const accountRoutes = require('./modules/auth/account.routes');
const { csrfProtection, requireAuth } = require('./modules/auth/auth.middleware');
const announcementRoutes = require('./modules/announcements/announcement.routes');
const scheduleRoutes = require('./modules/schedules/schedule.routes');
const taskRoutes = require('./modules/tasks/task.routes');
const activityLogRoutes = require('./modules/activity-logs/activityLog.routes');
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;

if (production && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error('SESSION_SECRET minimal 32 karakter wajib diatur di production.');
}

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    name: 'campusplus.sid',
    secret: sessionSecret || 'campusplus-local-development-session-secret-change-before-deploy',
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
    },
}));

app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api', requireAuth, (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    csrfProtection(req, res, next);
});

app.use('/api/announcements', announcementRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/activity-logs', activityLogRoutes);

const publicDirectory = path.join(__dirname, 'public');
const sendPublicPage = (filename) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDirectory, filename));
};

app.get('/login', (req, res) => req.session.userId ? res.redirect('/') : sendPublicPage('login.html')(req, res));
app.get('/register', sendPublicPage('register.html'));
app.get('/forgot-password', sendPublicPage('forgot-password.html'));
app.get('/reset-password', sendPublicPage('reset-password.html'));
app.get('/verify-email', sendPublicPage('verify-email.html'));
app.get('/index.html', (req, res) => res.redirect('/'));

// Folder untuk file frontend
app.use(express.static(publicDirectory, { index: false, dotfiles: 'deny' }));

// Halaman utama
app.get('/', (req, res) => {
    const user = req.session.userId
        ? db.prepare('SELECT id FROM users WHERE id = ? AND status = ?').get(req.session.userId, 'active')
        : null;

    if (!user) {
        if (req.session.userId) req.session.destroy(() => {});
        return res.redirect('/login');
    }

    res.set('Cache-Control', 'no-store, private');
    res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.get('/profile', (req, res) => res.redirect('/#profile'));
app.get('/account-settings', (req, res) => res.redirect('/#settings'));
app.get('/change-password', (req, res) => res.redirect('/#change-password'));

app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint API tidak ditemukan.' }));

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'Ukuran gambar maksimal 2 MB.' });
    if (error.message === 'Gunakan gambar PNG, JPEG, atau WebP.') return res.status(400).json({ message: error.message });
    console.error('Request gagal diproses.');
    res.status(500).json({ message: 'Terjadi kesalahan server.' });
});

// Menjalankan server
app.listen(PORT, () => {
    console.log(`CampusPlus berjalan di http://localhost:${PORT}`);
});
