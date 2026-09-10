/**
 * Auth service: manages auth state, token storage, and API calls.
 * Uses localStorage for token persistence (survives page reloads).
 */

interface AuthState {
  token: string | null
  userId: string | null
  provider: string | null
  displayName: string | null
  email: string | null
  avatarUrl: string | null
}

const STORAGE_KEY = 'chaos-master-auth'

function loadState(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as AuthState
  } catch {
    /* ignore */
  }
  return {
    token: null,
    userId: null,
    provider: null,
    displayName: null,
    email: null,
    avatarUrl: null,
  }
}

function saveState(state: AuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function clearState(): void {
  localStorage.removeItem(STORAGE_KEY)
}

let _state = loadState()

export function getAuthState(): Readonly<AuthState> {
  return _state
}

export function getAuthHeaders(): Record<string, string> {
  if (_state.token) {
    return { Authorization: `Bearer ${_state.token}` }
  }
  return {}
}

export function isAuthenticated(): boolean {
  return _state.token !== null
}

// ── Auth operations ──────────────────────────────────────────

export async function loginAnonymous(deviceId: string): Promise<AuthState> {
  const res = await fetch('/api/auth/anonymous', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Auth failed' }))
    throw new Error((err as { error: string }).error)
  }
  const data = (await res.json()) as {
    token: string
    user: { id: string; displayName: string }
  }
  _state = {
    token: data.token,
    userId: data.user.id,
    provider: 'anonymous',
    displayName: data.user.displayName,
    email: null,
    avatarUrl: null,
  }
  saveState(_state)
  return _state
}

export async function loginGoogle(idToken: string): Promise<AuthState> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Auth failed' }))
    throw new Error((err as { error: string }).error)
  }
  const data = (await res.json()) as {
    token: string
    user: {
      id: string
      displayName: string
      email?: string
      avatarUrl?: string
    }
  }
  _state = {
    token: data.token,
    userId: data.user.id,
    provider: 'google',
    displayName: data.user.displayName,
    email: data.user.email || null,
    avatarUrl: data.user.avatarUrl || null,
  }
  saveState(_state)
  return _state
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
  turnstileToken?: string,
): Promise<AuthState> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName, turnstileToken }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Registration failed' }))
    throw new Error((err as { error: string }).error)
  }
  const data = (await res.json()) as {
    token: string
    user: { id: string; displayName: string; email?: string }
  }
  _state = {
    token: data.token,
    userId: data.user.id,
    provider: 'email',
    displayName: data.user.displayName,
    email: data.user.email || email,
    avatarUrl: null,
  }
  saveState(_state)
  return _state
}

export async function login(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<AuthState> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, turnstileToken }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Login failed' }))
    throw new Error((err as { error: string }).error)
  }
  const data = (await res.json()) as {
    token: string
    user: {
      id: string
      displayName: string
      email?: string
      avatarUrl?: string
    }
  }
  _state = {
    token: data.token,
    userId: data.user.id,
    provider: 'email',
    displayName: data.user.displayName,
    email: data.user.email || null,
    avatarUrl: data.user.avatarUrl || null,
  }
  saveState(_state)
  return _state
}

export async function upgradeAnonymous(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthState> {
  const res = await fetch('/api/auth/upgrade', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ email, password, displayName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upgrade failed' }))
    throw new Error((err as { error: string }).error)
  }
  const data = (await res.json()) as {
    token: string
    user: { id: string; displayName: string; email?: string }
  }
  _state = {
    token: data.token,
    userId: data.user.id,
    provider: 'email',
    displayName: data.user.displayName,
    email: data.user.email || email,
    avatarUrl: null,
  }
  saveState(_state)
  return _state
}

export async function fetchUserProfile(): Promise<void> {
  if (!_state.token) return
  const res = await fetch('/api/auth/me', { headers: getAuthHeaders() })
  if (res.ok) {
    const data = (await res.json()) as {
      id: string
      displayName: string
      email?: string
      avatarUrl?: string
      authProvider: string
    }
    _state = {
      ..._state,
      userId: data.id,
      displayName: data.displayName,
      email: data.email || null,
      avatarUrl: data.avatarUrl || null,
      provider: data.authProvider,
    }
    saveState(_state)
  }
}

export function logout(): void {
  _state = {
    token: null,
    userId: null,
    provider: null,
    displayName: null,
    email: null,
    avatarUrl: null,
  }
  clearState()
}

export function googleSignInUrl(): string {
  sessionStorage.setItem('chaos:gauthReturnHash', window.location.hash)
  const returnTo =
    window.location.origin + window.location.pathname + window.location.search
  const params = new URLSearchParams({ returnTo })
  return `/api/auth/google/start?${params.toString()}`
}

export function consumeGoogleRedirect(): void {
  const hash = window.location.hash
  if (!hash.startsWith('#gauth')) return
  const params = new URLSearchParams(hash.slice(1))
  const token = params.get('gauth')
  const error = params.get('gauth_error')
  if (token) {
    _state = {
      token,
      userId: null,
      provider: 'google',
      displayName: null,
      email: null,
      avatarUrl: null,
    }
    saveState(_state)
  } else if (error) {
    console.error('Google login failed:', error)
  }
  const returnHash = sessionStorage.getItem('chaos:gauthReturnHash') ?? ''
  sessionStorage.removeItem('chaos:gauthReturnHash')
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search + returnHash,
  )
}
