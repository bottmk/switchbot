// Dashboard access control: single shared password (env.DASHBOARD_PASSWORD),
// backed by a signed session cookie so the password isn't re-typed on every visit.
// No server-side session store — the cookie itself is the signed proof (HMAC over
// an expiry timestamp, keyed by the password), so it works statelessly across
// Worker invocations without touching D1.
const COOKIE_NAME = 'sb_auth';
const SESSION_DAYS = 30;

async function hmac(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseCookie(request) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function isAuthed(env, request) {
  const token = parseCookie(request);
  if (!token) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  if (Date.now() > Number(expiry)) return false;
  const expected = await hmac(env.DASHBOARD_PASSWORD, expiry);
  return expected === sig;
}

export async function handleLogin(env, request) {
  const form = await request.formData();
  const password = form.get('password') || '';
  if (password !== env.DASHBOARD_PASSWORD) {
    return new Response(loginHtml('パスワードが違います'), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const expiry = String(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  const sig = await hmac(env.DASHBOARD_PASSWORD, expiry);
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(`${expiry}.${sig}`)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}`;
  return new Response(null, {
    status: 302,
    headers: { Location: '/', 'Set-Cookie': cookie },
  });
}

export function handleLogout() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    },
  });
}

export function loginHtml(error) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ログイン - SwitchBot 温湿度ロガー</title>
  <style>
    :root { color-scheme: dark light; }
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    form { display: flex; flex-direction: column; gap: .6rem; width: min(320px, 90vw); }
    input, button { font: inherit; padding: .6rem; }
    .err { color: #c33; font-size: .85rem; }
  </style>
</head>
<body>
  <form method="post" action="/login">
    <h1 style="font-size:1.1rem;margin:0 0 .5rem">🌡 SwitchBot ログイン</h1>
    ${error ? `<div class="err">${error}</div>` : ''}
    <input type="password" name="password" placeholder="パスワード" autofocus required>
    <button type="submit">ログイン</button>
  </form>
</body>
</html>`;
}
