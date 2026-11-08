const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { after, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'campusplus-test-'));
const databasePath = path.join(temporaryDirectory, 'campusplus.db');
let serverProcess;
let serverOutput = '';
let port;
let sessionCookie = '';

async function findPort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { port: availablePort } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return availablePort;
}

async function startServer(overrides = {}) {
  serverProcess = spawn(process.execPath, ['src/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CAMPUSPLUS_DB_PATH: databasePath,
      CAMPUSPLUS_AVATAR_DIR: path.join(temporaryDirectory, 'avatars'),
      PORT: String(port),
      NODE_ENV: 'test',
      SESSION_SECRET: 'campusplus-integration-test-session-secret-0123456789',
      REGISTRATION_ENABLED: 'true',
      AUTH_EXPOSE_RESET_LINK: 'true',
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverOutput = '';
  serverProcess.stdout.on('data', (chunk) => { serverOutput += chunk; });
  serverProcess.stderr.on('data', (chunk) => { serverOutput += chunk; });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Server berhenti saat startup.\n${serverOutput}`);
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server tidak siap tepat waktu.\n${serverOutput}`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const exited = once(serverProcess, 'exit');
  serverProcess.kill();
  await exited;
}

async function request(route, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...options.headers };
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (sessionCookie) headers.Cookie = sessionCookie;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers['X-CSRF-Token']) {
    const csrfResponse = await fetch(`http://127.0.0.1:${port}/api/auth/csrf`, {
      headers: sessionCookie ? { Cookie: sessionCookie } : {},
    });
    const csrfCookie = csrfResponse.headers.getSetCookie?.()[0] || csrfResponse.headers.get('set-cookie');
    if (csrfCookie) sessionCookie = csrfCookie.split(';')[0];
    const csrfResult = await csrfResponse.json();
    headers['X-CSRF-Token'] = csrfResult.csrfToken;
    if (sessionCookie) headers.Cookie = sessionCookie;
  }

  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...options,
    method,
    headers,
  });
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (setCookie) sessionCookie = setCookie.split(';')[0];
  const body = await response.json();
  return { status: response.status, body, setCookie };
}

function jsonBody(value) {
  return JSON.stringify(value);
}

after(async () => {
  await stopServer();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('migrates legacy users rows without losing identity data or keeping plaintext password', () => {
  const legacyDatabasePath = path.join(temporaryDirectory, 'legacy-users.db');
  const legacyDatabase = new Database(legacyDatabasePath);
  legacyDatabase.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  legacyDatabase.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)')
    .run('Legacy Student', 'legacy@example.test', 'Legacy Plaintext Password');
  legacyDatabase.close();

  const migration = spawnSync(process.execPath, ['-e', `
    const db = require('./src/config/database');
    const controller = require('./src/modules/auth/auth.controller');
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    (async () => {
      const existing = db.prepare('SELECT name, email, password, full_name, username, password_hash, status FROM users WHERE email = ?').get('legacy@example.test');
      const validExisting = existing.name === 'Legacy Student' && existing.email === 'legacy@example.test' &&
        existing.full_name === 'Legacy Student' && existing.username === 'student1' &&
        existing.password === '' && existing.status === 'active' &&
        require('bcryptjs').compareSync('Legacy Plaintext Password', existing.password_hash);
      await controller.register({ body: {
        full_name: 'New Legacy Student', username: 'newstudent', email: 'newlegacy@example.test',
        password: 'CampusPlus Legacy 123!', confirm_password: 'CampusPlus Legacy 123!',
      } }, response, (error) => { throw error; });
      const created = db.prepare('SELECT name, password, password_hash FROM users WHERE username = ?').get('newstudent');
      const validCreated = response.statusCode === 201 && created.name === 'New Legacy Student' && created.password === '' &&
        require('bcryptjs').compareSync('CampusPlus Legacy 123!', created.password_hash);
      const valid = validExisting && validCreated;
      console.log(JSON.stringify({ valid }));
      db.close();
      if (!valid) process.exitCode = 1;
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CAMPUSPLUS_DB_PATH: legacyDatabasePath, NODE_ENV: 'test' },
  });

  assert.equal(migration.status, 0, migration.stderr);
  assert.match(migration.stdout, /\{"valid":true\}/);
});

test('REST API CRUD, validasi, pagination, logging, dan persistensi', async () => {
  port = await findPort();
  await startServer();

  const unauthenticatedHome = await fetch(`http://127.0.0.1:${port}`, { redirect: 'manual' });
  assert.equal(unauthenticatedHome.status, 302);
  assert.equal((await fetch(`http://127.0.0.1:${port}/index.html`, { redirect: 'manual' })).status, 302);
  assert.equal((await request('/api/tasks')).status, 401);
  assert.equal((await request('/api/account/profile')).status, 401);
  assert.equal((await request('/api/auth/registration-status')).body.enabled, true);

  await stopServer();
  await startServer({ REGISTRATION_ENABLED: 'false' });
  assert.equal((await request('/api/auth/registration-status')).body.enabled, false);
  assert.equal((await request('/api/auth/register', {
    method: 'POST', body: jsonBody({ full_name: 'Closed', username: 'closeduser', email: 'closed@example.test', password: 'CampusPlus Password 123!', confirm_password: 'CampusPlus Password 123!' }),
  })).status, 403);
  await stopServer();
  await startServer({ REGISTRATION_ENABLED: 'true' });

  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: jsonBody({
      full_name: 'CampusPlus Student',
      username: 'campusstudent',
      email: 'student@example.test',
      password: 'CampusPlus Password 123!',
      confirm_password: 'CampusPlus Password 123!',
    }),
  });
  assert.equal(registration.status, 201);
  const duplicateRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: jsonBody({
      full_name: 'Duplicate Student',
      username: 'campusstudent',
      email: 'another@example.test',
      password: 'CampusPlus Password 123!',
      confirm_password: 'CampusPlus Password 123!',
    }),
  });
  assert.equal(duplicateRegistration.status, 409);

  const secondRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: jsonBody({
      full_name: 'Other Student',
      username: 'otherstudent',
      email: 'other@example.test',
      password: 'CampusPlus Password 123!',
      confirm_password: 'CampusPlus Password 123!',
    }),
  });
  assert.equal(secondRegistration.status, 201);

  const storedUser = new Database(databasePath, { readonly: true });
  const registeredUser = storedUser.prepare('SELECT password_hash FROM users WHERE username = ?').get('campusstudent');
  assert.notEqual(registeredUser.password_hash, 'CampusPlus Password 123!');
  assert.match(registeredUser.password_hash, /^\$2[ab]\$/);
  storedUser.close();

  assert.equal((await request('/api/auth/login', {
    method: 'POST', body: jsonBody({ identifier: 'campusstudent', password: 'wrong-password' }),
  })).status, 401);
  const anonymousSessionCookie = sessionCookie;
  const login = await request('/api/auth/login', {
    method: 'POST', body: jsonBody({ identifier: 'student@example.test', password: 'CampusPlus Password 123!' }),
  });
  assert.equal(login.status, 200);
  assert.notEqual(sessionCookie, anonymousSessionCookie);
  assert.match(login.setCookie, /HttpOnly/i);
  assert.match(login.setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(login.setCookie, /Secure/i);
  assert.equal((await request('/api/auth/me')).body.user.username, 'campusstudent');

  assert.equal((await request('/api/account/profile')).body.user.email, 'student@example.test');
  assert.equal((await request('/api/account/profile', {
    method: 'PUT', body: jsonBody({ full_name: 'CampusPlus Student', username: 'otherstudent', email: 'student@example.test' }),
  })).status, 409);

  const profileUpdate = await request('/api/account/profile', {
    method: 'PUT',
    body: jsonBody({ full_name: 'CampusPlus Student Updated', username: 'campusstudent', email: 'newstudent@example.test' }),
  });
  assert.equal(profileUpdate.status, 200);
  assert.equal(profileUpdate.body.emailVerificationRequired, true);
  const emailToken = new URL(profileUpdate.body.developmentVerificationUrl).searchParams.get('token');
  const verifiedEmail = await request('/api/auth/verify-email', { method: 'POST', body: jsonBody({ token: emailToken }) });
  assert.equal(verifiedEmail.status, 200);
  assert.equal((await request('/api/account/profile')).body.user.email, 'newstudent@example.test');
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: jsonBody({ token: emailToken }) })).status, 400);

  const avatarBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lO0AAAAASUVORK5CYII=', 'base64');
  const avatarForm = new FormData();
  avatarForm.append('avatar', new Blob([avatarBytes], { type: 'image/png' }), 'avatar.png');
  assert.equal((await request('/api/account/avatar', { method: 'POST', body: avatarForm })).status, 200);
  const avatarResponse = await fetch(`http://127.0.0.1:${port}/api/account/avatar`, { headers: { Cookie: sessionCookie } });
  assert.equal(avatarResponse.status, 200);
  assert.match(avatarResponse.headers.get('content-type'), /image\/png/);

  const invalidAvatarForm = new FormData();
  invalidAvatarForm.append('avatar', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  assert.equal((await request('/api/account/avatar', { method: 'POST', body: invalidAvatarForm })).status, 400);

  const savedSettings = await request('/api/account/settings', {
    method: 'PUT',
    body: jsonBody({ theme: 'dark', language: 'en', timezone: 'Asia/Jakarta', notifications: { email: false, browser: true } }),
  });
  assert.equal(savedSettings.status, 200);
  assert.equal((await request('/api/account/settings')).body.theme, 'dark');
  assert.equal((await request('/api/account/settings', {
    method: 'PUT', body: jsonBody({ theme: 'ultraviolet', language: 'en', timezone: 'UTC', notifications: { email: false, browser: true } }),
  })).status, 400);

  assert.equal((await request('/api/account/change-password', {
    method: 'POST', body: jsonBody({ current_password: 'wrong-password', new_password: 'CampusPlus Password 456!', confirm_password: 'CampusPlus Password 456!' }),
  })).status, 400);
  const changedPassword = await request('/api/account/change-password', {
    method: 'POST', body: jsonBody({ current_password: 'CampusPlus Password 123!', new_password: 'CampusPlus Password 456!', confirm_password: 'CampusPlus Password 456!' }),
  });
  assert.equal(changedPassword.status, 200);
  assert.equal((await request('/api/auth/me')).status, 200);

  const resetRequest = await request('/api/auth/forgot-password', {
    method: 'POST', body: jsonBody({ email: 'newstudent@example.test' }),
  });
  assert.equal(resetRequest.status, 200);
  assert.equal((await request('/api/auth/forgot-password', {
    method: 'POST', body: jsonBody({ email: 'unknown@example.test' }),
  })).body.message, resetRequest.body.message);
  const resetToken = new URL(resetRequest.body.developmentResetUrl).searchParams.get('token');
  const resetDatabase = new Database(databasePath, { readonly: true });
  const storedResetToken = resetDatabase.prepare('SELECT token_hash FROM password_reset_tokens ORDER BY id DESC LIMIT 1').get();
  assert.notEqual(storedResetToken.token_hash, resetToken);
  assert.match(storedResetToken.token_hash, /^[a-f0-9]{64}$/);
  resetDatabase.close();

  const resetComplete = await request('/api/auth/reset-password', {
    method: 'POST', body: jsonBody({ token: resetToken, password: 'CampusPlus Password 789!', confirm_password: 'CampusPlus Password 789!' }),
  });
  assert.equal(resetComplete.status, 200);
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/auth/reset-password', {
    method: 'POST', body: jsonBody({ token: resetToken, password: 'CampusPlus Password 987!', confirm_password: 'CampusPlus Password 987!' }),
  })).status, 400);

  const resetLogin = await request('/api/auth/login', {
    method: 'POST', body: jsonBody({ identifier: 'campusstudent', password: 'CampusPlus Password 789!' }),
  });
  assert.equal(resetLogin.status, 200);
  const expiredResetRequest = await request('/api/auth/forgot-password', {
    method: 'POST', body: jsonBody({ email: 'newstudent@example.test' }),
  });
  const expiredResetToken = new URL(expiredResetRequest.body.developmentResetUrl).searchParams.get('token');
  const expireTokens = new Database(databasePath);
  expireTokens.prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, require('node:crypto').createHash('sha256').update(expiredResetToken).digest('hex'));
  expireTokens.close();
  assert.equal((await request('/api/auth/reset-password', {
    method: 'POST', body: jsonBody({ token: expiredResetToken, password: 'CampusPlus Password 987!', confirm_password: 'CampusPlus Password 987!' }),
  })).status, 400);

  const securityEvents = await request('/api/account/security-logs');
  assert.ok(securityEvents.body.some((event) => event.event === 'password_reset_requested'));

  const unauthorizedCsrf = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: jsonBody({ title: 'Blocked', course_name: 'Security', deadline: '2030-01-01T10:00' }),
  });
  assert.equal(unauthorizedCsrf.status, 403);

  const home = await fetch(`http://127.0.0.1:${port}`, { headers: { Cookie: sessionCookie } });
  assert.match(await home.text(), /CampusPlus/);

  assert.deepEqual((await request('/api/announcements')).body, []);
  assert.deepEqual((await request('/api/schedules')).body, []);
  assert.deepEqual((await request('/api/tasks')).body, []);
  assert.deepEqual((await request('/api/activity-logs')).body, []);

  const invalidAnnouncement = await request('/api/announcements', {
    method: 'POST', body: jsonBody({ title: 7, content: 'Isi' }),
  });
  assert.equal(invalidAnnouncement.status, 400);

  const announcement = await request('/api/announcements', {
    method: 'POST',
    body: jsonBody({ title: 'Jadwal UTS', content: 'Periksa portal', category: 'Akademik' }),
  });
  assert.equal(announcement.status, 201);
  const announcementId = announcement.body.id;

  let database = new Database(databasePath, { readonly: true });
  assert.equal(database.prepare('SELECT title FROM announcements WHERE id = ?').get(announcementId).title, 'Jadwal UTS');
  database.close();

  const updatedAnnouncement = await request(`/api/announcements/${announcementId}`, {
    method: 'PUT',
    body: jsonBody({ title: 'Jadwal UTS Revisi', content: 'Periksa portal akademik', category: 'Akademik' }),
  });
  assert.equal(updatedAnnouncement.status, 200);
  assert.equal((await request('/api/announcements')).body[0].title, 'Jadwal UTS Revisi');
  assert.equal((await request('/api/announcements/not-an-id', { method: 'DELETE' })).status, 400);
  assert.equal((await request('/api/announcements/99999', { method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/announcements/${announcementId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/announcements')).body.length, 0);

  assert.equal((await request('/api/schedules/not-an-id')).status, 400);
  const invalidSchedule = await request('/api/schedules', {
    method: 'POST',
    body: jsonBody({ course_name: 7, lecturer: 'Dosen', day: 'Senin', start_time: '08:00', end_time: '09:00' }),
  });
  assert.equal(invalidSchedule.status, 400);

  const schedule = await request('/api/schedules', {
    method: 'POST',
    body: jsonBody({ course_name: 'Algoritma', lecturer: 'Dosen A', day: 'Senin', start_time: '08:00', end_time: '09:00', room: 'A101' }),
  });
  assert.equal(schedule.status, 201);
  const scheduleId = schedule.body.id;
  assert.equal((await request('/api/schedules')).body.length, 1);
  assert.equal((await request(`/api/schedules/${scheduleId}`)).body.course_name, 'Algoritma');

  const conflict = await request('/api/schedules', {
    method: 'POST',
    body: jsonBody({ course_name: 'Basis Data', lecturer: 'Dosen B', day: 'Senin', start_time: '08:30', end_time: '09:30' }),
  });
  assert.equal(conflict.status, 409);

  const recurringSchedule = await request('/api/schedules', {
    method: 'POST',
    body: jsonBody({ course_name: 'Algoritma Selasa', lecturer: 'Ibu Darniati', day: 'Selasa', start_time: '10:30', end_time: '12:00', room: 'Lab A' }),
  });
  assert.equal(recurringSchedule.status, 201);
  const recurringId = recurringSchedule.body.id;
  const occurrenceRange = await request('/api/schedules/occurrences?from=2030-01-01&to=2030-01-08&timezoneOffset=0');
  assert.equal(occurrenceRange.status, 200);
  assert.deepEqual(occurrenceRange.body.filter((item) => item.schedule_id === recurringId).map((item) => item.occurrence_date), ['2030-01-01', '2030-01-08']);

  const invalidOccurrence = await request(`/api/schedules/occurrences/${recurringId}/2030-02-30?timezoneOffset=0`, {
    method: 'PUT', body: jsonBody({ status: 'Dosen Tidak Masuk', note: 'Sakit' }),
  });
  assert.equal(invalidOccurrence.status, 400);
  const invalidOccurrenceStatus = await request(`/api/schedules/occurrences/${recurringId}/2030-01-01`, {
    method: 'PUT', body: jsonBody({ status: 'Status Tidak Terdaftar' }),
  });
  assert.equal(invalidOccurrenceStatus.status, 400);
  const nonOccurrenceDate = await request(`/api/schedules/occurrences/${recurringId}/2030-01-02`, {
    method: 'PUT', body: jsonBody({ status: 'Dosen Tidak Masuk' }),
  });
  assert.equal(nonOccurrenceDate.status, 400);

  const absentScheduleException = await request('/api/schedules/occurrences/99999/2030-01-01', {
    method: 'PUT', body: jsonBody({ status: 'Dosen Tidak Masuk' }),
  });
  assert.equal(absentScheduleException.status, 404);

  const exception = await request(`/api/schedules/occurrences/${recurringId}/2030-01-01?timezoneOffset=0`, {
    method: 'PUT', body: jsonBody({ status: 'Dosen Tidak Masuk', note: 'Dosen berhalangan hadir' }),
  });
  assert.equal(exception.status, 200);
  assert.equal(exception.body.occurrence.status, 'Dosen Tidak Masuk');
  assert.equal(exception.body.occurrence.note, 'Dosen berhalangan hadir');
  const updatedException = await request(`/api/schedules/occurrences/${recurringId}/2030-01-01?timezoneOffset=0`, {
    method: 'PUT', body: jsonBody({ status: 'Kuliah Online', note: 'Tautan dikirim melalui portal', room: 'https://example.test/class' }),
  });
  assert.equal(updatedException.body.occurrence.status, 'Kuliah Online');
  assert.equal(updatedException.body.occurrence.room, 'https://example.test/class');

  const occurrencesAfterException = await request('/api/schedules/occurrences?from=2030-01-01&to=2030-01-08&timezoneOffset=0');
  assert.deepEqual(occurrencesAfterException.body.filter((item) => item.schedule_id === recurringId).map((item) => item.status), ['Kuliah Online', 'Terjadwal']);
  assert.equal((await request(`/api/schedules/${recurringId}`)).body.day, 'Selasa');
  const exceptionsInDatabase = new Database(databasePath, { readonly: true });
  assert.equal(exceptionsInDatabase.prepare('SELECT COUNT(*) AS count FROM schedule_exceptions WHERE schedule_id = ?').get(recurringId).count, 1);
  exceptionsInDatabase.close();
  assert.equal((await request('/api/schedules/occurrences?from=2030-02-30&to=2030-03-01')).status, 400);

  const updatedSchedule = await request(`/api/schedules/${scheduleId}`, {
    method: 'PUT',
    body: jsonBody({ course_name: 'Algoritma Lanjut', lecturer: 'Dosen A', day: 'Rabu', start_time: '10:00', end_time: '11:00', room: 'A102' }),
  });
  assert.equal(updatedSchedule.status, 200);
  assert.equal((await request(`/api/schedules/${scheduleId}`)).body.day, 'Rabu');
  assert.equal((await request('/api/schedules/99999', { method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/schedules/${scheduleId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/schedules/${recurringId}`, { method: 'DELETE' })).status, 200);
  const cascadedExceptions = new Database(databasePath, { readonly: true });
  assert.equal(cascadedExceptions.prepare('SELECT COUNT(*) AS count FROM schedule_exceptions WHERE schedule_id = ?').get(recurringId).count, 0);
  cascadedExceptions.close();
  assert.equal((await request('/api/schedules')).body.length, 0);

  const invalidTask = await request('/api/tasks', {
    method: 'POST',
    body: jsonBody({ title: 'Ujian', course_name: 'Basis Data', deadline: 'bukan-tanggal' }),
  });
  assert.equal(invalidTask.status, 400);

  const laterTask = await request('/api/tasks', {
    method: 'POST',
    body: jsonBody({ title: 'Laporan', course_name: 'Jaringan', deadline: '2030-01-03T10:00', description: 'Bab 1', status: 'Belum Dikerjakan' }),
  });
  const earlierTask = await request('/api/tasks', {
    method: 'POST',
    body: jsonBody({ title: 'Kuis', course_name: 'Algoritma', deadline: '2030-01-02T10:00' }),
  });
  assert.equal(laterTask.status, 201);
  assert.equal(earlierTask.status, 201);
  const taskId = laterTask.body.id;
  assert.deepEqual((await request('/api/tasks')).body.map((task) => task.title), ['Kuis', 'Laporan']);
  assert.equal((await request(`/api/tasks/not-an-id`)).status, 400);
  assert.equal((await request('/api/tasks/99999')).status, 404);

  const updatedTask = await request(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: jsonBody({ title: 'Laporan Revisi', course_name: 'Jaringan', deadline: '2030-01-04T10:00', description: 'Bab 1 dan 2', status: 'Selesai' }),
  });
  assert.equal(updatedTask.status, 200);
  assert.equal((await request(`/api/tasks/${taskId}`)).body.status, 'Selesai');
  assert.equal((await request('/api/tasks/99999', { method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/tasks/${taskId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/tasks')).body.some((task) => task.id === taskId), false);

  const invalidActivity = await request('/api/activity-logs', {
    method: 'POST', body: jsonBody({ activity: 3 }),
  });
  assert.equal(invalidActivity.status, 400);
  const logs = await request('/api/activity-logs?page=1&limit=2');
  assert.equal(logs.status, 200);
  assert.equal(logs.body.data.length, 2);
  assert.ok(logs.body.total >= 8);
  assert.equal((await request('/api/activity-logs?page=0&limit=2')).status, 400);

  assert.equal((await request('/api/activity-logs', { method: 'DELETE' })).status, 200);
  assert.deepEqual((await request('/api/activity-logs')).body, []);
  assert.equal((await request('/api/activity-logs?page=1&limit=2')).body.totalPages, 0);

  for (let index = 0; index < 11; index += 1) {
    const activity = index % 2 === 0 ? 'Tambah Tugas' : 'Edit Tugas';
    assert.equal((await request('/api/activity-logs', {
      method: 'POST', body: jsonBody({ activity, description: `Log ${index}` }),
    })).status, 201);
  }

  const firstPage = await request('/api/activity-logs?page=1&limit=10');
  const secondPage = await request('/api/activity-logs?page=2&limit=10');
  assert.equal(firstPage.body.data.length, 10);
  assert.equal(secondPage.body.data.length, 1);
  assert.equal(firstPage.body.totalPages, 2);
  const filteredLogs = await request('/api/activity-logs?page=1&limit=10&activity=Tambah%20Tugas');
  assert.ok(filteredLogs.body.data.every((activity) => activity.activity === 'Tambah Tugas'));
  assert.equal((await request('/api/activity-logs?page=1&limit=10&activity=Tambah%20Tugas&activity=Edit%20Tugas')).status, 400);

  assert.equal((await request('/api/activity-logs', { method: 'DELETE' })).status, 200);

  const persistentSchedule = await request('/api/schedules', {
    method: 'POST',
    body: jsonBody({ course_name: 'Persistensi Jadwal', lecturer: 'Dosen C', day: 'Kamis', start_time: '15:00', end_time: '16:00' }),
  });
  assert.equal(persistentSchedule.status, 201);
  const persistentException = await request(`/api/schedules/occurrences/${persistentSchedule.body.id}/2030-01-03`, {
    method: 'PUT',
    body: jsonBody({ status: 'Kuliah Ditunda', note: 'Uji penyimpanan restart' }),
  });
  assert.equal(persistentException.status, 200);

  const persistentAnnouncement = await request('/api/announcements', {
    method: 'POST', body: jsonBody({ title: 'Tetap Tersimpan', content: 'Uji restart' }),
  });
  assert.equal(persistentAnnouncement.status, 201);
  await stopServer();
  await startServer();
  assert.equal((await request('/api/announcements')).body[0].title, 'Tetap Tersimpan');
  assert.equal((await request('/api/auth/me')).status, 200);
  const restoredOccurrences = await request('/api/schedules/occurrences?from=2030-01-03&to=2030-01-03&timezoneOffset=0');
  assert.equal(restoredOccurrences.body[0].status, 'Kuliah Ditunda');
  assert.equal(restoredOccurrences.body[0].note, 'Uji penyimpanan restart');

  database = new Database(databasePath, { readonly: true });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM announcements').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schedule_exceptions').get().count, 1);
  database.close();

  const expiredSessions = new Database(databasePath);
  const expiredSessionUpdate = expiredSessions.prepare("UPDATE sessions SET expires = ? WHERE json_extract(sess, '$.userId') = ?").run(Date.now() - 1, registration.body.userId);
  assert.ok(expiredSessionUpdate.changes > 0);
  expiredSessions.close();
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/auth/login', {
    method: 'POST', body: jsonBody({ identifier: 'campusstudent', password: 'CampusPlus Password 789!' }),
  })).status, 200);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: jsonBody({}) })).status, 200);
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/tasks')).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}`, { redirect: 'manual' })).status, 302);

  await stopServer();
  await startServer({ NODE_ENV: 'development', REGISTRATION_RATE_LIMIT_DEV: '2' });
  assert.equal((await request('/api/auth/register', { method: 'POST', body: jsonBody({}) })).status, 400);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: jsonBody({}) })).status, 400);
  const developmentRateLimit = await request('/api/auth/register', { method: 'POST', body: jsonBody({}) });
  assert.equal(developmentRateLimit.status, 429);

  await stopServer();
  await startServer({ NODE_ENV: 'production' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await request('/api/auth/register', { method: 'POST', body: jsonBody({}) })).status, 400);
  }
  const productionRateLimit = await request('/api/auth/register', { method: 'POST', body: jsonBody({}) });
  assert.equal(productionRateLimit.status, 429);
});
