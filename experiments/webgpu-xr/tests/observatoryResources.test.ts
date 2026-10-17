// Partial model setup must release every buffer before an asset can be retried.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModelPass, primitiveGeometry, } from '../src/observatory/modelPass'

type Failure =
  | 'second-buffer'
  | 'vertex-upload'
  | 'index-upload'
  | 'pipeline'
  | 'camera-binding'
  | 'unwrap'
  | 'instance-binding'
  | null

function resourceProbe(failure: Failure) {
  const buffers: { destroyed: number }[] = []
  let bindings = 0
  const pipeline = {
    with() {
      return pipeline
    },
    withIndexBuffer() {
      return pipeline
    },
    drawIndexed() {},
  }
  const root = {
    createBuffer() {
      if (failure === 'second-buffer' && buffers.length === 1)
        throw new Error('second-buffer')
      const index = buffers.length
      const state = { destroyed: 0 }
      buffers.push(state)
      const buffer = {
        $usage() {
          return buffer
        },
        write() {
          if (
            (index === 0 && failure === 'vertex-upload') ||
            (index === 1 && failure === 'index-upload')
          )
            throw new Error(failure)
        },
        destroy() {
          state.destroyed++
        },
      }
      return buffer
    },
    createRenderPipeline() {
      if (failure === 'pipeline') throw new Error(failure)
      return pipeline
    },
    createBindGroup() {
      bindings++
      if (
        (bindings === 1 && failure === 'camera-binding') ||
        (bindings === 2 && failure === 'instance-binding')
      )
        throw new Error(failure)
      return {}
    },
    unwrap() {
      if (failure === 'unwrap') throw new Error(failure)
    },
  }
  return {
    root: root as unknown as Parameters<typeof createModelPass>[0],
    buffers,
  }
}

const camera = {} as Parameters<typeof createModelPass>[1]
const geometry = primitiveGeometry('beam')

await test('failed model setup releases buffers across allocation, upload, binding and pipeline failures', () => {
  for (const failure of [
    'second-buffer',
    'vertex-upload',
    'index-upload',
    'pipeline',
    'camera-binding',
    'unwrap',
  ] as const) {
    const probe = resourceProbe(failure)
    assert.throws(
      () => createModelPass(probe.root, camera, geometry),
      new RegExp(failure),
    )
    assert.ok(probe.buffers.length > 0)
    assert.ok(
      probe.buffers.every((buffer) => buffer.destroyed === 1),
      failure,
    )
  }
})

await test('failed instance binding releases its new uniform while model geometry remains reusable', () => {
  const probe = resourceProbe('instance-binding')
  const model = createModelPass(probe.root, camera, geometry)
  assert.throws(() => {
    model.draw({} as GPURenderPassEncoder, 'test', new Float32Array(16))
  }, /instance-binding/)
  assert.deepEqual(
    probe.buffers.map((buffer) => buffer.destroyed),
    [0, 0, 1],
  )
  model.dispose()
  assert.deepEqual(
    probe.buffers.map((buffer) => buffer.destroyed),
    [1, 1, 1],
  )
})
