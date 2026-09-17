import { createHash, randomBytes } from 'node:crypto';

/**
 * Social sign-in: Google and Discord, by the OAuth 2.0 authorization-code flow with PKCE, spoken
 * directly — two token endpoints and a user endpoint are not worth a library.
 *
 * A provider exists only when its credentials do, so a server nobody has registered an app for
 * simply offers no sign-in buttons (the client asks `GET /api/me` which ones there are):
 *
 *   RB_GOOGLE_CLIENT_ID + RB_GOOGLE_CLIENT_SECRET    https://console.cloud.google.com/apis/credentials
 *   RB_DISCORD_CLIENT_ID + RB_DISCORD_CLIENT_SECRET  https://discord.com/developers/applications
 *
 * Each app is registered with the redirect URI `<origin>/auth/<provider>/callback`, where the
 * origin is `RB_PUBLIC_URL` (https://rayobandido.com) or, unset, whatever host the request came
 * in on (http://localhost:5173 in development, through Vite's proxy).
 *
 * `RB_AUTH_DEV=1`, outside production, adds a `dev` provider that signs in as whoever the start
 * URL names (`/auth/dev/start?sub=abc&name=KAITO`) without leaving the site. The tests use it; it
 * is also the way to try two devices merging without two Google accounts.
 */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** A fresh PKCE pair and a state value. */
export function newFlow() {
  const verifier = b64url(randomBytes(32));
  return {
    state: b64url(randomBytes(18)),
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
  };
}

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`token endpoint ${response.status}: ${body.error || 'unknown'}`);
  return body;
}

function decodeJwtPayload(jwt) {
  const part = typeof jwt === 'string' ? jwt.split('.')[1] : null;
  if (!part) throw new Error('no id_token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function google(clientId, clientSecret) {
  return {
    id: 'google',
    authorizeUrl({ redirectUri, state, challenge }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchange({ code, redirectUri, verifier }) {
      const token = await postForm('https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      // The ID token came straight from Google's token endpoint over TLS, authenticated with our
      // client secret, so its issuer is established by the connection (OIDC Core 3.1.3.7); the
      // claims that bind it to this app and this moment are still checked.
      const claims = decodeJwtPayload(token.id_token);
      if (claims.aud !== clientId) throw new Error('id_token audience mismatch');
      if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new Error('id_token issuer mismatch');
      if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('id_token expired');
      if (!claims.sub) throw new Error('id_token has no subject');
      return {
        provider: 'google',
        subject: String(claims.sub),
        email: claims.email_verified ? claims.email : null,
        name: claims.given_name || claims.name || null,
        avatar: claims.picture || null,
      };
    },
  };
}

function discord(clientId, clientSecret) {
  return {
    id: 'discord',
    authorizeUrl({ redirectUri, state, challenge }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'none',
      });
      return `https://discord.com/oauth2/authorize?${q}`;
    },
    async exchange({ code, redirectUri, verifier }) {
      const token = await postForm('https://discord.com/api/oauth2/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      const response = await fetch('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`discord user ${response.status}`);
      const user = await response.json();
      if (!user.id) throw new Error('discord user has no id');
      return {
        provider: 'discord',
        subject: String(user.id),
        email: null,
        name: user.global_name || user.username || null,
        avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null,
      };
    },
  };
}

/** The pretend provider: the start URL says who you are, and the callback believes it. */
function dev() {
  return {
    id: 'dev',
    authorizeUrl({ redirectUri, state, hint }) {
      const sub = (hint?.get('sub') || 'dev-player').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'dev-player';
      const name = (hint?.get('name') || 'DEV').slice(0, 40);
      const code = b64url(JSON.stringify({ sub, name }));
      return `${redirectUri}?${new URLSearchParams({ code, state })}`;
    },
    async exchange({ code }) {
      const { sub, name } = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
      return { provider: 'dev', subject: String(sub), email: `${sub}@dev.invalid`, name, avatar: null };
    },
  };
}

/** The providers this server can offer, by id. */
export function createProviders(env = process.env) {
  const out = {};
  if (env.RB_GOOGLE_CLIENT_ID && env.RB_GOOGLE_CLIENT_SECRET) out.google = google(env.RB_GOOGLE_CLIENT_ID, env.RB_GOOGLE_CLIENT_SECRET);
  if (env.RB_DISCORD_CLIENT_ID && env.RB_DISCORD_CLIENT_SECRET) out.discord = discord(env.RB_DISCORD_CLIENT_ID, env.RB_DISCORD_CLIENT_SECRET);
  if (env.RB_AUTH_DEV === '1' && env.NODE_ENV !== 'production') out.dev = dev();
  return out;
}
