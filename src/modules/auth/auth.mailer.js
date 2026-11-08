const nodemailer = require('nodemailer');

function getTransporter() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) return null;

    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });
}

exports.isConfigured = () => Boolean(getTransporter());

exports.send = async ({ to, subject, text, html }) => {
    const transporter = getTransporter();
    if (!transporter) throw new Error('Email belum dikonfigurasi.');
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    return transporter.sendMail({ from, to, subject, text, html });
};
