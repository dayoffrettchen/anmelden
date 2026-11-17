export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
export const localPreview = (env, url) => env.LOCAL_PREVIEW === 'true' && ['localhost', '127.0.0.1'].includes(url.hostname);
export function isAdmin(user, env) {
  return (env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).includes(user.email.toLowerCase());
}
export async function readBody(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(415, 'JSON erwartet.');
  const raw = await request.text();
  if (raw.length > 8192) throw new HttpError(413, 'Anfrage zu groß.');
  let body;
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Ungültiges JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Ungültige Eingaben.');
  return body;
}
export async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function token() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function sessionToken(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)anmelden_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
function cookie(value, url, maxAge) {
  return 'anmelden_session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (url.protocol === 'https:' ? '; Secure' : '');
}
export async function currentUser(request, env, url) {
  const previewUser = request.headers.get('X-Preview-User');
  if (localPreview(env, url) && previewUser) {
    return env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(previewUser).first();
  }
  const value = sessionToken(request);
  if (!value) return null;
  return env.DB.prepare('SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await hash(value), Date.now()).first();
}
export async function authRoute(request, env, url) {
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const user = await currentUser(request, env, url);
    return json({ user: user ? { ...user, isAdmin: isAdmin(user, env) } : null, localPreview: localPreview(env, url) });
  }
  if (request.method !== 'POST') throw new HttpError(404, 'Nicht gefunden.');
  const body = await readBody(request);
  if (url.pathname === '/api/auth/request') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100) throw new HttpError(400, 'Bitte Name und gültige E-Mail-Adresse eingeben.');
    if (!localPreview(env, url) && (!env.RESEND_API_KEY || !env.EMAIL_FROM || env.APP_ORIGIN !== url.origin)) throw new HttpError(503, 'Der E-Mail-Versand ist noch nicht eingerichtet.');
    const now = Date.now();
    const value = token();
    const digest = await hash(value);
    // Atomic throttle prevents parallel requests from sending repeated messages.
    const inserted = await env.DB.prepare(`INSERT INTO login_links
      SELECT ?, ?, ?, ?, ?, NULL WHERE NOT EXISTS
      (SELECT 1 FROM login_links WHERE email = ? AND created_at > ?)
      RETURNING token_hash`).bind(digest, email, name, now + 15 * 60_000, now, email, now - 60_000).first();
    if (!inserted) throw new HttpError(429, 'Bitte eine Minute warten, bevor du einen neuen Link anforderst.');
    const link = url.origin + '/#login=' + value;
    if (localPreview(env, url)) return json({ previewLink: link });
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': digest },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'Dein Anmeldelink',
          text: 'Öffne diesen Link, um dich bei Anmelden einzuloggen. Er gilt 15 Minuten und kann einmal verwendet werden.\n\n' + link }),
      });
      if (!response.ok) throw new Error('mail_failed');
    } catch {
      await env.DB.prepare('DELETE FROM login_links WHERE token_hash = ?').bind(digest).run();
      throw new HttpError(502, 'Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.');
    }
    return json({ sent: true });
  }
  if (url.pathname === '/api/auth/verify') {
    if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new HttpError(400, 'Ungültiger Anmeldelink.');
    const digest = await hash(body.token);
    const now = Date.now();
    const session = token();
    const sessionHash = await hash(session);
    const userId = crypto.randomUUID();
    // One transaction creates the user and session only while the link is unused.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO users(id, name, email)
        SELECT ?, name, email FROM login_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`).bind(userId, digest, now),
      env.DB.prepare(`INSERT INTO sessions SELECT ?, u.id, ? FROM login_links l
        JOIN users u ON u.email = l.email COLLATE NOCASE
        WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ?`).bind(sessionHash, now + 7 * 86400_000, digest, now),
      env.DB.prepare('UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').bind(now, digest, now),
    ]);
    const created = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').bind(sessionHash).first();
    if (!created) throw new HttpError(400, 'Dieser Link ist abgelaufen oder bereits verwendet. Bitte einen neuen anfordern.');
    return json({ signedIn: true }, 200, { 'Set-Cookie': cookie(session, url, 7 * 86400) });
  }
  if (url.pathname === '/api/auth/logout') {
    const value = sessionToken(request);
    if (value) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(value)).run();
    return json({ signedOut: true }, 200, { 'Set-Cookie': cookie('', url, 0) });
  }
  throw new HttpError(404, 'Nicht gefunden.');
}
