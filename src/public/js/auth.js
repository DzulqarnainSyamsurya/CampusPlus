const authPage = document.body.dataset.authPage;

async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Sesi keamanan tidak dapat dibuat.');
  return result.csrfToken;
}

async function authRequest(url, method, values) {
  const csrfToken = await getCsrfToken();
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(values),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Permintaan tidak dapat diproses.');
  return result;
}

function showFeedback(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle('success', success);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.firstChild.textContent.trim();
  button.firstChild.textContent = busy ? label : button.dataset.defaultLabel;
}

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Lihat' : 'Sembunyi';
    button.setAttribute('aria-label', showing ? 'Tampilkan password' : 'Sembunyikan password');
  });
});

if (authPage === 'login') {
  const form = document.getElementById('loginForm');
  const feedback = document.getElementById('loginFeedback');
  const submit = form.querySelector('button[type="submit"]');
  const registered = new URLSearchParams(location.search).get('registered');
  if (registered === '1') showFeedback(feedback, 'Akun berhasil dibuat. Silakan login.', true);

  fetch('/api/auth/registration-status', { cache: 'no-store' })
    .then((response) => response.json())
    .then(({ enabled }) => { document.getElementById('registerPrompt').hidden = !enabled; })
    .catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.remember_me = form.elements.remember_me.checked;
    showFeedback(feedback, '');
    setBusy(submit, true, 'Memeriksa...');
    try {
      await authRequest('/api/auth/login', 'POST', values);
      location.replace('/');
    } catch (error) {
      showFeedback(feedback, error.message);
    } finally {
      setBusy(submit, false);
    }
  });
}

if (authPage === 'register') {
  const form = document.getElementById('registerForm');
  const feedback = document.getElementById('registerFeedback');
  const submit = form.querySelector('button[type="submit"]');
  const passwordInput = form.elements.password;
  const strength = document.getElementById('passwordStrength');
  const strengthLabel = document.getElementById('passwordStrengthLabel');

  fetch('/api/auth/registration-status', { cache: 'no-store' })
    .then(async (response) => {
      const result = await response.json();
      if (!result.enabled) {
        form.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
        showFeedback(feedback, 'Registrasi akun saat ini dinonaktifkan. Hubungi administrator.');
      }
    }).catch(() => {});

  passwordInput.addEventListener('input', () => {
    const value = passwordInput.value;
    const score = [value.length >= 12, value.length >= 16, /[a-z]/.test(value) && /[A-Z]/.test(value), /\d/.test(value), /[^a-zA-Z0-9]/.test(value)].filter(Boolean).length;
    strength.style.width = `${score * 20}%`;
    strength.style.background = score >= 4 ? '#2f8059' : score >= 3 ? '#b87929' : '#d97158';
    strengthLabel.textContent = score >= 4 ? 'Kekuatan password: baik.' : score >= 3 ? 'Kekuatan password: cukup.' : 'Gunakan minimal 12 karakter, huruf, dan angka.';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.confirm_password) {
      showFeedback(feedback, 'Konfirmasi password tidak sama.');
      return;
    }
    showFeedback(feedback, '');
    setBusy(submit, true, 'Membuat akun...');
    try {
      await authRequest('/api/auth/register', 'POST', values);
      location.replace('/login?registered=1');
    } catch (error) {
      showFeedback(feedback, error.message);
    } finally {
      setBusy(submit, false);
    }
  });
}

if (authPage === 'forgot') {
  const form = document.getElementById('forgotForm');
  const feedback = document.getElementById('forgotFeedback');
  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFeedback(feedback, '');
    setBusy(submit, true, 'Mengirim...');
    try {
      const result = await authRequest('/api/auth/forgot-password', 'POST', Object.fromEntries(new FormData(form)));
      showFeedback(feedback, result.message, true);
      if (result.developmentResetUrl) {
        const link = document.createElement('a');
        link.href = result.developmentResetUrl;
        link.textContent = 'Buka tautan reset development';
        link.className = 'development-link';
        feedback.append(' ', link);
      }
    } catch (error) {
      showFeedback(feedback, error.message);
    } finally {
      setBusy(submit, false);
    }
  });
}

if (authPage === 'reset') {
  const form = document.getElementById('resetForm');
  const feedback = document.getElementById('resetFeedback');
  const submit = form.querySelector('button[type="submit"]');
  const token = new URLSearchParams(location.search).get('token');
  if (!token) {
    form.hidden = true;
    showFeedback(feedback, 'Tautan reset tidak valid atau kedaluwarsa. Minta tautan baru.');
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.token = token;
    showFeedback(feedback, '');
    setBusy(submit, true, 'Menyimpan...');
    try {
      const result = await authRequest('/api/auth/reset-password', 'POST', values);
      showFeedback(feedback, result.message, true);
      form.reset();
      setTimeout(() => location.replace('/login'), 1600);
    } catch (error) {
      showFeedback(feedback, error.message);
    } finally {
      setBusy(submit, false);
    }
  });
}

if (authPage === 'verify-email') {
  const form = document.getElementById('verifyEmailForm');
  const feedback = document.getElementById('verifyEmailFeedback');
  const submit = form.querySelector('button[type="submit"]');
  const token = new URLSearchParams(location.search).get('token');
  if (!token) {
    submit.disabled = true;
    showFeedback(feedback, 'Tautan verifikasi tidak valid atau kedaluwarsa.');
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(submit, true, 'Memverifikasi...');
    try {
      const result = await authRequest('/api/auth/verify-email', 'POST', { token });
      showFeedback(feedback, result.message, true);
      setTimeout(() => location.replace('/login'), 1600);
    } catch (error) {
      showFeedback(feedback, error.message);
    } finally {
      setBusy(submit, false);
    }
  });
}
