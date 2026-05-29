export interface Env {
  KV_SHORTENER: KVNamespace
  ASSETS: { fetch: typeof fetch }
}

function generateShortId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  for (let i = 0; i < array.length; i++) {
    id += chars[array[i] % chars.length]
  }
  return id
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Handle API routes
    if (url.pathname === '/api/shorten' && request.method === 'POST') {
      try {
        const { payload } = await request.json<{ payload: string }>()
        if (!payload || typeof payload !== 'string') {
          return new Response(JSON.stringify({ error: 'Invalid payload' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const shortId = generateShortId()
        // Store the payload in KV with the generated ID (expires in 60 days)
        const EXPIRATION_TTL = 60 * 24 * 60 * 60 // 60 days in seconds
        await env.KV_SHORTENER.put(shortId, payload, { expirationTtl: EXPIRATION_TTL })

        return new Response(JSON.stringify({ id: shortId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to process request' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname.startsWith('/api/shorten/') && request.method === 'GET') {
      const shortId = url.pathname.split('/').pop()
      if (!shortId) {
        return new Response(JSON.stringify({ error: 'Missing ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const payload = await env.KV_SHORTENER.get(shortId)
      if (!payload) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ payload }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // Allow caching if necessary, or let the app handle it
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    // For all other requests, let the Cloudflare Assets (frontend) handle them
    return env.ASSETS.fetch(request)
  },
}
