import { createContext, createSignal } from 'solid-js'
import { fetchUserProfile, getAuthState, login, loginAnonymous, loginGoogle, logout, register, upgradeAnonymous, } from '@/db/services/auth-service'
import { fetchFeatureFlags, fetchSubscription, } from '@/db/services/render-service'
import { useContextSafe } from '@/utils/useContextSafe'
import type { Accessor, ParentProps } from 'solid-js'
import type { SubscriptionInfo } from '@/db/services/render-service'

export interface AuthContextValue {
  isAuthenticated: Accessor<boolean>
  userId: Accessor<string | null>
  displayName: Accessor<string | null>
  email: Accessor<string | null>
  avatarUrl: Accessor<string | null>
  provider: Accessor<string | null>
  subscription: Accessor<SubscriptionInfo>
  featureFlags: Accessor<Record<string, boolean>>
  loginAnonymous: (deviceId: string) => Promise<void>
  loginGoogle: (idToken: string) => Promise<void>
  register: (
    email: string,
    password: string,
    displayName?: string,
    turnstileToken?: string,
  ) => Promise<void>
  login: (
    email: string,
    password: string,
    turnstileToken?: string,
  ) => Promise<void>
  upgradeAnonymous: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>
  logout: () => void
  refreshSubscription: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>()

export function AuthContextProvider(props: ParentProps) {
  const state = getAuthState()
  const [isAuth, setIsAuth] = createSignal(state.token !== null)
  const [userId, setUserId] = createSignal<string | null>(state.userId)
  const [displayName, setDisplayName] = createSignal<string | null>(
    state.displayName,
  )
  const [email, setEmail] = createSignal<string | null>(state.email)
  const [avatarUrl, setAvatarUrl] = createSignal<string | null>(state.avatarUrl)
  const [provider, setProvider] = createSignal<string | null>(state.provider)
  const [subscription, setSubscription] = createSignal<SubscriptionInfo>({
    tier: 'free',
    rendersThisMonth: 0,
    renderLimitMonthly: 5,
  })
  const [featureFlags, setFeatureFlags] = createSignal<Record<string, boolean>>(
    {},
  )

  function applyState(s: ReturnType<typeof getAuthState>) {
    setIsAuth(s.token !== null)
    setUserId(s.userId)
    setDisplayName(s.displayName)
    setEmail(s.email)
    setAvatarUrl(s.avatarUrl)
    setProvider(s.provider)
  }

  function doLogout() {
    logout()
    applyState(getAuthState())
    setSubscription({
      tier: 'free',
      rendersThisMonth: 0,
      renderLimitMonthly: 5,
    })
  }

  // Load subscription and user profile on mount if authenticated
  if (state.token) {
    void fetchUserProfile().then(() => {
      applyState(getAuthState())
    })
    fetchSubscription()
      .then(setSubscription)
      .catch(() => {})
  }

  // Load feature flags on mount regardless of authentication status
  fetchFeatureFlags()
    .then(setFeatureFlags)
    .catch(() => {})

  const value: AuthContextValue = {
    isAuthenticated: isAuth,
    userId,
    displayName,
    email,
    avatarUrl,
    provider,
    subscription,
    featureFlags,
    loginAnonymous: async (deviceId) => {
      const s = await loginAnonymous(deviceId)
      applyState(s)
      fetchSubscription()
        .then(setSubscription)
        .catch(() => {})
      fetchFeatureFlags()
        .then(setFeatureFlags)
        .catch(() => {})
    },
    loginGoogle: async (idToken) => {
      const s = await loginGoogle(idToken)
      applyState(s)
      fetchSubscription()
        .then(setSubscription)
        .catch(() => {})
      fetchFeatureFlags()
        .then(setFeatureFlags)
        .catch(() => {})
    },
    register: async (email, password, displayName, turnstileToken) => {
      const s = await register(email, password, displayName, turnstileToken)
      applyState(s)
      fetchSubscription()
        .then(setSubscription)
        .catch(() => {})
      fetchFeatureFlags()
        .then(setFeatureFlags)
        .catch(() => {})
    },
    login: async (email, password, turnstileToken) => {
      const s = await login(email, password, turnstileToken)
      applyState(s)
      fetchSubscription()
        .then(setSubscription)
        .catch(() => {})
      fetchFeatureFlags()
        .then(setFeatureFlags)
        .catch(() => {})
    },
    upgradeAnonymous: async (email, password, displayName) => {
      const s = await upgradeAnonymous(email, password, displayName)
      applyState(s)
      fetchSubscription()
        .then(setSubscription)
        .catch(() => {})
    },
    logout: doLogout,
    refreshSubscription: async () => {
      try {
        const sub = await fetchSubscription()
        setSubscription(sub)
      } catch (_) {
        // Ignored
      }
    },
  }

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  )
}

export function useAuth() {
  return useContextSafe(AuthContext, 'useAuth', 'AuthContextProvider')
}
