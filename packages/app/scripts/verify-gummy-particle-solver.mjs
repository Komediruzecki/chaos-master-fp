/** Native, renderer-free particle-jelly checks through dynamic Vite imports on an isolated blank page. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sourceFiles = [
  'packages/app/src/simulation/gummy/gummyParticleSolver.ts',
  'packages/app/src/simulation/gummy/gummyParticleShaders.ts',
  'packages/app/src/simulation/gummy/gummyParticleMath.ts',
  'packages/app/src/simulation/gummy/gummyMesh.ts',
  'packages/app/src/components/GummyBear/particleStudyMath.ts',
]

/** Connectivity is geometric at 1.9 sample spacings, and is not a material fracture graph. */
export function analyzeParticleState(state, rest, spacing) {
  const p = state.positions
  assert.equal(
    p.length,
    rest.length,
    'Packed positions must retain every sample',
  )
  assert.equal(p.length % 4, 0)
  const count = p.length / 4
  if (typeof state.particleCount === 'number')
    assert.equal(state.particleCount, count)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let maxDisplacement = 0,
    pinMovement = 0,
    pinnedCount = 0,
    freeDisplacementSquared = 0
  for (let i = 0; i < p.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k])
      max[k] = Math.max(max[k], p[i + k])
    }
    const displacement = Math.hypot(
      p[i] - rest[i],
      p[i + 1] - rest[i + 1],
      p[i + 2] - rest[i + 2],
    )
    maxDisplacement = Math.max(maxDisplacement, displacement)
    if (rest[i + 3] === 0) {
      pinnedCount++
      pinMovement = Math.max(pinMovement, displacement)
    } else freeDisplacementSquared += displacement * displacement
  }
  const finite = Object.values(state).every((value) =>
    Array.isArray(value)
      ? value.every(Number.isFinite)
      : typeof value !== 'number' || Number.isFinite(value),
  )
  const reach = spacing * 1.9
  // Preserve the original non-finite snapshot without hashing invalid cells.
  const componentDetails = finite ? particleComponents(p, rest, reach) : []
  const J = state.J ?? state.jacobians ?? []
  const damage = state.damage ?? []
  const materialRegions = [
    { name: 'feet', minY: 0, maxY: 0.48 },
    { name: 'ankles', minY: 0.48, maxY: 0.9 },
    { name: 'body-arm', minY: 0.9, maxY: 1.7 },
    { name: 'head', minY: 1.7, maxY: 3 },
  ].map((region) => {
    const ids = Array.from({ length: count }, (_, id) => id).filter(
      (id) => rest[id * 4 + 1] >= region.minY && rest[id * 4 + 1] < region.maxY,
    )
    return {
      name: region.name,
      count: ids.length,
      damaged: ids.filter((id) => damage[id] > 0.5).length,
      peakStretch: Math.max(
        1,
        ...ids.map((id) => state.peakStretch?.[id] ?? 1),
      ),
    }
  })
  const diagnostics = Object.fromEntries(
    Object.entries(state).filter(
      ([_key, value]) => typeof value === 'number' || typeof value === 'string',
    ),
  )
  return {
    ...diagnostics,
    ...particleEnergy(state, count),
    finite,
    particleCount: count,
    pinnedCount,
    min,
    max,
    span: max.map((value, k) => value - min[k]),
    pinMovement,
    maxDisplacement,
    freeDisplacementRms: Math.sqrt(
      freeDisplacementSquared / Math.max(1, count - pinnedCount),
    ),
    connectivityRadius: reach,
    components: componentDetails.map((part) => part.count),
    componentDetails,
    damageMax: Math.max(0, ...damage),
    damaged: damage.filter((value) => value > 0.5).length,
    meanDamage: damage.length
      ? damage.reduce((sum, value) => sum + value, 0) / damage.length
      : 0,
    meanJ: J.length
      ? J.reduce((sum, value) => sum + value, 0) / J.length
      : null,
    minJ: J.length ? Math.min(...J) : null,
    maxJ: J.length ? Math.max(...J) : null,
    materialRegions,
  }
}

function particleEnergy(state, count) {
  if (
    ![state.totalMass, state.elasticEnergy, state.kineticEnergy].every(
      Number.isFinite,
    )
  )
    return { gravitationalEnergy: null, totalEnergy: null }
  let heightSum = 0
  for (let i = 1; i < state.positions.length; i += 4)
    heightSum += state.positions[i]
  const gravitationalEnergy = (state.totalMass / count) * 9.81 * heightSum
  return {
    gravitationalEnergy,
    totalEnergy:
      state.elasticEnergy + state.kineticEnergy + gravitationalEnergy,
  }
}

function particleComponents(p, rest, reach) {
  const count = p.length / 4
  const componentDetails = []
  {
    const cells = new Map()
    const key = (x, y, z) => `${x},${y},${z}`
    for (let id = 0; id < count; id++) {
      const cell = key(
        ...[0, 1, 2].map((k) => Math.floor(p[id * 4 + k] / reach)),
      )
      if (!cells.has(cell)) cells.set(cell, [])
      cells.get(cell).push(id)
    }
    const visited = new Uint8Array(count)
    for (let start = 0; start < count; start++) {
      if (visited[start]) continue
      visited[start] = 1
      const queue = [start]
      let fixed = 0
      for (let q = 0; q < queue.length; q++) {
        const id = queue[q]
        if (rest[id * 4 + 3] === 0) fixed++
        const cell = [0, 1, 2].map((k) => Math.floor(p[id * 4 + k] / reach))
        for (let x = -1; x <= 1; x++)
          for (let y = -1; y <= 1; y++)
            for (let z = -1; z <= 1; z++)
              for (const other of cells.get(
                key(cell[0] + x, cell[1] + y, cell[2] + z),
              ) ?? []) {
                if (visited[other]) continue
                if (
                  Math.hypot(
                    p[id * 4] - p[other * 4],
                    p[id * 4 + 1] - p[other * 4 + 1],
                    p[id * 4 + 2] - p[other * 4 + 2],
                  ) >= reach
                )
                  continue
                visited[other] = 1
                queue.push(other)
              }
      }
      componentDetails.push({
        count: queue.length,
        pinned: fixed,
        free: queue.length - fixed,
      })
    }
    componentDetails.sort((a, b) => b.count - a.count)
  }
  return componentDetails
}

function selfTest() {
  const rest = [0, 0.04, 0, 0, 0.08, 0.04, 0, 1, 1, 0.04, 0, 1]
  const state = {
    positions: rest,
    velocities: Array(12).fill(0),
    deformation: Array(36).fill(0),
    damage: [0, 0.75, 0],
    J: [1, 0.9, 1.1],
    peakStretch: [1, 2, 1],
    simulationTime: 0,
    totalMass: 3,
    elasticEnergy: 2,
    kineticEnergy: 1,
  }
  const sample = analyzeParticleState(state, rest, 0.08)
  assert.deepEqual(sample.componentDetails, [
    { count: 2, pinned: 1, free: 1 },
    { count: 1, pinned: 0, free: 1 },
  ])
  assert.equal(sample.damageMax, 0.75)
  assert.equal(sample.damaged, 1)
  assert.equal(sample.meanJ, 1)
  assert.equal(sample.pinMovement, 0)
  assert.equal(sample.finite, true)
  assert.ok(Math.abs(sample.gravitationalEnergy - 1.1772) < 1e-12)
  assert.ok(Math.abs(sample.totalEnergy - 4.1772) < 1e-12)
  const moved = [...rest]
  moved[4] += 0.16
  const displaced = analyzeParticleState(
    { ...state, positions: moved },
    rest,
    0.08,
  )
  assert.ok(
    Math.abs(displaced.freeDisplacementRms - 0.16 / Math.sqrt(2)) < 1e-12,
  )
  assert.ok(Math.abs(displaced.maxDisplacement - 0.16) < 1e-12)
  assert.equal(
    analyzeParticleState({ ...state, velocities: [NaN] }, rest, 0.08).finite,
    false,
  )
  assert.equal(
    analyzeParticleState({ ...state, kineticEnergy: Infinity }, rest, 0.08)
      .finite,
    false,
  )
  assert.throws(() =>
    analyzeParticleState({ ...state, positions: rest.slice(4) }, rest, 0.08),
  )
  console.info(
    'Solver harness metric checks passed: geometric components, pin identity, damage, Jacobian and complete-state finiteness.',
  )
}

function prepareRawDirectory(directory) {
  if (directory) mkdirSync(directory, { recursive: true })
}

async function collectFinalDiagnostics(page, report, fingerprints) {
  report.guardFree =
    report.samples.length > 0 &&
    report.samples.every(
      (sample) => sample.guardActivations === 0 && sample.domainContacts === 0,
    )
  report.finalSourceHashes = fingerprints()
  report.sourceStable =
    JSON.stringify(report.finalSourceHashes) ===
    JSON.stringify(report.sourceHashes)
  if (page && !page.isClosed()) {
    report.gpu = await page
      .evaluate(() => ({
        errors: window.__gummySolverVerify?.gpuErrors ?? [],
        losses: window.__gummySolverVerify?.lost ?? [],
        canvasCount: document.querySelectorAll('canvas').length,
      }))
      .catch((error) => ({ diagnosticError: String(error) }))
  }
}

async function verify() {
  const { chromium } = createRequire(import.meta.url)('playwright')
  const base = process.env.GUMMY_BASE ?? 'https://localhost:5199'
  const output = resolve(
    process.env.GUMMY_SOLVER_REPORT ??
      resolve(repo, 'assets/gummy-particle-solver-verification.json'),
  )
  const rawDirectory = process.env.GUMMY_SOLVER_RAW_DIR
    ? resolve(process.env.GUMMY_SOLVER_RAW_DIR)
    : undefined
  const requireZeroGuards = process.env.GUMMY_REQUIRE_ZERO_GUARDS === '1'
  const softness = Number(process.env.GUMMY_SOFTNESS ?? 0.55)
  const timeoutSeconds = Number(process.env.GUMMY_SOLVER_TIMEOUT ?? 600)
  assert.ok(Number.isFinite(softness) && softness >= 0 && softness <= 1)
  assert.ok(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)
  const fingerprints = () =>
    Object.fromEntries(
      sourceFiles.map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(resolve(repo, file)))
          .digest('hex'),
      ]),
    )
  const report = {
    base,
    solverOnly: true,
    policy: { requireZeroGuards },
    settings: { softness, dt: 1 / 120, idleTicks: 1200, protocolTicks: 1440 },
    sourceHashes: fingerprints(),
    samples: [],
    timings: [],
    errors: [],
    warnings: [],
    failures: [],
  }
  mkdirSync(dirname(output), { recursive: true })
  prepareRawDirectory(rawDirectory)
  const hypr = (command) =>
    JSON.parse(execFileSync('hyprctl', ['-j', command], { encoding: 'utf8' }))
  const desktop = () => ({
    window: hypr('activewindow').address,
    workspace: hypr('activeworkspace').id,
    monitors: hypr('monitors').map((monitor) => ({
      id: monitor.id,
      special: monitor.specialWorkspace.name,
    })),
  })
  const before = desktop()
  const existing = new Set(hypr('clients').map((client) => client.address))
  let browser, page, timer
  try {
    browser = await chromium.launch({
      headless: false,
      env: { ...process.env, CHROME_DESKTOP: 'agent-browser.desktop' },
      args: [
        '--class=agent-browser',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--ignore-gpu-blocklist',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    })
    timer = setTimeout(() => {
      report.failures.push(`Solver verification exceeded ${timeoutSeconds}s`)
      void browser.close()
    }, timeoutSeconds * 1000)
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 640, height: 480 },
    })
    page = await context.newPage()
    page.on('pageerror', (error) => report.errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text())
      if (message.type() === 'warning') report.warnings.push(message.text())
    })
    const requests = []
    page.on('request', (request) =>
      requests.push(new URL(request.url()).pathname),
    )
    const route = new URL('/__gummy_solver_verify__', base).href
    await page.route(route, (request) =>
      request.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Particle solver verification</title><body>Renderer-free GPU solver verification</body>',
      }),
    )
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    report.placement = {
      before,
      after: desktop(),
      clients: hypr('clients')
        .filter((client) => !existing.has(client.address))
        .map((client) => ({
          class: client.class,
          workspace: client.workspace.name,
        })),
    }
    assert.deepEqual(
      report.placement.after,
      before,
      'Owned browser must leave the foreground desktop untouched',
    )
    assert.ok(
      report.placement.clients.length > 0 &&
        report.placement.clients.every(
          (client) =>
            client.class === 'agent-browser' &&
            client.workspace === 'special:agents',
        ),
    )
    const initialized = await page.evaluate(async () => {
      const solverURL = '/src/simulation/gummy/gummyParticleSolver.ts'
      const transformed = await (await window.fetch(solverURL)).text()
      const typegpuPath = transformed.match(
        /from\s*['"]([^'"]*typegpu[^'"]*)['"]/,
      )?.[1]
      if (!typegpuPath)
        throw new Error('Cannot locate the Vite-resolved TypeGPU dependency')
      const [
        { tgpu, d },
        { createGummyParticleSolver },
        { particleStudyCommand },
        shaders,
      ] = await Promise.all([
        import(typegpuPath),
        import(solverURL),
        import('/src/components/GummyBear/particleStudyMath.ts'),
        import('/src/simulation/gummy/gummyParticleShaders.ts'),
      ])
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) throw new Error('No native WebGPU adapter')
      const adapterInfo = {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        description: adapter.info.description,
        fallback:
          adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
      }
      if (adapterInfo.fallback || adapterInfo.fallback === null)
        throw new Error('Solver evidence requires a verified native adapter')
      const device = await adapter.requestDevice({
        requiredLimits: {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize:
            adapter.limits.maxStorageBufferBindingSize,
          maxComputeWorkgroupStorageSize:
            adapter.limits.maxComputeWorkgroupStorageSize,
        },
      })
      const gpuErrors = []
      const lost = []
      device.addEventListener('uncapturederror', (event) =>
        gpuErrors.push(event.error.message),
      )
      void device.lost.then((info) => {
        if (info.reason !== 'destroyed')
          lost.push({ reason: info.reason, message: info.message })
      })
      const root = tgpu.initFromDevice({ device })
      const solver = createGummyParticleSolver(root, device, {})
      window.__gummySolverVerify = {
        root,
        device,
        solver,
        d,
        shaders,
        command: particleStudyCommand,
        tick: 0,
        gpuErrors,
        lost,
      }
      return {
        adapter: adapterInfo,
        geometry: {
          particleCount: solver.particleCount,
          spacing: solver.spacing,
          gridSpacing: solver.gridSpacing,
          substeps: solver.substeps,
          fixedDt: solver.fixedDt,
          nodalSpeedBound: solver.nodalSpeedBound ?? null,
          restVolume: solver.restVolume,
          bounds: solver.bounds,
          gridBounds: solver.gridBounds,
          transfer: solver.transfer ?? 'integer-p2g',
          integerBounds: solver.integerBounds ?? null,
        },
        rest: [...solver.restPositions],
      }
    })
    report.adapter = initialized.adapter
    report.geometry = initialized.geometry
    report.transferProbes = await page.evaluate(async () => {
      const { root, device, d, shaders } = window.__gummySolverVerify
      const {
        GummyParticleState,
        GummyParticleGrid,
        GummyParticleParameters,
        gummyParticleLayout,
        gummyParticleP2G,
        gummyParticleGridUpdate,
        gummyParticleG2P,
      } = shaders
      const cases = [
        {
          name: 'sparse-uniform-translation',
          columns: [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        },
        {
          name: 'sparse-affine-velocity',
          columns: [
            [0.1, -0.2, 0.05],
            [0.03, 0.07, -0.06],
            [-0.04, 0.02, -0.08],
          ],
        },
      ]
      const results = []
      for (const input of cases) {
        const owned = []
        const own = (buffer) => {
          owned.push(buffer)
          return buffer
        }
        try {
          const n = 48,
            dx = 0.16,
            mass = 0.08 ** 3
          const origin = d.vec3f(-24 * dx, -2 * dx, -24 * dx)
          // Exactly the fractional support used by the integer-transfer counterexample; away from contacts.
          const point = d.vec4f(
            origin.x + dx * 24.75,
            origin.y + dx * 8.75,
            origin.z + dx * 24.75,
            1,
          )
          const velocity = d.vec4f(0.01, 0.02, -0.01, 0)
          const identity = () =>
            d.mat3x3f(d.vec3f(1, 0, 0), d.vec3f(0, 1, 0), d.vec3f(0, 0, 1))
          const positions = own(
            root.createBuffer(d.arrayOf(d.vec4f, 1), [point]).$usage('storage'),
          )
          const rest = own(
            root.createBuffer(d.arrayOf(d.vec4f, 1), [point]).$usage('storage'),
          )
          const velocities = own(
            root
              .createBuffer(d.arrayOf(d.vec4f, 1), [velocity])
              .$usage('storage'),
          )
          const states = own(
            root
              .createBuffer(d.arrayOf(GummyParticleState, 1), [
                {
                  deformation: identity(),
                  affine: d.mat3x3f(
                    ...input.columns.map((column) => d.vec3f(...column)),
                  ),
                  history: d.vec4f(0, 1, 0, 0),
                  diagnostics: d.vec4f(),
                  transfer: d.vec4f(),
                  links: d.vec4u(),
                },
              ])
              .$usage('storage'),
          )
          const grip = own(
            root.createBuffer(d.arrayOf(d.vec4f, 1)).$usage('storage'),
          )
          const grid = own(
            root
              .createBuffer(d.arrayOf(GummyParticleGrid, n ** 3))
              .$usage('storage'),
          )
          const gridVelocities = own(
            root.createBuffer(d.arrayOf(d.vec4f, n ** 3)).$usage('storage'),
          )
          const params = own(
            root
              .createBuffer(GummyParticleParameters, {
                geometry: d.vec4f(0, dx, mass, 0.04),
                material: d.vec4f(140, 800, 0, 0),
                origin: d.vec4f(origin, 0),
                counts: d.vec4u(1, n, n ** 3, 0),
                gripCenter: d.vec4f(),
                gripTarget: d.vec4f(),
                press: d.vec4f(),
                limits: d.vec4f(6, 60, 6, 0),
              })
              .$usage('uniform'),
          )
          const group = root.createBindGroup(gummyParticleLayout, {
            params,
            positions,
            velocities,
            states,
            rest,
            grip,
            grid,
            gridVelocities,
          })
          const pipelines = [
            gummyParticleP2G,
            gummyParticleGridUpdate,
            gummyParticleG2P,
          ].map((compute) =>
            root.createComputePipeline({ compute }).with(group),
          )
          const encoder = device.createCommandEncoder()
          encoder.clearBuffer(root.unwrap(grid))
          const pass = encoder.beginComputePass()
          for (let index = 0; index < pipelines.length; index++)
            pipelines[index]
              .with(pass)
              .dispatchWorkgroups(index === 1 ? Math.ceil(n ** 3 / 64) : 1)
          pass.end()
          device.queue.submit([encoder.finish()])
          const [p, v, state] = await Promise.all([
            positions.read(),
            velocities.read(),
            states.read(),
          ])
          const actualV = [v[0].x, v[0].y, v[0].z]
          const actualC = state[0].affine.columns.map((column) => [
            column.x,
            column.y,
            column.z,
          ])
          const actualF = state[0].deformation.columns.map((column) => [
            column.x,
            column.y,
            column.z,
          ])
          const maxError = (a, b) =>
            Math.max(
              ...a
                .flat()
                .map((value, index) => Math.abs(value - b.flat()[index])),
            )
          results.push({
            name: input.name,
            expectedVelocity: [0.01, 0.02, -0.01],
            velocity: actualV,
            expectedAffine: input.columns,
            affine: actualC,
            velocityError: maxError(actualV, [0.01, 0.02, -0.01]),
            affineError: maxError(actualC, input.columns),
            deformationError: maxError(actualF, [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ]),
            positionError: maxError(
              [[p[0].x, p[0].y, p[0].z]],
              [[point.x, point.y, point.z]],
            ),
            finite: [...actualV, ...actualC.flat(), ...actualF.flat()].every(
              Number.isFinite,
            ),
          })
        } finally {
          for (const buffer of owned.reverse()) buffer.destroy()
        }
      }
      return results
    })
    for (const probe of report.transferProbes) {
      console.info(JSON.stringify(probe))
      assert.ok(probe.finite)
      assert.ok(
        probe.velocityError < 1e-5,
        `${probe.name}: translation must survive an actual transfer`,
      )
      assert.ok(
        probe.affineError < 0.001,
        `${probe.name}: APIC must reproduce the affine velocity gradient`,
      )
      assert.ok(
        probe.deformationError < 1e-6,
        `${probe.name}: zero dt must preserve F`,
      )
      assert.ok(
        probe.positionError < 1e-6,
        `${probe.name}: zero dt must preserve position`,
      )
    }
    const advance = async (count, demo, tearing) => {
      const started = performance.now()
      for (let completed = 0; completed < count; completed += 20)
        await page.evaluate(
          async ({ count, demo, tearing, softness }) => {
            const sim = window.__gummySolverVerify
            for (let i = 0; i < count; i++) {
              const tick = ++sim.tick
              sim.solver.step(1 / 120, {
                softness,
                tearing,
                grip: demo ? sim.command(tick).grip : undefined,
              })
            }
            await sim.device.queue.onSubmittedWorkDone()
          },
          { count: Math.min(20, count - completed), demo, tearing, softness },
        )
      report.timings.push({
        ticks: count,
        simulationSeconds: count / 120,
        wallSeconds: (performance.now() - started) / 1000,
        includesRendering: false,
      })
    }
    const sample = async (name) => {
      const snapshot = await page.evaluate(async () => {
        const sim = window.__gummySolverVerify
        const state = await sim.solver.readState()
        return {
          tick: sim.tick,
          state: Object.fromEntries(
            Object.entries(state).map(([key, value]) => [
              key,
              ArrayBuffer.isView(value) ? Array.from(value) : value,
            ]),
          ),
        }
      })
      if (rawDirectory)
        writeFileSync(
          resolve(rawDirectory, `${name}.json`),
          `${JSON.stringify({ ...snapshot, restPositions: initialized.rest })}\n`,
        )
      const metrics = {
        name,
        tick: snapshot.tick,
        ...analyzeParticleState(
          snapshot.state,
          initialized.rest,
          initialized.geometry.spacing,
        ),
      }
      report.samples.push(metrics)
      console.info(JSON.stringify(metrics))
      assert.ok(
        metrics.finite,
        `${name}: all solver arrays and scalar diagnostics must remain finite`,
      )
      assert.equal(metrics.particleCount, initialized.geometry.particleCount)
      assert.ok(metrics.pinMovement < 1e-5, `${name}: fixed feet must not move`)
      assert.ok(metrics.min[1] >= -1e-5, `${name}: no floor penetration`)
      assert.equal(metrics.totalMass, initialized.geometry.restVolume)
      if (requireZeroGuards) {
        assert.equal(
          metrics.guardActivations,
          0,
          `${name}: no numerical safeguards may activate in strict mode`,
        )
        assert.equal(
          metrics.domainContacts,
          0,
          `${name}: no domain clamps may activate in strict mode`,
        )
      }
      return metrics
    }
    await sample('rest')
    await advance(1200, false, true)
    const idle = await sample('idle')
    assert.equal(
      idle.damageMax,
      0,
      'Gravity alone must not damage the upright bear',
    )
    assert.equal(
      idle.components.length,
      1,
      'The idle bear must remain geometrically connected',
    )
    assert.ok(
      idle.span[1] >
        0.9 *
          (initialized.geometry.bounds.max[1] -
            initialized.geometry.bounds.min[1]),
      'The idle bear must hold its height under gravity',
    )
    let enabledDamageMax = 0
    for (const tearing of [true, false]) {
      await page.evaluate(() => {
        window.__gummySolverVerify.solver.reset()
        window.__gummySolverVerify.tick = 0
      })
      let previous = 0
      for (const [tick, phase] of [
        [0, 'rest'],
        [120, 'settled'],
        [360, 'loading'],
        [600, 'neck'],
        [839, 'pre-release'],
        [840, 'released'],
        [842, 'recoil-2'],
        [846, 'recoil-6'],
        [852, 'recoil-12'],
        [864, 'recoil-24'],
        [1020, 'recovering'],
        [1440, 'final'],
      ]) {
        await advance(tick - previous, true, tearing)
        previous = tick
        const data = await sample(
          `${tearing ? 'enabled' : 'disabled'}-${phase}`,
        )
        if (tearing)
          enabledDamageMax = Math.max(enabledDamageMax, data.damageMax)
        if (!tearing) {
          assert.equal(
            data.damageMax,
            0,
            'Disabled softening must preserve every undamaged particle',
          )
          assert.equal(
            data.components.length,
            1,
            `Disabled ${phase}: the unbroken material must remain connected`,
          )
        }
      }
    }
    assert.ok(
      enabledDamageMax > 0,
      'The enabled pull must exercise the material softening law',
    )
    report.gpu = await page.evaluate(() => ({
      errors: window.__gummySolverVerify.gpuErrors,
      losses: window.__gummySolverVerify.lost,
      canvasCount: document.querySelectorAll('canvas').length,
    }))
    report.rendererOrHmrRequests = requests.filter(
      (path) =>
        path === '/@vite/client' || /[Rr]enderer|\/src\/index\.tsx/.test(path),
    )
    assert.equal(report.gpu.canvasCount, 0)
    assert.deepEqual(
      report.rendererOrHmrRequests,
      [],
      'Math-only verification must not load the renderer or HMR client',
    )
    assert.deepEqual(report.gpu.errors, [])
    assert.deepEqual(report.gpu.losses, [])
    assert.deepEqual(report.errors, [])
    assert.deepEqual(report.warnings, [])
    assert.deepEqual(
      fingerprints(),
      report.sourceHashes,
      'Source changed during verification; repeat against a frozen solver',
    )
    report.passed = true
  } catch (error) {
    report.failures.push(String(error))
    throw error
  } finally {
    clearTimeout(timer)
    await collectFinalDiagnostics(page, report, fingerprints)
    if (page && !page.isClosed())
      await page
        .evaluate(() => {
          const sim = window.__gummySolverVerify
          sim?.solver.destroy()
          sim?.root.destroy()
        })
        .catch(() => {})
    await browser?.close()
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
    console.info(`Solver report: ${output}`)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes('--self-test')) selfTest()
  else await verify()
}
