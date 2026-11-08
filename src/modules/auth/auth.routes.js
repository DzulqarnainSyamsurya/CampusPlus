const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./auth.controller');
const { csrfProtection, ensureCsrfToken, registrationEnabled, requireAuth } = require('./auth.middleware');

const router = express.Router();
const configuredDevelopmentRegistrationLimit = Number.parseInt(process.env.REGISTRATION_RATE_LIMIT_DEV, 10);
const developmentRegistrationLimit = Number.isInteger(configuredDevelopmentRegistrationLimit) &&
	configuredDevelopmentRegistrationLimit >= 1 && configuredDevelopmentRegistrationLimit <= 1000
	? configuredDevelopmentRegistrationLimit
	: 50;
const registrationLimit = process.env.NODE_ENV === 'production' ? 5 : developmentRegistrationLimit;
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: 'Terlalu banyak percobaan. Coba lagi beberapa saat.' } });
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: registrationLimit, standardHeaders: true, legacyHeaders: false, message: { message: 'Terlalu banyak pendaftaran dari jaringan ini.' } });
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 10 : 5, standardHeaders: true, legacyHeaders: false, message: { message: 'Terlalu banyak permintaan. Coba lagi nanti.' } });

router.get('/csrf', ensureCsrfToken);
router.get('/registration-status', (req, res) => res.json({ enabled: registrationEnabled() }));
router.get('/me', requireAuth, controller.me);
router.post('/register', registrationLimiter, csrfProtection, controller.register);
router.post('/login', loginLimiter, csrfProtection, controller.login);
router.post('/logout', requireAuth, csrfProtection, controller.logout);
router.post('/forgot-password', resetLimiter, csrfProtection, controller.requestPasswordReset);
router.post('/reset-password', resetLimiter, csrfProtection, controller.resetPassword);
router.post('/verify-email', csrfProtection, controller.verifyEmailChange);

module.exports = router;
