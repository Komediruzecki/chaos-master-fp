/* eslint-disable no-restricted-globals */
/**
 * Zero-dependency auth: JWT (HS256 via WebCrypto), PBKDF2 password hashing,
 * anonymous auth, Google OAuth, email/password register/login.
 */

export interface JwtPayload {
  sub: string
  provider: string
  iat: number
  exp: number
}

// 30-day JWT TTL
const JWT_TTL_SECONDS = 30 * 24 * 60 * 60

function base64UrlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '==='.slice(0, (4 - (base64.length % 4)) % 4)
  const raw = atob(padded)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    buf[i] = raw.charCodeAt(i)
  }
  return buf
}

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyData = enc.encode(secret)
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function createJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const full: JwtPayload = { ...payload, iat: now, exp: now + JWT_TTL_SECONDS }

  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
  )
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(full)))

  const key = await getKey(secret)
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${header}.${body}`),
  )

  return `${header}.${body}.${base64UrlEncode(new Uint8Array(sig))}`
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, sig] = parts
    const key = await getKey(secret)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(sig!).buffer,
      new TextEncoder().encode(`${header}.${body}`),
    )
    if (!valid) return null

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(body!).buffer),
    ) as JwtPayload

    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

// PBKDF2 password hashing. The Workers runtime hard-caps PBKDF2 at 100k
// iterations (NotSupportedError above that), so that is our ceiling; the
// iteration count is stored with each hash so it can be raised later without
// breaking existing credentials.
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEY_LEN = 32
const SALT_LEN = 16

async function deriveHex(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    key,
    PBKDF2_KEY_LEN * 8,
  )
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const hashHex = await deriveHex(password, salt, PBKDF2_ITERATIONS)
  return `${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  // Format: `<iterations>:<salt>:<hash>`; two-part legacy rows predate the
  // explicit count and used 600k (unverifiable on Workers — treated as a
  // failed login rather than an exception).
  const parts = stored.split(':')
  const [iterationsStr, saltHex, hashHex] =
    parts.length === 3 ? parts : ['600000', parts[0], parts[1]]
  if (!saltHex || !hashHex) return false
  const iterations = parseInt(iterationsStr ?? '', 10)
  if (!Number.isFinite(iterations) || iterations <= 0) return false

  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  )
  let computedHex: string
  try {
    computedHex = await deriveHex(password, salt, iterations)
  } catch {
    return false
  }
  // Constant-time compare: a straight === leaks the matching prefix length
  // through timing.
  if (computedHex.length !== hashHex.length) return false
  let diff = 0
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ hashHex.charCodeAt(i)
  }
  return diff === 0
}

// Google OAuth token verification
export async function verifyGoogleToken(idToken: string): Promise<{
  sub: string
  email: string
  name: string
  picture?: string
  aud?: string
} | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      sub: string
      email: string
      name: string
      picture?: string
      aud?: string
    }
    return data
  } catch {
    return null
  }
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function isoNow(): string {
  return new Date().toISOString()
}

export interface OAuthState {
  returnTo: string
  ts: number
}

export async function signState(
  state: OAuthState,
  secret: string,
): Promise<string> {
  const enc = new TextEncoder()
  const body = base64UrlEncode(enc.encode(JSON.stringify(state)))
  const key = await getKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${base64UrlEncode(new Uint8Array(sig))}`
}

export async function verifyState(
  raw: string,
  secret: string,
): Promise<OAuthState | null> {
  const parts = raw.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null
  const enc = new TextEncoder()
  const key = await getKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlDecode(sig).buffer,
    enc.encode(body),
  )
  if (!valid) return null
  try {
    const state = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(body).buffer),
    ) as OAuthState
    if (typeof state.returnTo !== 'string' || typeof state.ts !== 'number') {
      return null
    }
    if (Date.now() - state.ts > 10 * 60 * 1000) return null
    return state
  } catch {
    return null
  }
}
