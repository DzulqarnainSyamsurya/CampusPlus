# CampusPlus

CampusPlus is a Node.js/Express modular-monolith student academic app with SQLite persistence.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
```

Set a private session secret in `.env`, then run:

```powershell
$secret = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
notepad .env
npm start
```

Open `http://localhost:3000/login`. Keep `REGISTRATION_ENABLED=true` while creating the first user; set it to `false` afterward if public signup should be closed. Existing academic tables and records are retained. The auth schema is created with `CREATE TABLE IF NOT EXISTS` and does not reset the database.

Run the API, auth, session, and persistence integration suite with `npm test`.

## Production settings

- Set `NODE_ENV=production` and a randomly generated `SESSION_SECRET` of at least 32 characters.
- Set `PUBLIC_BASE_URL` to the canonical HTTPS origin.
- HTTPS is required for secure session cookies. If TLS terminates at a trusted reverse proxy, set `TRUST_PROXY=true`.
- Set `AUTH_EXPOSE_RESET_LINK=false`; development reset links are never returned in production.
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` to deliver password-reset and email-change verification links. Without a provider, these flows return an explicit configuration error rather than pretending to send email.
- `REGISTRATION_RATE_LIMIT_DEV` can tune non-production signup tests (default 50 requests/hour, accepted range 1–1000). Production ignores this value and keeps the signup cap at five requests/hour.
- `REGISTRATION_ENABLED=false` disables public registration.

Passwords are hashed with bcrypt. Sessions and one-time token hashes are stored in SQLite. Session cookies are HttpOnly and SameSite=Lax. All state-changing API requests require a session CSRF token. Avatar uploads accept PNG/JPEG/WebP only, are limited to 2 MB, checked by file signature, and stored outside the public directory.
