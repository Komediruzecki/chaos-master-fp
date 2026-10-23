/** Development-only, bounded GPU diagnostics using the production particle solver. */
import { tgpu } from 'typegpu'
import { createGummyParticleSolver } from '../src/simulation/gummy/gummyParticleSolver.ts'

const runButton = document.querySelector('#run')
const copyButton = document.querySelector('#copy')
const output = document.querySelector('#result')
const status = document.querySelector('#status')
const tickCount = 12
let cancelActive

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Include non-finite diagnostics without letting JSON turn NaN into a misleading null. */
function summarize(state, before, grip) {
  let maxDisplacement = 0
  let movedParticles = 0
  let nonFiniteValues = 0
  let gripRegionCount = 0
  const meanGripDelta = [0, 0, 0]
  for (const value of Object.values(state)) {
    if (typeof value === 'number') nonFiniteValues += !Number.isFinite(value)
    else if (ArrayBuffer.isView(value))
      for (const component of value)
        nonFiniteValues += !Number.isFinite(component)
  }
  for (let i = 0; i < before.length; i += 4) {
    const distance = Math.hypot(
      state.positions[i] - before[i],
      state.positions[i + 1] - before[i + 1],
      state.positions[i + 2] - before[i + 2],
    )
    if (Number.isFinite(distance)) {
      maxDisplacement = Math.max(maxDisplacement, distance)
      if (distance > 1e-5) movedParticles++
      if (
        before[i + 3] > 0 &&
        Math.hypot(
          before[i] - grip.center[0],
          before[i + 1] - grip.center[1],
          before[i + 2] - grip.center[2],
        ) < grip.radius
      ) {
        gripRegionCount++
        for (let axis = 0; axis < 3; axis++)
          meanGripDelta[axis] += state.positions[i + axis] - before[i + axis]
      }
    }
  }
  return {
    gripCount: state.gripCount,
    maxDisplacement,
    movedParticles,
    gripRegionCount,
    meanGripDelta: meanGripDelta.map(
      (value) => value / Math.max(1, gripRegionCount),
    ),
    nonFiniteValues,
    simulationTime: state.simulationTime,
    maxParticleSpeed: state.maxParticleSpeed,
    maxGridSpeed: state.maxGridSpeed,
    guardActivations: state.guardActivations,
    deformationRejections: state.deformationRejections,
  }
}

/** Match a real unpinned arm sample so a missing grip is not an empty-space test. */
function chooseGrip(rest) {
  let best = -1
  let nearest = Infinity
  for (let i = 0; i < rest.length; i += 4) {
    if (rest[i + 3] <= 0) continue
    const distance = Math.hypot(rest[i] - 0.7, rest[i + 1] - 1.35, rest[i + 2])
    if (distance < nearest) {
      best = i
      nearest = distance
    }
  }
  if (best < 0) throw new Error('The probe bear has no movable particles')
  const center = Array.from(rest.subarray(best, best + 3))
  return {
    center,
    target: [center[0] + 0.35, center[1], center[2]],
    radius: 0.26,
  }
}

/** Compare legacy f32 index decoding with exact u32 decoding and CPU expectations. */
async function checkGridDecode(device, scoped, checkActive) {
  const count = 48 ** 3
  const size = count * 8 * 4
  const buffers = []
  const own = (buffer) => {
    buffers.push(buffer)
    return buffer
  }
  try {
    const result = own(
      device.createBuffer({
        size,
        usage: window.GPUBufferUsage.STORAGE | window.GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true,
      }),
    )
    new Uint32Array(result.getMappedRange()).fill(0xffffffff)
    result.unmap()
    const readback = own(
      device.createBuffer({
        size,
        usage: window.GPUBufferUsage.COPY_DST | window.GPUBufferUsage.MAP_READ,
      }),
    )
    const params = own(
      device.createBuffer({
        size: 16,
        usage: window.GPUBufferUsage.UNIFORM | window.GPUBufferUsage.COPY_DST,
      }),
    )
    device.queue.writeBuffer(params, 0, new Uint32Array([48, count, 0, 0]))
    await scoped('grid-decode', async () => {
      const module = device.createShaderModule({
        label: 'Gummy index decoding probe',
        code: `
        @group(0) @binding(0) var<uniform> params: vec4u;
        @group(0) @binding(1) var<storage, read_write> result: array<vec4u>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3u) {
          let id = gid.x;
          if (id >= params.y) { return; }
          let n = params.x;
          result[id * 2u] = vec4u(id % n, (id / n) % n, id / (n * n), 1u);
          result[id * 2u + 1u] = vec4u(id % n, u32(f32(id) / f32(n)) % n, u32(f32(id) / f32(n * n)), 1u);
        }`,
      })
      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      })
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: result } },
        ],
      })
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(Math.ceil(count / 64))
      pass.end()
      encoder.copyBufferToBuffer(result, 0, readback, 0, size)
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(window.GPUMapMode.READ)
      checkActive()
    })
    const values = new Uint32Array(readback.getMappedRange())
    let integerMismatches = 0
    let floatMismatches = 0
    const examples = []
    for (let id = 0; id < count; id++) {
      const expected = [
        id % 48,
        Math.floor(id / 48) % 48,
        Math.floor(id / (48 * 48)),
        1,
      ]
      const integer = Array.from(values.subarray(id * 8, id * 8 + 4))
      const float = Array.from(values.subarray(id * 8 + 4, id * 8 + 8))
      const badInteger = integer.some(
        (value, index) => value !== expected[index],
      )
      const badFloat = float.some((value, index) => value !== expected[index])
      integerMismatches += badInteger
      floatMismatches += badFloat
      if ((badInteger || badFloat) && examples.length < 3)
        examples.push({ id, expected, integer, float })
    }
    readback.unmap()
    return { nodes: count, integerMismatches, floatMismatches, examples }
  } finally {
    for (const buffer of buffers) buffer.destroy()
  }
}

async function run() {
  runButton.disabled = true
  copyButton.disabled = true
  output.value = ''
  const started = window.performance.now()
  const report = {
    probe: 'gummy-mpm-v1',
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    tickCount,
    gpuErrors: [],
    cases: [],
  }
  let device, root, solver, timer
  let stopped = false
  const checkActive = () => {
    if (stopped) {
      device?.destroy()
      throw new Error('Probe stopped')
    }
  }
  const stage = (name) => {
    checkActive()
    report.stage = name
    status.textContent = name
  }
  const scoped = async (label, action) => {
    for (const filter of ['validation', 'internal', 'out-of-memory'])
      device.pushErrorScope(filter)
    let result, failure
    try {
      result = await action()
    } catch (error) {
      failure = error
    }
    const errors = []
    for (const filter of ['out-of-memory', 'internal', 'validation']) {
      const error = await device.popErrorScope()
      if (error)
        errors.push({ stage: label, type: filter, message: error.message })
    }
    report.gpuErrors.push(...errors)
    if (failure) throw new Error(message(failure))
    if (errors.length) throw new Error(`GPU error during ${label}`)
    return result
  }
  const work = async () => {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable on this page')
    stage('Requesting the GPU…')
    const adapter = await navigator.gpu.requestAdapter()
    checkActive()
    if (!adapter) throw new Error('No WebGPU adapter is available')
    report.adapter = {
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture,
      description: adapter.info?.description,
      fallback:
        adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
    }
    device = await adapter.requestDevice()
    checkActive()
    device.addEventListener('uncapturederror', (event) => {
      if (!stopped)
        report.gpuErrors.push({
          stage: report.stage,
          type: event.error.name,
          message: event.error.message,
        })
    })
    void device.lost.then((info) => {
      if (!stopped && info.reason !== 'destroyed')
        report.deviceLost = { reason: info.reason, message: info.message }
    })
    stage('Checking grid coordinates…')
    report.gridDecode = await checkGridDecode(device, scoped, checkActive)
    stage('Creating the particle solver…')
    root = tgpu.initFromDevice({ device })
    await scoped('solver-pipelines', () => {
      solver = createGummyParticleSolver(root, device, {
        spacing: 0.08,
        pinnedFeet: true,
      })
    })
    report.geometry = {
      particleCount: solver.particleCount,
      spacing: solver.spacing,
      substeps: solver.substeps,
      fixedDt: solver.fixedDt,
    }
    const grip = chooseGrip(solver.restPositions)
    report.grip = grip
    for (const material of ['warm', 'elastic']) {
      stage(`Testing ${material} jelly…`)
      const result = { material, ticksSubmitted: 0 }
      report.cases.push(result)
      await scoped(`${material}-grab`, async () => {
        solver.reset()
        const before = await solver.readPositions()
        checkActive()
        for (let tick = 0; tick < tickCount; tick++) {
          checkActive()
          result.ticksSubmitted += solver.step(1 / 120, {
            softness: 0.55,
            tearing: true,
            particleMaterial: material,
            gripSpace: 'current',
            grip,
          })
          await device.queue.onSubmittedWorkDone()
        }
        checkActive()
        const state = await solver.readState()
        checkActive()
        Object.assign(result, summarize(state, before, grip))
      })
    }
    checkActive()
    report.completed = true
  }
  try {
    const deadline = new Promise((_, reject) => {
      cancelActive = (reason = 'Probe stopped after 30 seconds') => {
        stopped = true
        device?.destroy()
        reject(new Error(reason))
      }
      timer = window.setTimeout(cancelActive, 30_000)
    })
    await Promise.race([work(), deadline])
    status.textContent = 'Check complete. Copy the result to share it.'
  } catch (error) {
    report.error = message(error)
    status.textContent = `Check stopped: ${message(error)}. You can copy the result.`
  } finally {
    stopped = true
    window.clearTimeout(timer)
    cancelActive = undefined
    for (const resource of [solver, root, device]) {
      try {
        resource?.destroy()
      } catch (error) {
        ;(report.cleanupErrors ??= []).push(message(error))
      }
    }
    report.elapsedMs = Math.round(window.performance.now() - started)
    output.value = JSON.stringify(
      report,
      (_, value) =>
        typeof value === 'number' && !Number.isFinite(value)
          ? String(value)
          : value,
      2,
    )
    copyButton.disabled = false
    runButton.disabled = false
  }
}

if (import.meta.env.DEV) {
  runButton.disabled = false
  runButton.addEventListener('click', () => {
    void run()
  })
} else {
  runButton.disabled = true
  status.textContent = 'This check is available on the development server.'
}
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value)
    status.textContent = 'Result copied.'
  } catch {
    output.focus()
    output.select()
    status.textContent = 'Select the result above and choose Copy.'
  }
})
window.addEventListener('pagehide', () =>
  cancelActive?.('Probe stopped when the page closed'),
)
