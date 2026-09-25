// Contract doubles test draft-API lifetimes, not native headset compatibility.
import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeXr } from '../src/nativeXr'
import { collectXrTargets } from '../src/xrTypes'
import type { XrCallbacks } from '../src/nativeXr'
import type { GpuXrBindingConstructor } from '../src/xrTypes'

const device = {} as GPUDevice
const layer = {} as XRProjectionLayer
const identity = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])
const pose = {
  views: ['left', 'right'].map((eye, i) => ({
    eye,
    projectionMatrix: identity,
    transform: {
      position: { x: (i - 0.5) * 0.063, y: 1.6, z: 0 },
      inverse: {
        matrix: Float32Array.from(identity, (v, j) =>
          j === 12 ? (0.5 - i) * 0.063 : v,
        ),
      },
    },
  })),
} as unknown as XRViewerPose

class Session extends EventTarget {
  visibilityState = 'visible'
  callbacks = new Map<number, XRFrameRequestCallback>()
  updates: XRRenderStateInit[] = []
  spaces: string[] = []
  ended = 0
  sequence = 0
  requestReferenceSpace(type: string) {
    this.spaces.push(type)
    return Promise.resolve({} as XRReferenceSpace)
  }
  updateRenderState(init: XRRenderStateInit) {
    this.updates.push(init)
    return Promise.resolve()
  }
  requestAnimationFrame(fn: XRFrameRequestCallback) {
    this.callbacks.set(++this.sequence, fn)
    return this.sequence
  }
  cancelAnimationFrame(id: number) {
    this.callbacks.delete(id)
  }
  end() {
    this.ended++
    this.dispatchEvent(new Event('end'))
    return Promise.resolve()
  }
  frame(viewerPose: XRViewerPose | null = pose) {
    const entries = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const fn of entries)
      fn(100, { getViewerPose: () => viewerPose } as unknown as XRFrame)
  }
}

function fixture() {
  const session = new Session()
  const calls: {
    starts: number
    frames: number
    ends: number
    selections: number
    errors: string[]
    options?: XRSessionInit
  } = { starts: 0, frames: 0, ends: 0, selections: 0, errors: [] }
  const descriptors: GPUTextureViewDescriptor[] = []
  const texture = {
    createView: (descriptor: GPUTextureViewDescriptor) => {
      descriptors.push(descriptor)
      return {} as GPUTextureView
    },
  } as GPUTexture
  const binding = {
    getPreferredColorFormat: () => 'bgra8unorm' as const,
    createProjectionLayer: (init: { colorFormat: GPUTextureFormat }) => {
      assert.equal(init.colorFormat, 'bgra8unorm')
      return layer
    },
    getViewSubImage: (_layer: XRProjectionLayer, view: XRView) => ({
      colorTexture: texture,
      viewport: { x: 0, y: 0, width: 800, height: 900 },
      getViewDescriptor: () => ({
        dimension: '2d' as const,
        baseArrayLayer: view.eye === 'left' ? 0 : 1,
        arrayLayerCount: 1,
      }),
    }),
  }
  const Binding = function () {
    return binding
  } as unknown as GpuXrBindingConstructor
  const system = {
    requestSession: (_mode: string, options: XRSessionInit) => {
      calls.options = options
      return Promise.resolve(session as unknown as XRSession)
    },
  } as XRSystem
  const callbacks: XrCallbacks = {
    start: (format) => {
      assert.equal(format, 'bgra8unorm')
      calls.starts++
    },
    frame: (_time, targets) => {
      calls.frames++
      assert.equal(targets.length, 2)
      assert.notDeepEqual(targets[0].view, targets[1].view)
    },
    end: () => {
      calls.ends++
    },
    select: () => {
      calls.selections++
    },
    error: (message) => calls.errors.push(message),
  }
  return { session, calls, binding, Binding, system, callbacks, descriptors }
}

await test('required WebGPU session, per-eye slices, selection, missing pose, exit and reentry', async () => {
  const f = fixture()
  const xr = new NativeXr(f.system, f.Binding, device, f.callbacks)
  await xr.enter()
  assert.deepEqual(f.calls.options?.requiredFeatures, ['webgpu'])
  assert.deepEqual(f.session.updates[0].layers, [layer])
  assert.equal(f.session.updates[0].baseLayer, undefined)
  f.session.frame(null)
  assert.equal(f.calls.frames, 0)
  f.session.frame()
  assert.deepEqual(
    f.descriptors.map((v) => v.baseArrayLayer),
    [0, 1],
  )
  f.session.dispatchEvent(new Event('select'))
  assert.equal(f.calls.selections, 1)
  await xr.exit()
  assert.equal(f.session.callbacks.size, 0)
  f.session.dispatchEvent(new Event('select'))
  assert.equal(f.calls.selections, 1, 'Input listener must be detached')
  await xr.enter()
  f.session.frame()
  assert.equal(f.calls.starts, 2)
  assert.equal(f.calls.frames, 2)
  xr.dispose()
  assert.equal(f.session.callbacks.size, 0)
  assert.deepEqual(f.calls.errors, [])
})

await test('subimage views are reacquired each frame and atlas viewports do not erase the first eye', () => {
  const f = fixture()
  const first = collectXrTargets(f.binding, layer, pose)
  const second = collectXrTargets(f.binding, layer, pose)
  assert.equal(f.descriptors.length, 4)
  assert.notEqual(first[0].color, second[0].color)
  assert.deepEqual(
    first.map((v) => v.clear),
    [true, true],
  )
  const arrayImage = f.binding.getViewSubImage
  f.binding.getViewSubImage = (l, v) => ({
    ...arrayImage(l, v),
    viewport: { x: v.eye === 'left' ? 0 : 800, y: 0, width: 800, height: 900 },
    getViewDescriptor: () => ({
      dimension: '2d',
      baseArrayLayer: 0,
      arrayLayerCount: 1,
    }),
  })
  const atlas = collectXrTargets(f.binding, layer, pose)
  assert.deepEqual(
    atlas.map((v) => v.clear),
    [true, false],
  )
  assert.deepEqual(
    atlas.map((v) => v.viewport.x),
    [0, 800],
  )
})

await test('binding failure ends the granted session and reports a recoverable error', async () => {
  const f = fixture()
  const Broken = function () {
    throw new Error('binding unsupported')
  } as unknown as GpuXrBindingConstructor
  const xr = new NativeXr(f.system, Broken, device, f.callbacks)
  await xr.enter()
  assert.equal(f.session.ended, 1)
  assert.equal(f.calls.ends, 1)
  assert.match(f.calls.errors[0], /binding unsupported/)
  assert.equal(f.session.callbacks.size, 0)
})

await test('disposal while permission is pending ends the late session without rendering', async () => {
  const f = fixture()
  let resolve!: (session: XRSession) => void
  f.system.requestSession = () =>
    new Promise<XRSession>((r) => {
      resolve = r
    })
  const xr = new NativeXr(f.system, f.Binding, device, f.callbacks)
  const entry = xr.enter()
  xr.dispose()
  resolve(f.session as unknown as XRSession)
  await entry
  assert.equal(f.session.ended, 1)
  assert.equal(f.calls.starts, 0)
  assert.equal(f.session.callbacks.size, 0)
})

await test('session ending during reference-space negotiation cannot start a stale loop', async () => {
  const f = fixture()
  f.session.requestReferenceSpace = async () => {
    await f.session.end()
    return {} as XRReferenceSpace
  }
  const xr = new NativeXr(f.system, f.Binding, device, f.callbacks)
  await xr.enter()
  assert.equal(f.calls.starts, 0)
  assert.equal(f.session.callbacks.size, 0)
})

await test('frame exception closes the session instead of leaving an invisible loop', async () => {
  const f = fixture()
  f.callbacks.frame = () => {
    throw new Error('expired subimage')
  }
  const xr = new NativeXr(f.system, f.Binding, device, f.callbacks)
  await xr.enter()
  f.session.frame()
  assert.equal(f.session.ended, 1)
  assert.equal(f.session.callbacks.size, 0)
  assert.match(f.calls.errors[0], /expired subimage/)
})

await test('permission denial is reported without starting a frame loop', async () => {
  const f = fixture()
  f.system.requestSession = () =>
    Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
  const xr = new NativeXr(f.system, f.Binding, device, f.callbacks)
  await xr.enter()
  assert.equal(f.calls.starts, 0)
  assert.equal(f.calls.ends, 1)
  assert.match(f.calls.errors[0], /NotAllowedError/)
  assert.equal(f.session.callbacks.size, 0)
})

await test('blurred sessions pause simulation and hidden sessions never request textures', async () => {
  const f = fixture()
  const visibility: boolean[] = []
  f.callbacks.frame = (_time, _targets, visible) => {
    visibility.push(visible)
  }
  const xr = new NativeXr(f.system, f.Binding, device, f.callbacks)
  await xr.enter()
  f.session.visibilityState = 'visible-blurred'
  f.session.frame()
  const viewsBeforeHidden = f.descriptors.length
  f.session.visibilityState = 'hidden'
  f.session.frame()
  assert.equal(f.descriptors.length, viewsBeforeHidden)
  f.session.visibilityState = 'visible'
  f.session.frame()
  assert.deepEqual(visibility, [false, true])
  xr.dispose()
})

await test('local-space fallback offsets the estimated floor and reports the assumption', async () => {
  const f = fixture()
  const globals = globalThis as typeof globalThis & {
    XRRigidTransform?: typeof XRRigidTransform
  }
  const previous = globals.XRRigidTransform
  globals.XRRigidTransform = function (position: DOMPointInit) {
    return { position }
  } as unknown as typeof XRRigidTransform
  try {
    f.session.requestReferenceSpace = (type) => {
      if (type === 'local-floor') return Promise.reject(new Error('No floor'))
      return Promise.resolve({
        getOffsetReferenceSpace: (transform: XRRigidTransform) => {
          assert.equal(transform.position.y, -1.6)
          return {} as XRReferenceSpace
        },
      } as XRReferenceSpace)
    }
    f.callbacks.start = (_format, reference) => {
      assert.match(reference, /estimated 1.6 m floor/)
      f.calls.starts++
    }
    const xr = new NativeXr(f.system, f.Binding, device, f.callbacks)
    await xr.enter()
    assert.equal(f.calls.starts, 1)
    assert.deepEqual(f.calls.errors, [])
    xr.dispose()
  } finally {
    if (previous) globals.XRRigidTransform = previous
    else delete globals.XRRigidTransform
  }
})
