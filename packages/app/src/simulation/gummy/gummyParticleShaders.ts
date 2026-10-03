/** Three-dimensional MLS/APIC MPM with floating-point node-gather transfers and irreversible strain softening. */
import { d, std, tgpu } from 'typegpu'
import { GUMMY_PARTICLE_MAX_J, GUMMY_PARTICLE_MIN_J, gummyParticleDamage, gummyParticleDeterminant, gummyParticleGridSpeedLimit, gummyParticleIdentity, gummyParticleStress, gummyParticleStretch, gummyParticleVolumeState, gummyParticleWeights, } from './gummyParticleMath'

export const GummyParticleParameters = d.struct({
  geometry: d.vec4f,
  material: d.vec4f,
  origin: d.vec4f,
  counts: d.vec4u,
  gripCenter: d.vec4f,
  gripTarget: d.vec4f,
  press: d.vec4f,
  limits: d.vec4f,
})
export const GummyParticleState = d.struct({
  deformation: d.mat3x3f,
  affine: d.mat3x3f,
  /** Damage, historical peak isochoric stretch, speed caps, affine-gradient caps. */
  history: d.vec4f,
  /** Rejected deformation-gradient updates, domain contacts, zero-shear state reductions, reserved. */
  diagnostics: d.vec4f,
  /** Peak raw grid speed, transferred clipping impulse, direct particle caps, grid cap touches. */
  transfer: d.vec4f,
  /** Next particle in the support-base bucket; zero terminates an index-plus-one list. */
  links: d.vec4u,
})
export const GummyParticleGrid = d.struct({
  head: d.atomic(d.u32),
  occupied: d.atomic(d.u32),
})
export const gummyParticleLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParticleParameters },
  positions: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  velocities: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  states: { storage: d.arrayOf(GummyParticleState), access: 'mutable' },
  rest: { storage: d.arrayOf(d.vec4f) },
  grip: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  grid: { storage: d.arrayOf(GummyParticleGrid), access: 'mutable' },
  gridVelocities: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
})

const gridIndex = (p: d.v3i) => {
  'use gpu'
  const n = gummyParticleLayout.$.params.counts.y
  return d.u32(p.x) + n * (d.u32(p.y) + n * d.u32(p.z))
}

export const gummyParticleCaptureGrip = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyParticleLayout.$.params.counts.x) return
  const params = gummyParticleLayout.$.params
  const rest = gummyParticleLayout.$.rest[gid.x]!
  const distance = std.length(std.sub(rest.xyz, params.gripCenter.xyz))
  let weight = d.f32(0)
  if (rest.w > 0 && params.gripTarget.w > 0)
    weight =
      1 -
      std.smoothstep(params.gripCenter.w * 0.65, params.gripCenter.w, distance)
  gummyParticleLayout.$.grip[gid.x] = d.vec4f(
    std.sub(gummyParticleLayout.$.positions[gid.x]!.xyz, params.gripTarget.xyz),
    weight,
  )
})

// TypeGPU 0.12 omits std.atomicExchange; integer atomics only allocate linked-list entries.
const exchangeHead = tgpu
  .fn([
      d.u32,
      d.u32,
    ], d.u32)(`(bucket: u32, value: u32) -> u32 { return atomicExchange(&layout.$.grid[bucket].head, value); }`)
  .$uses({ layout: gummyParticleLayout })

/** Prepare stress/APIC momentum once, then bin by quadratic support base for exact 27-node gather. */
export const gummyParticleP2G = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyParticleLayout.$.params.counts.x) return
  const params = gummyParticleLayout.$.params
  const position = gummyParticleLayout.$.positions[gid.x]!.xyz
  let velocity = d.vec3f(gummyParticleLayout.$.velocities[gid.x]!.xyz)
  let peakSpeed = d.f32(gummyParticleLayout.$.velocities[gid.x]!.w)
  const state = gummyParticleLayout.$.states[gid.x]!
  const pinned = gummyParticleLayout.$.rest[gid.x]!.w <= 0
  const grip = gummyParticleLayout.$.grip[gid.x]!
  // External grip impulses pass through the grid so F sees the same motion as particles.
  if (params.gripTarget.w > 0 && grip.w > 0 && !pinned) {
    const goal = std.add(params.gripTarget.xyz, grip.xyz)
    const acceleration = std.sub(
      std.mul(std.sub(goal, position), 4000),
      std.mul(velocity, 80),
    )
    velocity = std.add(
      velocity,
      std.mul(acceleration, params.geometry.x * grip.w),
    )
    const speed = std.length(velocity)
    peakSpeed = std.max(peakSpeed, speed)
    if (speed > params.limits.x) {
      velocity = std.mul(velocity, params.limits.x / speed)
      state.history.z += 1
      state.transfer.z += 1
    }
  }
  const dx = params.geometry.y
  const xp = std.div(std.sub(position, params.origin.xyz), dx)
  const base = d.vec3i(std.floor(std.sub(xp, d.vec3f(0.5))))
  const stress = gummyParticleStress(
    state.deformation,
    params.material.x,
    params.material.y,
    state.history.x,
  )
  // Scratch until G2P reconstructs C. No other invocation reads this particle during preparation.
  state.affine = std.sub(
    std.mul(state.affine, params.geometry.z),
    std.mul(stress, (4 * params.geometry.x * params.geometry.z) / (dx * dx)),
  )
  gummyParticleLayout.$.velocities[gid.x] = d.vec4f(velocity, peakSpeed)
  state.links.x = exchangeHead(gridIndex(base), gid.x + 1)
  for (const z of std.range(3))
    for (const y of std.range(3))
      for (const x of std.range(3)) {
        const id = gridIndex(std.add(base, d.vec3i(x, y, z)))
        std.atomicStore(gummyParticleLayout.$.grid[id]!.occupied, 1)
      }
})

/** Gather each node's supported particles in f32; mass and momentum share identical weights. */
export const gummyParticleGridUpdate = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  if (gid.x >= params.counts.z) return
  const n = params.counts.y
  const index = d.vec3i(
    d.i32(gid.x % n),
    d.i32(d.u32(std.div(gid.x, n)) % n),
    d.i32(d.u32(std.div(gid.x, n * n))),
  )
  let mass = d.f32(0)
  let momentum = d.vec3f(0)
  let pinned = false
  if (std.atomicLoad(gummyParticleLayout.$.grid[gid.x]!.occupied) > 0) {
    for (const z of std.range(3))
      for (const y of std.range(3))
        for (const x of std.range(3)) {
          const offset = d.vec3i(x, y, z)
          const base = std.sub(index, offset)
          if (base.x < 0 || base.y < 0 || base.z < 0) continue
          let link = std.atomicLoad(
            gummyParticleLayout.$.grid[gridIndex(base)]!.head,
          )
          while (link > 0) {
            const id = link - 1
            const state = gummyParticleLayout.$.states[id]!
            const xp = std.div(
              std.sub(
                gummyParticleLayout.$.positions[id]!.xyz,
                params.origin.xyz,
              ),
              params.geometry.y,
            )
            const fraction = std.sub(xp, d.vec3f(base))
            const wx = gummyParticleWeights(fraction.x)
            const wy = gummyParticleWeights(fraction.y)
            const wz = gummyParticleWeights(fraction.z)
            const weight = wx[x]! * wy[y]! * wz[z]!
            const weightedMass = weight * params.geometry.z
            const distance = std.mul(
              std.sub(d.vec3f(offset), fraction),
              params.geometry.y,
            )
            mass += weightedMass
            momentum = std.add(
              momentum,
              std.mul(
                std.add(
                  std.mul(
                    gummyParticleLayout.$.velocities[id]!.xyz,
                    params.geometry.z,
                  ),
                  std.mul(state.affine, distance),
                ),
                weight,
              ),
            )
            if (weightedMass > 0 && gummyParticleLayout.$.rest[id]!.w <= 0)
              pinned = true
            link = state.links.x
          }
        }
  }
  let velocity = d.vec3f(0)
  let rawSpeed = d.f32(0)
  const nodalLimit = gummyParticleGridSpeedLimit(
    params.geometry.x,
    params.geometry.y,
  )
  if (mass > 0) {
    velocity = std.div(momentum, mass)
    velocity.y -= params.limits.w * params.geometry.x
    velocity = std.mul(
      velocity,
      std.exp(-params.material.z * params.geometry.x),
    )
    const point = std.add(
      params.origin.xyz,
      std.mul(d.vec3f(index), params.geometry.y),
    )
    if (point.y < params.geometry.w && velocity.y < 0) {
      velocity.y = 0
      velocity.x *= 0.8
      velocity.z *= 0.8
    }
    if (
      params.press.z > 0 &&
      std.abs(point.x) < params.press.y &&
      std.abs(point.z) < params.press.y &&
      point.y > params.press.x - params.geometry.w
    )
      velocity.y = std.min(velocity.y, params.press.w)
    // Apply Dirichlet data last, on the full finite support of actual fixed material.
    if (pinned) velocity = d.vec3f(0)
    rawSpeed = std.length(velocity)
    if (rawSpeed > nodalLimit)
      velocity = std.mul(velocity, nodalLimit / rawSpeed)
  }
  gummyParticleLayout.$.gridVelocities[gid.x] = d.vec4f(velocity, rawSpeed)
})

/** Grid velocities transport material; its deformation gradient and irreversible history follow it. */
export const gummyParticleG2P = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  if (gid.x >= params.counts.x) return
  const oldPosition = gummyParticleLayout.$.positions[gid.x]!.xyz
  const rest = gummyParticleLayout.$.rest[gid.x]!
  const previous = gummyParticleLayout.$.states[gid.x]!
  const history = d.vec4f(previous.history)
  const diagnostics = d.vec4f(previous.diagnostics)
  const transfer = d.vec4f(previous.transfer)
  let peakSpeed = d.f32(gummyParticleLayout.$.velocities[gid.x]!.w)
  const dx = params.geometry.y
  const xp = std.div(std.sub(oldPosition, params.origin.xyz), dx)
  const base = d.vec3i(std.floor(std.sub(xp, d.vec3f(0.5))))
  const fraction = std.sub(xp, d.vec3f(base))
  const wx = gummyParticleWeights(fraction.x)
  const wy = gummyParticleWeights(fraction.y)
  const wz = gummyParticleWeights(fraction.z)
  let velocity = d.vec3f(0)
  let affine = d.mat3x3f()
  let guarded = false
  const nodalLimit = gummyParticleGridSpeedLimit(params.geometry.x, dx)
  for (const z of std.range(3))
    for (const y of std.range(3))
      for (const x of std.range(3)) {
        const offset = d.vec3i(x, y, z)
        const id = gridIndex(std.add(base, offset))
        const weight = wx[x]! * wy[y]! * wz[z]!
        const grid = gummyParticleLayout.$.gridVelocities[id]!
        const weightedVelocity = std.mul(grid.xyz, weight)
        const distance = std.mul(std.sub(d.vec3f(offset), fraction), dx)
        velocity = std.add(velocity, weightedVelocity)
        affine = std.add(
          affine,
          d.mat3x3f(
            std.mul(weightedVelocity, distance.x),
            std.mul(weightedVelocity, distance.y),
            std.mul(weightedVelocity, distance.z),
          ),
        )
        if (weight > 0.001) transfer.x = std.max(transfer.x, grid.w)
        transfer.y +=
          params.geometry.z * weight * std.max(0, grid.w - nodalLimit)
        if (grid.w > nodalLimit && weight > 0.001) guarded = true
      }
  affine = std.mul(affine, 4 / (dx * dx))
  const affineNorm = std.sqrt(
    std.dot(affine.columns[0], affine.columns[0]) +
      std.dot(affine.columns[1], affine.columns[1]) +
      std.dot(affine.columns[2], affine.columns[2]),
  )
  if (affineNorm > params.limits.y) {
    affine = std.mul(affine, params.limits.y / affineNorm)
    history.w += 1
  }
  let deformation = std.mul(
    std.add(gummyParticleIdentity(), std.mul(affine, params.geometry.x)),
    previous.deformation,
  )
  const jacobian = gummyParticleDeterminant(deformation)
  if (previous.history.x >= 1 && jacobian > 0) {
    deformation = gummyParticleVolumeState(deformation)
    diagnostics.z += 1
  }
  const normSquared =
    std.dot(deformation.columns[0], deformation.columns[0]) +
    std.dot(deformation.columns[1], deformation.columns[1]) +
    std.dot(deformation.columns[2], deformation.columns[2])
  if (
    jacobian < GUMMY_PARTICLE_MIN_J ||
    jacobian > GUMMY_PARTICLE_MAX_J ||
    normSquared > params.limits.z * params.limits.z
  ) {
    deformation = d.mat3x3f(
      previous.deformation.columns[0],
      previous.deformation.columns[1],
      previous.deformation.columns[2],
    )
    diagnostics.x += 1
  }
  const stretch = gummyParticleStretch(deformation)
  history.y = std.max(history.y, stretch)
  if (params.material.w > 0)
    history.x = gummyParticleDamage(history.x, history.y)
  if (guarded) transfer.w += 1
  const speed = std.length(velocity)
  peakSpeed = std.max(peakSpeed, speed)
  if (speed > params.limits.x) {
    velocity = std.mul(velocity, params.limits.x / speed)
    guarded = true
    transfer.z += 1
  }
  let position = std.add(oldPosition, std.mul(velocity, params.geometry.x))
  if (position.y < params.geometry.w) {
    position.y = params.geometry.w
    velocity.y = std.max(0, velocity.y)
  }
  if (
    params.press.z > 0 &&
    std.abs(position.x) < params.press.y &&
    std.abs(position.z) < params.press.y &&
    position.y > params.press.x - params.geometry.w
  ) {
    position.y = params.press.x - params.geometry.w
    velocity.y = std.min(velocity.y, params.press.w)
  }
  const low = std.add(params.origin.xyz, d.vec3f(dx * 0.51))
  const high = std.add(
    params.origin.xyz,
    d.vec3f(dx * (d.f32(params.counts.y) - 1.51)),
  )
  if (
    position.x < low.x ||
    position.y < low.y ||
    position.z < low.z ||
    position.x > high.x ||
    position.y > high.y ||
    position.z > high.z
  ) {
    position = std.clamp(position, low, high)
    velocity = d.vec3f(0)
    diagnostics.y += 1
  }
  if (rest.w <= 0) {
    position = d.vec3f(rest.xyz)
    velocity = d.vec3f(0)
    affine = d.mat3x3f()
    deformation = gummyParticleIdentity()
  }
  if (guarded) history.z += 1
  gummyParticleLayout.$.positions[gid.x] = d.vec4f(position, rest.w)
  gummyParticleLayout.$.velocities[gid.x] = d.vec4f(velocity, peakSpeed)
  gummyParticleLayout.$.states[gid.x] = GummyParticleState({
    deformation,
    affine,
    history,
    diagnostics,
    transfer,
    links: d.vec4u(0),
  })
})
