import { describe, expect, it } from 'vitest'
import { verifyStripeWebhook } from './index'

const SECRET = 'whsec_test_secret'
const PAYLOAD = '{"id":"evt_1","type":"checkout.session.completed"}'

async function sign(payload: string, timestamp: number, secret = SECRET) {
  const encoder = new TextEncoder()
  // eslint-disable-next-line no-restricted-globals
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  // eslint-disable-next-line no-restricted-globals
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${payload}`),
  )
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('verifyStripeWebhook', () => {
  const now = 1_753_000_000

  it('accepts a correctly signed payload', async () => {
    const v1 = await sign(PAYLOAD, now)
    expect(
      await verifyStripeWebhook(PAYLOAD, `t=${now},v1=${v1}`, SECRET, now),
    ).toBe(true)
  })

  it('accepts when any of several v1 entries matches (key rotation)', async () => {
    const v1 = await sign(PAYLOAD, now)
    const stale = 'a'.repeat(64)
    expect(
      await verifyStripeWebhook(
        PAYLOAD,
        `t=${now},v1=${stale},v1=${v1}`,
        SECRET,
        now,
      ),
    ).toBe(true)
  })

  it('rejects a tampered payload', async () => {
    const v1 = await sign(PAYLOAD, now)
    expect(
      await verifyStripeWebhook(
        PAYLOAD.replace('evt_1', 'evt_2'),
        `t=${now},v1=${v1}`,
        SECRET,
        now,
      ),
    ).toBe(false)
  })

  it('rejects a signature made with a different secret', async () => {
    const v1 = await sign(PAYLOAD, now, 'whsec_other')
    expect(
      await verifyStripeWebhook(PAYLOAD, `t=${now},v1=${v1}`, SECRET, now),
    ).toBe(false)
  })

  it('rejects a replayed (expired) timestamp', async () => {
    const old = now - 301
    const v1 = await sign(PAYLOAD, old)
    expect(
      await verifyStripeWebhook(PAYLOAD, `t=${old},v1=${v1}`, SECRET, now),
    ).toBe(false)
  })

  it('rejects malformed signature headers', async () => {
    expect(await verifyStripeWebhook(PAYLOAD, '', SECRET, now)).toBe(false)
    expect(await verifyStripeWebhook(PAYLOAD, 'v1=abc', SECRET, now)).toBe(
      false,
    )
    expect(await verifyStripeWebhook(PAYLOAD, `t=${now}`, SECRET, now)).toBe(
      false,
    )
    expect(
      await verifyStripeWebhook(PAYLOAD, `t=garbage,v1=abc`, SECRET, now),
    ).toBe(false)
  })
})
