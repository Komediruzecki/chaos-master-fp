// Surface loading keeps a usable fallback across GPU failures, retries and teardown races.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOOK_DETAIL_URL } from '../src/almanac/bookDetailData'
import { bookDetailLayout, createBookDetailResources, } from '../src/almanac/bookDetailResources'
import { createSurfaceResources, surfaceDetailLayout, } from '../src/materials/surfaceResources'
import type { TgpuRoot } from 'typegpu'

type Failure =
  | 'texture-unwrap'
  | 'write'
  | 'view'
  | 'binding'
  | 'group-unwrap'
  | null
interface TextureDescriptor {
  size: number[]
  format: string
  mipLevelCount: number
}
interface FakeTexture {
  kind: 'texture'
  descriptor: TextureDescriptor
  destroyed: number
  $usage(): FakeTexture
  createView(): { texture: FakeTexture }
  destroy(): void
}
interface FakeGroup {
  kind: 'group'
  texture: FakeTexture
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function gpuProbe(failure: Failure = null) {
  const state = {
    failure,
    textures: [] as FakeTexture[],
    writes: [] as {
      texture: FakeTexture
      bytes: number
      firstPixel: number[]
    }[],
    scopes: [] as GPUErrorFilter[],
    popped: 0,
    validation: null as GPUError | null,
    pendingValidation: undefined as Promise<GPUError | null> | undefined,
    onPop: () => {},
  }
  const root = {
    device: {
      queue: {
        writeTexture(destination: { texture: FakeTexture }, data: Uint8Array) {
          if (state.failure === 'write') throw new Error('write')
          state.writes.push({
            texture: destination.texture,
            bytes: data.byteLength,
            firstPixel: Array.from(data.subarray(0, 4)),
          })
        },
      },
      pushErrorScope(filter: GPUErrorFilter) {
        state.scopes.push(filter)
      },
      popErrorScope() {
        state.popped++
        state.onPop()
        return state.pendingValidation ?? Promise.resolve(state.validation)
      },
    },
    createSampler() {
      return {}
    },
    createTexture(descriptor: TextureDescriptor) {
      const texture: FakeTexture = {
        kind: 'texture',
        descriptor,
        destroyed: 0,
        $usage() {
          return texture
        },
        createView() {
          if (state.failure === 'view') throw new Error('view')
          return { texture }
        },
        destroy() {
          texture.destroyed++
        },
      }
      state.textures.push(texture)
      return texture
    },
    createBindGroup(
      _layout: unknown,
      values: { surfaceMap: { texture: FakeTexture } },
    ): FakeGroup {
      if (state.failure === 'binding') throw new Error('binding')
      return { kind: 'group', texture: values.surfaceMap.texture }
    },
    unwrap(value: FakeTexture | FakeGroup) {
      if (state.failure === `${value.kind}-unwrap`)
        throw new Error(state.failure)
      return value
    },
  }
  return { root: root as unknown as TgpuRoot, state }
}

/** Synthetic linear pixels with the documented header; no shipping asset dependency. */
function bundle() {
  const bytes = new ArrayBuffer(4_194_332)
  new Uint8Array(bytes).fill(128)
  new Uint8Array(bytes, 0, 8).set(new TextEncoder().encode('LMSURF01'))
  const header = new DataView(bytes)
  ;[512, 512, 3, 10, 4, 4_194_300].forEach((value, index) => {
    header.setUint32(8 + index * 4, value, true)
  })
  return bytes
}

await test('neutral surface is immediately usable and disposal is idempotent', async () => {
  const probe = gpuProbe()
  const resources = createBookDetailResources(probe.root, () => {})
  assert.ok(resources.group)
  assert.deepEqual(resources.snapshot(), {
    status: 'idle',
    error: '',
    downloadBytes: 0,
    textureBytes: 12,
    textureCount: 1,
    uploads: 0,
    mipCount: 1,
  })
  assert.deepEqual(probe.state.textures[0].descriptor, {
    size: [1, 1, 3],
    format: 'rgba8unorm',
    mipLevelCount: 1,
  })
  assert.deepEqual(
    probe.state.writes.map((write) => write.firstPixel),
    Array.from({ length: 3 }, () => [128, 128, 128, 255]),
  )
  resources.dispose()
  resources.dispose()
  await resources.load()
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [1],
  )
  assert.equal(resources.snapshot().textureCount, 0)
  assert.equal(resources.snapshot().textureBytes, 0)
})

await test('successful validation swaps the complete array once and repeated loads reuse it', async (t) => {
  const probe = gpuProbe()
  const response = deferred<Response>()
  const fetch = t.mock.method(globalThis, 'fetch', () => response.promise)
  const resources = createBookDetailResources(probe.root, () => {})
  t.after(() => {
    resources.dispose()
  })
  const fallback = resources.group
  const loading = resources.load()
  await resources.load()
  assert.equal(fetch.mock.callCount(), 1, 'a pending request must be shared')
  assert.equal(resources.group, fallback)
  response.resolve(new Response(bundle()))
  await loading
  assert.notEqual(resources.group, fallback)
  assert.equal(resources.snapshot().status, 'ready')
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [1, 0],
  )
  assert.deepEqual(probe.state.textures[1].descriptor, {
    size: [512, 512, 3],
    format: 'rgba8unorm',
    mipLevelCount: 10,
  })
  assert.equal(
    probe.state.writes.length,
    33,
    'all three layers and all ten mips must be uploaded',
  )
  assert.equal(
    probe.state.writes
      .slice(3)
      .reduce((bytes, write) => bytes + write.bytes, 0),
    4_194_300,
  )
  assert.equal(resources.snapshot().textureBytes, 4_194_300)
  assert.equal(resources.snapshot().downloadBytes, 4_194_332)
  assert.equal(resources.snapshot().uploads, 1)
  const readyGroup = resources.group
  await resources.load()
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(resources.group, readyGroup)
  assert.equal(probe.state.textures.length, 2)
})

await test('HTTP and malformed responses retain the fallback and allow a later retry', async (t) => {
  const responses = [
    new Response(null, { status: 404 }),
    new Response(new Uint8Array(64)),
    new Response(bundle()),
  ]
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(responses.shift()!))
  const probe = gpuProbe()
  const resources = createBookDetailResources(probe.root, () => {})
  t.after(() => {
    resources.dispose()
  })
  const fallback = resources.group
  for (const expected of [/HTTP 404/, /unexpected size/]) {
    await resources.load()
    assert.equal(resources.snapshot().status, 'error')
    assert.match(resources.snapshot().error, expected)
    assert.equal(resources.group, fallback)
    assert.equal(probe.state.textures.length, 1)
    assert.equal(probe.state.textures[0].destroyed, 0)
  }
  await resources.load()
  assert.equal(resources.snapshot().status, 'ready')
  assert.equal(resources.snapshot().error, '')
  assert.notEqual(resources.group, fallback)
})

await test('a late fetch after unmount cannot allocate or notify the disposed renderer', async (t) => {
  const response = deferred<Response>()
  let signal: AbortSignal | null | undefined
  t.mock.method(
    globalThis,
    'fetch',
    (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal
      return response.promise
    },
  )
  const probe = gpuProbe()
  let changes = 0
  const resources = createBookDetailResources(probe.root, () => {
    changes++
  })
  const loading = resources.load()
  resources.dispose()
  const changesAtDispose = changes
  assert.equal(signal?.aborted, true)
  response.resolve(new Response(bundle()))
  await loading
  assert.equal(changes, changesAtDispose)
  assert.equal(probe.state.textures.length, 1)
  assert.equal(probe.state.writes.length, 3)
  assert.equal(resources.snapshot().uploads, 0)
  assert.equal(resources.snapshot().textureCount, 0)
})

await test('asynchronous validation failure rejects the candidate and keeps the fallback available for retry', async (t) => {
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response(bundle())),
  )
  const probe = gpuProbe()
  const validation = deferred<GPUError | null>()
  const entered = deferred<undefined>()
  probe.state.pendingValidation = validation.promise
  probe.state.onPop = () => {
    entered.resolve(undefined)
  }
  const resources = createBookDetailResources(probe.root, () => {})
  t.after(() => {
    resources.dispose()
  })
  const fallback = resources.group
  const loading = resources.load()
  await entered.promise
  assert.equal(
    resources.group,
    fallback,
    'a candidate must not replace the fallback before validation',
  )
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [0, 0],
  )
  validation.resolve({ message: 'Rejected texture validation' })
  await loading
  assert.equal(resources.snapshot().status, 'error')
  assert.match(resources.snapshot().error, /Rejected texture validation/)
  assert.equal(resources.group, fallback)
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [0, 1],
  )
  probe.state.pendingValidation = undefined
  await resources.load()
  assert.equal(resources.snapshot().status, 'ready')
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [1, 1, 0],
  )
})

await test('unmount during GPU validation destroys the unpublished candidate without changing disposed state', async (t) => {
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response(bundle())),
  )
  const probe = gpuProbe()
  const validation = deferred<GPUError | null>()
  const entered = deferred<undefined>()
  probe.state.pendingValidation = validation.promise
  probe.state.onPop = () => {
    entered.resolve(undefined)
  }
  let changes = 0
  const resources = createBookDetailResources(probe.root, () => {
    changes++
  })
  const loading = resources.load()
  await entered.promise
  resources.dispose()
  const atDispose = resources.snapshot()
  const changesAtDispose = changes
  validation.resolve(null)
  await loading
  resources.dispose()
  assert.deepEqual(resources.snapshot(), atDispose)
  assert.equal(changes, changesAtDispose)
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [1, 1],
  )
})

await test('upload and binding failures clean partial candidates, balance validation scopes and remain retryable', async (t) => {
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response(bundle())),
  )
  for (const failure of [
    'texture-unwrap',
    'write',
    'view',
    'binding',
    'group-unwrap',
  ] as const) {
    const probe = gpuProbe()
    const resources = createBookDetailResources(probe.root, () => {})
    const fallback = resources.group
    probe.state.failure = failure
    await resources.load()
    assert.equal(resources.snapshot().status, 'error', failure)
    assert.match(resources.snapshot().error, new RegExp(failure))
    assert.equal(resources.group, fallback)
    assert.deepEqual(
      probe.state.textures.map((texture) => texture.destroyed),
      [0, 1],
      failure,
    )
    assert.deepEqual(probe.state.scopes, ['validation'])
    assert.equal(probe.state.popped, 1)
    probe.state.failure = null
    await resources.load()
    assert.equal(resources.snapshot().status, 'ready', failure)
    resources.dispose()
    resources.dispose()
    assert.deepEqual(
      probe.state.textures.map((texture) => texture.destroyed),
      [1, 1, 1],
      failure,
    )
  }
})

await test('fallback initialization failure releases its partially created texture', () => {
  for (const failure of [
    'texture-unwrap',
    'write',
    'view',
    'binding',
    'group-unwrap',
  ] as const) {
    const probe = gpuProbe(failure)
    assert.throws(
      () => createBookDetailResources(probe.root, () => {}),
      new RegExp(failure),
    )
    assert.deepEqual(
      probe.state.textures.map((texture) => texture.destroyed),
      [1],
      failure,
    )
  }
})

await test('an alternate surface source has its own retry, error label and lifetime beside the book', async (t) => {
  const url = '/models/test/observatory-surfaces.bin'
  const requested: string[] = []
  const responses = [
    new Response(null, { status: 404 }),
    new Response(new Uint8Array(64)),
    new Response(bundle()),
  ]
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL) => {
    const source =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    requested.push(source)
    if (source === BOOK_DETAIL_URL)
      return Promise.resolve(new Response(bundle()))
    assert.equal(source, url, 'the alternate loader must use its own source')
    const response = responses.shift()
    assert.ok(response, 'unexpected extra surface request')
    return Promise.resolve(response)
  })
  const probe = gpuProbe()
  const book = createBookDetailResources(probe.root, () => {})
  const scene = createSurfaceResources(probe.root, () => {}, {
    url,
    label: 'Observatory',
  })
  t.after(() => {
    book.dispose()
    scene.dispose()
  })
  assert.equal(
    bookDetailLayout,
    surfaceDetailLayout,
    'the compatibility export must retain the same binding layout',
  )
  assert.notEqual(
    book.group,
    scene.group,
    'independent sources cannot share a mutable texture binding',
  )
  const sceneFallback = scene.group
  await book.load()
  const readyBook = book.group
  const bookSnapshot = book.snapshot()
  for (const message of [
    'Observatory surface request failed (HTTP 404).',
    'The observatory surface bundle has an unexpected size.',
  ]) {
    await scene.load()
    assert.equal(scene.snapshot().status, 'error')
    assert.equal(scene.snapshot().error, message)
    assert.equal(scene.group, sceneFallback)
    assert.equal(book.group, readyBook)
    assert.deepEqual(book.snapshot(), bookSnapshot)
  }
  await scene.load()
  assert.equal(scene.snapshot().status, 'ready')
  assert.equal(scene.snapshot().uploads, 1)
  assert.equal(scene.snapshot().textureBytes, 4_194_300)
  assert.notEqual(scene.group, sceneFallback)
  scene.dispose()
  scene.dispose()
  assert.equal(book.group, readyBook)
  assert.deepEqual(book.snapshot(), bookSnapshot)
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [1, 1, 0, 1],
  )
  book.dispose()
  assert.deepEqual(
    probe.state.textures.map((texture) => texture.destroyed),
    [1, 1, 1, 1],
  )
  assert.deepEqual(requested, [BOOK_DETAIL_URL, url, url, url])
})
