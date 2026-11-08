const express = require('express');
const multer = require('multer');
const controller = require('./account.controller');
const { csrfProtection, requireAuth } = require('./auth.middleware');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const allowed = ['image/png', 'image/jpeg', 'image/webp'];
        callback(allowed.includes(file.mimetype) ? null : new Error('Gunakan gambar PNG, JPEG, atau WebP.'), allowed.includes(file.mimetype));
    },
});

router.use(requireAuth);
router.get('/profile', controller.getProfile);
router.put('/profile', csrfProtection, controller.updateProfile);
router.get('/avatar', controller.getAvatar);
router.post('/avatar', csrfProtection, upload.single('avatar'), controller.uploadAvatar);
router.get('/settings', controller.getSettings);
router.put('/settings', csrfProtection, controller.updateSettings);
router.post('/change-password', csrfProtection, controller.changePassword);
router.get('/security-logs', controller.getSecurityLogs);

module.exports = router;
