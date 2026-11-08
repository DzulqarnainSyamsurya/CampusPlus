const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}$/;

exports.normalizeEmail = (email) => String(email || '').trim().toLowerCase();
exports.normalizeUsername = (username) => String(username || '').trim();

exports.isValidEmail = (email) =>
    typeof email === 'string' && email.length <= 254 && emailPattern.test(email);

exports.isValidUsername = (username) =>
    typeof username === 'string' && usernamePattern.test(username);

exports.passwordErrors = (password) => {
    const errors = [];
    if (typeof password !== 'string' || password.length < 12) errors.push('Gunakan minimal 12 karakter.');
    if (typeof password !== 'string' || password.length > 128) errors.push('Password maksimal 128 karakter.');
    if (typeof password === 'string' && !/[a-zA-Z]/.test(password)) errors.push('Password harus memiliki huruf.');
    if (typeof password === 'string' && !/\d/.test(password)) errors.push('Password harus memiliki angka.');
    return errors;
};

exports.isValidFullName = (name) =>
    typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 100;
