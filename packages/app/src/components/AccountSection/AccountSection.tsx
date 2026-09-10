import { createSignal, For, Show } from 'solid-js'
import { Button } from '@/components/Button/Button'
import { useRequestModal } from '@/components/Modal/ModalContext'
import { ModalTitleBar } from '@/components/Modal/ModalTitleBar'
import { TurnstileBox, turnstileEnabled, } from '@/components/Turnstile/TurnstileBox'
import { useAuth } from '@/contexts/AuthContext'
import { googleSignInUrl } from '@/db/services/auth-service'
import { createCheckoutSession, createPortalSession, } from '@/db/services/render-service'
import { IS_DEV } from '@/defaults'
import { Eye, Zap } from '@/icons'
import ui from './AccountSection.module.css'

// Keep in sync with the worker's CREDIT_PACKS / SUBSCRIPTION_PLANS.
const CREDIT_PACK_CARDS = [
  { sku: 'starter', name: 'Starter', credits: 10, price: '$5' },
  { sku: 'creator', name: 'Creator', credits: 50, price: '$15' },
  { sku: 'pro', name: 'Pro', credits: 200, price: '$40' },
]

// Distinct, subtle per-card accent hues, cycled by card position
// (mercurypitch PricingPanel idiom).
const CARD_ACCENTS = ['#5b8def', '#28c2a8', '#b57bf0', '#f2a64d', '#ef6f9b']

const cardVars = (index: number, offset = 0) => ({
  '--card-accent': CARD_ACCENTS[(index + offset) % CARD_ACCENTS.length],
  '--sheen-delay': `${-index * 1.1}s`,
})

/** Password input with an in-field reveal toggle (Eye icon). */
function PasswordInput(props: {
  value: string
  onInput: (value: string) => void
  onEnter?: () => void
  placeholder?: string
}) {
  const [revealed, setRevealed] = createSignal(false)
  return (
    <div class={ui.passwordWrap}>
      <input
        type={revealed() ? 'text' : 'password'}
        class={ui.input}
        value={props.value}
        onInput={(e) => {
          props.onInput(e.currentTarget.value)
        }}
        placeholder={props.placeholder ?? '••••••••'}
        onKeyDown={(e) => e.key === 'Enter' && props.onEnter?.()}
      />
      <button
        type="button"
        class={ui.eyeBtn}
        aria-label={revealed() ? 'Hide password' : 'Show password'}
        aria-pressed={revealed()}
        onClick={() => setRevealed((r) => !r)}
      >
        <Eye />
      </button>
    </div>
  )
}

export function AccountSection() {
  const auth = useAuth()
  const requestModal = useRequestModal()

  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [displayName, setDisplayName] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  // Bot check shared by the Sign-In and Register tabs; tokens are single-use,
  // so every attempt resets the widget afterwards.
  const [turnstileToken, setTurnstileToken] = createSignal('')
  let resetTurnstile: (() => void) | undefined

  async function handleLogin() {
    setError('')
    setLoading(true)
    try {
      await auth.login(email(), password(), turnstileToken() || undefined)
      reactivate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
      resetTurnstile?.()
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister() {
    setError('')
    if (password().length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      await auth.register(
        email(),
        password(),
        displayName() || undefined,
        turnstileToken() || undefined,
      )
      reactivate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed')
      resetTurnstile?.()
    } finally {
      setLoading(false)
    }
  }

  function handleGoogleLogin() {
    setError('')
    setLoading(true)
    try {
      window.location.href = googleSignInUrl()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google login failed')
      setLoading(false)
    }
  }

  let reactivate: () => void

  async function showDialog() {
    setEmail('')
    setPassword('')
    setDisplayName('')
    setError('')
    setLoading(false)

    const [stripeDisabled, setStripeDisabled] = createSignal(false)
    const [successMessage, setSuccessMessage] = createSignal('')

    async function handlePurchase(
      type: 'credits' | 'subscription',
      sku: string,
    ) {
      try {
        const { url } = await createCheckoutSession(type, sku)
        if (IS_DEV) {
          await auth.refreshSubscription()
          const capitalizedSku = sku.charAt(0).toUpperCase() + sku.slice(1)
          setSuccessMessage(
            `Subscription updated successfully: ${capitalizedSku}`,
          )
          setTimeout(() => setSuccessMessage(''), 5000)
        } else {
          window.location.href = url
        }
      } catch (e) {
        if (
          !IS_DEV &&
          e instanceof Error &&
          'status' in e &&
          (e as Error & { status: number }).status === 503
        ) {
          setStripeDisabled(true)
        } else {
          setError(e instanceof Error ? e.message : 'Purchase failed')
        }
      }
    }

    async function handleManage() {
      try {
        const { url } = await createPortalSession()
        if (IS_DEV) {
          await auth.refreshSubscription()
          setSuccessMessage(
            'Subscription cancelled. Downgraded back to Free tier.',
          )
          setTimeout(() => setSuccessMessage(''), 5000)
        } else {
          window.location.href = url
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to open billing')
      }
    }

    type Tab = 'login' | 'register'
    const [tab, setTab] = createSignal<Tab>('login')

    await requestModal({
      class: ui.container,
      content: ({ respond }) => {
        reactivate = () => {
          respond()
        }

        return (
          <>
            <ModalTitleBar
              onClose={() => {
                respond()
              }}
            >
              Account
            </ModalTitleBar>
            <div class={ui.dialogBody}>
              <Show when={successMessage()}>
                <div class={ui.success}>{successMessage()}</div>
              </Show>

              <Show when={auth.isAuthenticated()}>
                <div class={ui.profile}>
                  <div class={ui.avatar}>
                    {auth.displayName()?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div class={ui.profileInfo}>
                    <span class={ui.name}>{auth.displayName()}</span>
                    <Show when={auth.email()}>
                      <span class={ui.email}>{auth.email()}</span>
                    </Show>
                    <div class={ui.tierRow}>
                      <span
                        class={`${ui.tierBadge} ${
                          auth.subscription().tier === 'pro'
                            ? ui.tierPro
                            : auth.subscription().tier === 'premium'
                              ? ui.tierPremium
                              : ui.tierFree
                        }`}
                      >
                        {auth.subscription().tier}
                      </span>
                      <span class={ui.rendersText}>
                        {auth.subscription().rendersThisMonth}/
                        {auth.subscription().renderLimitMonthly} renders this
                        month
                      </span>
                    </div>
                  </div>
                  <Show when={auth.subscription().credits !== undefined}>
                    <div class={ui.creditsPill}>
                      <span class={ui.creditsValue}>
                        <Zap />
                        {auth.subscription().credits}
                      </span>
                      <span class={ui.creditsLabel}>credits</span>
                    </div>
                  </Show>
                </div>
                <div class={ui.plans}>
                  <Show
                    when={
                      auth.subscription().tier === 'free' ||
                      auth.subscription().tier === 'premium'
                    }
                  >
                    <div class={ui.sectionLabel}>Buy Render Credits</div>
                    <div class={ui.cardGrid}>
                      <For each={CREDIT_PACK_CARDS}>
                        {(pack, i) => (
                          <button
                            class={ui.card}
                            style={cardVars(i())}
                            onClick={() => handlePurchase('credits', pack.sku)}
                          >
                            <span class={ui.cardName}>{pack.name}</span>
                            <span class={ui.cardCredits}>
                              {pack.credits}
                              <span class={ui.cardUnit}>renders</span>
                            </span>
                            <span class={ui.cardPrice}>{pack.price}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>

                  <div class={ui.sectionLabel}>Monthly Subscription</div>
                  <div class={ui.cardGrid}>
                    <Show when={auth.subscription().tier === 'free'}>
                      <button
                        class={ui.card}
                        style={cardVars(0, 2)}
                        onClick={() =>
                          handlePurchase('subscription', 'premium')
                        }
                      >
                        <span class={ui.cardName}>Premium</span>
                        <span class={ui.cardCredits}>
                          50
                          <span class={ui.cardUnit}>renders / month</span>
                        </span>
                        <span class={ui.cardPrice}>$8 / month</span>
                      </button>
                    </Show>
                    <Show when={auth.subscription().tier !== 'pro'}>
                      <button
                        class={ui.card}
                        style={cardVars(1, 2)}
                        onClick={() =>
                          handlePurchase('subscription', 'pro_sub')
                        }
                      >
                        <span class={ui.cardName}>Pro</span>
                        <span class={ui.cardCredits}>
                          200
                          <span class={ui.cardUnit}>renders / month</span>
                        </span>
                        <span class={ui.cardPrice}>$20 / month</span>
                      </button>
                    </Show>
                  </div>
                  <Show when={auth.subscription().stripeCustomerId}>
                    <div class={ui.manageRow}>
                      <span class={ui.rendersText}>
                        Change or cancel any time
                      </span>
                      <Button onClick={handleManage}>Manage Billing</Button>
                    </div>
                  </Show>
                </div>

                <Show when={stripeDisabled()}>
                  <div class={ui.devNote}>
                    Stripe checkout is currently unavailable
                  </div>
                </Show>

                <Show when={IS_DEV}>
                  <div class={ui.devNote}>
                    DEV MODE — Click any plan to upgrade instantly (mock Stripe)
                  </div>
                </Show>

                <Button
                  onClick={() => {
                    auth.logout()
                    respond()
                  }}
                >
                  Sign Out
                </Button>
              </Show>

              <Show when={!auth.isAuthenticated()}>
                <div class={ui.tabs}>
                  <button
                    class={`${ui.tab} ${tab() === 'login' ? ui.activeTab : ''}`}
                    onClick={() => setTab('login')}
                  >
                    Sign In
                  </button>
                  <button
                    class={`${ui.tab} ${tab() === 'register' ? ui.activeTab : ''}`}
                    onClick={() => setTab('register')}
                  >
                    Register
                  </button>
                </div>

                <Show when={turnstileEnabled()}>
                  <TurnstileBox
                    onToken={setTurnstileToken}
                    resetRef={(reset) => (resetTurnstile = reset)}
                  />
                </Show>

                <Show when={tab() === 'login'}>
                  <label class={ui.field}>
                    <span>Email</span>
                    <input
                      type="email"
                      class={ui.input}
                      value={email()}
                      onInput={(e) => setEmail(e.currentTarget.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label class={ui.field}>
                    <span>Password</span>
                    <PasswordInput
                      value={password()}
                      onInput={setPassword}
                      onEnter={handleLogin}
                    />
                  </label>
                  <Show when={error()}>
                    <div class={ui.error}>{error()}</div>
                  </Show>
                  <Button onClick={handleLogin} disabled={loading()}>
                    {loading() ? 'Signing in...' : 'Sign In'}
                  </Button>

                  <div class={ui.divider}>
                    <span>or</span>
                  </div>

                  <Button onClick={handleGoogleLogin} disabled={loading()}>
                    Sign in with Google
                  </Button>
                </Show>

                <Show when={tab() === 'register'}>
                  <label class={ui.field}>
                    <span>Display Name (optional)</span>
                    <input
                      type="text"
                      class={ui.input}
                      value={displayName()}
                      onInput={(e) => setDisplayName(e.currentTarget.value)}
                      placeholder="Explorer"
                    />
                  </label>
                  <label class={ui.field}>
                    <span>Email</span>
                    <input
                      type="email"
                      class={ui.input}
                      value={email()}
                      onInput={(e) => setEmail(e.currentTarget.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label class={ui.field}>
                    <span>Password (min 8 characters)</span>
                    <PasswordInput
                      value={password()}
                      onInput={setPassword}
                      onEnter={handleRegister}
                    />
                  </label>
                  <Show when={error()}>
                    <div class={ui.error}>{error()}</div>
                  </Show>
                  <Button onClick={handleRegister} disabled={loading()}>
                    {loading() ? 'Creating account...' : 'Create Account'}
                  </Button>
                </Show>

                <Show when={auth.provider() === 'anonymous'}>
                  <div class={ui.upgradeNote}>
                    You're using an anonymous account. Register to save your
                    data permanently.
                  </div>
                </Show>
              </Show>
            </div>
          </>
        )
      },
    })
  }

  return (
    <Button onClick={showDialog}>
      {auth.isAuthenticated() ? auth.displayName() || 'Account' : 'Sign In'}
    </Button>
  )
}
