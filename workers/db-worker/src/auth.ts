/**
 * Auth module for db-worker.
 *
 * Implements anonymous, Google OAuth, and email/password authentication.
 * Uses WebCrypto for JWT HS256 signing and PBKDF2 password hashing.
 */

export interface JwtPayload {
  sub: string
  provider: string
  iat: number
  exp: number
}

function base64UrlEncode(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function getSigningKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  return globalThis.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function generateToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 30 * 24 * 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  }

  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  )
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(fullPayload)),
  )
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await getSigningKey(secret)
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  )
  const sigB64 = base64UrlEncode(signature)

  return `${signingInput}.${sigB64}`
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, sigB64] = parts
    const signingInput = `${headerB64}.${payloadB64}`

    const key = await getSigningKey(secret)
    const sigBytes = base64UrlDecode(sigB64)
    const isValid = await globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(signingInput),
    )

    if (!isValid) return null

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64))
    const payload = JSON.parse(payloadJson) as JwtPayload

    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return payload
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16)) as Uint8Array
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  const hashBytes = new Uint8Array(derived)
  const combined = new Uint8Array(salt.length + hashBytes.length)
  combined.set(salt)
  combined.set(hashBytes, salt.length)
  let binary = ''
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function verifyPassword(
  password: string,
  hashed: string,
): Promise<boolean> {
  try {
    const decoded = atob(
      hashed.replace(/-/g, '+').replace(/_/g, '/'),
    )
    const bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)

    const salt = bytes.slice(0, 16)
    const storedHash = bytes.slice(16)

    const encoder = new TextEncoder()
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const derived = await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
      keyMaterial,
      256,
    )
    const newHash = new Uint8Array(derived)

    if (newHash.length !== storedHash.length) return false
    for (let i = 0; i < newHash.length; i++) {
      if (newHash[i] !== storedHash[i]) return false
    }
    return true
  } catch {
    return false
  }
}

export async function verifyGoogleToken(
  idToken: string,
): Promise<{ sub: string; email: string; name: string; picture?: string } | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, unknown>
    if (data.error) return null
    return {
      sub: data.sub as string,
      email: data.email as string,
      name: (data.name as string) ?? (data.email as string),
      picture: data.picture as string | undefined,
    }
  } catch {
    return null
  }
}
