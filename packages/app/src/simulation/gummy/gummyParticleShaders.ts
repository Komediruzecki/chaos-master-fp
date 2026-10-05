/** Three-dimensional MLS/APIC MPM with floating-point node-gather transfers and irreversible strain softening. */
import { d, std, tgpu } from 'typegpu'
import { GUMMY_PARTICLE_MAX_J, GUMMY_PARTICLE_MIN_J, gummyParticleCavitatedVolumeState, gummyParticleCavitationReturn, gummyParticleDamage, gummyParticleDamageStretch, gummyParticleDeterminant, gummyParticleFlowStep, gummyParticleGripOffset, gummyParticleIdentity, gummyParticleStress, gummyParticleStretch, gummyParticleViscousSpeedLimit, gummyParticleViscousStress, gummyParticleVolumeState, gummyParticleWarmDamage, gummyParticleWarmStress, gummyParticleWeights, } from './gummyParticleMath'
import { gummyRookContact, gummyRookContactCorrection, gummyRookContactVelocity, gummyRookMayContact, } from './gummyRookCollider'

export const GummyParticleParameters = d.struct({
  geometry: d.vec4f,
  material: d.vec4f,
  origin: d.vec4f,
  counts: d.vec4u,
  gripCenter: d.vec4f,
  gripTarget: d.vec4f,
  press: d.vec4f,
  limits: d.vec4f,
  /** Warm mode, shape relaxation rate, damage rate, maximum viscosity. */
  rheology: d.vec4f,
  /** Current-space selection, grip spring, grip damping, floor drag per second. */
  interaction: d.vec4f,
  /** Yield stretch, damage onset, full-softening stretch, reserved. */
  fracture: d.vec4f,
  /** Prescribed rook translation and enabled flag. */
  colliderPosition: d.vec4f,
  /** Linear velocity and Coulomb friction coefficient. */
  colliderVelocity: d.vec4f,
  /** Moving grip target velocity and optional base-only capture height. */
  gripMotion: d.vec4f,
})
export const GummyParticleState = d.struct({
  deformation: d.mat3x3f,
  affine: d.mat3x3f,
  /** Damage, historical peak isochoric stretch, speed caps, affine-gradient caps. */
  history: d.vec4f,
  /** Rejected deformation-gradient updates, domain contacts, zero-shear state reductions, creep updates. */
  diagnostics: d.vec4f,
  /** Peak raw grid speed, transferred clipping impulse, direct particle caps, grid cap touches. */
  transfer: d.vec4f,
  /** Next particle in the support-base bucket; zero terminates an index-plus-one list. */
  links: d.vec4u,
  /** Equivalent plastic strain, volumetric void opening, cavitation returns, reserved. */
  flow: d.vec4f,
  /** Current rook surface normal and signed particle gap, cached once per microstep. */
  contact: d.vec4f,
})
export const GummyParticleGrid = d.struct({
  head: d.atomic(d.u32),
  occupied: d.atomic(d.u32),
  mass: d.f32,
  pinned: d.u32,
  /** Weighted geometric contact normal and contact mass; used by separate-body coupling. */
  contact: d.vec4f,
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
  clock: { storage: d.arrayOf(d.f32), access: 'mutable' },
})

/** Separate dispatch keeps collider motion ordered without races inside particle workgroups. */
export const gummyParticleAdvanceTime = tgpu.computeFn({ workgroupSize: [1] })(
  () => {
    'use gpu'
    gummyParticleLayout.$.clock[0] =
      gummyParticleLayout.$.clock[0]! + gummyParticleLayout.$.params.geometry.x
  },
)

const currentColliderPosition = (elapsed: number) => {
  'use gpu'
  const params = gummyParticleLayout.$.params
  return std.add(
    params.colliderPosition.xyz,
    std.mul(params.colliderVelocity.xyz, elapsed),
  )
}

const gridIndex = (p: d.v3i) => {
  'use gpu'
  const n = gummyParticleLayout.$.params.counts.y
  return d.u32(p.x) + n * (d.u32(p.y) + n * d.u32(p.z))
}

// TypeGPU division promotes to f32; truncating a rounded quotient can select the preceding row.
export const gummyParticleGridCoordinates = tgpu.fn(
  [d.u32, d.u32],
  d.vec3i,
)(`
  (id: u32, n: u32) -> vec3i {
    return vec3i(i32(id % n), i32((id / n) % n), i32(id / (n * n)));
  }
`)

export const gummyParticleCaptureGrip = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyParticleLayout.$.params.counts.x) return
  const params = gummyParticleLayout.$.params
  const rest = gummyParticleLayout.$.rest[gid.x]!
  const selectedPosition = std.select(
    rest.xyz,
    gummyParticleLayout.$.positions[gid.x]!.xyz,
    params.interaction.x > 0,
  )
  const distance = std.length(std.sub(selectedPosition, params.gripCenter.xyz))
  let weight = d.f32(0)
  if (rest.w > 0 && params.gripTarget.w > 0)
    weight =
      1 -
      std.smoothstep(params.gripCenter.w * 0.65, params.gripCenter.w, distance)
  if (params.gripMotion.w > 0) {
    weight = 0
    if (rest.w > 0 && rest.y <= params.gripCenter.y + params.gripMotion.w)
      weight =
        1 -
        std.smoothstep(
          params.gripCenter.w * 0.75,
          params.gripCenter.w,
          std.length(std.sub(rest.xz, params.gripCenter.xz)),
        )
  }
  gummyParticleLayout.$.grip[gid.x] = d.vec4f(
    gummyParticleGripOffset(
      gummyParticleLayout.$.positions[gid.x]!.xyz,
      params.gripCenter.xyz,
      params.gripTarget.xyz,
      params.interaction.x,
    ),
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
  state.contact = d.vec4f(0, 0, 0, 1000000)
  if (params.colliderPosition.w > 0) {
    const local = std.sub(
      position,
      currentColliderPosition(gummyParticleLayout.$.clock[0]!),
    )
    if (gummyRookMayContact(local, params.geometry.w)) {
      const contact = gummyRookContact(local)
      state.contact = d.vec4f(contact.xyz, contact.w - params.geometry.w)
    }
  }
  // External grip impulses pass through the grid so F sees the same motion as particles.
  if (params.gripTarget.w > 0 && grip.w > 0 && !pinned) {
    const goal = std.add(params.gripTarget.xyz, grip.xyz)
    const acceleration = std.sub(
      std.mul(std.sub(goal, position), params.interaction.y),
      std.mul(std.sub(velocity, params.gripMotion.xyz), params.interaction.z),
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
  let stress = d.mat3x3f()
  if (params.rheology.x > 0) {
    stress = gummyParticleWarmStress(
      state.deformation,
      params.material.x,
      params.material.y,
      state.history.x,
    )
    const viscosity = params.rheology.w * (0.35 + 0.65 * state.history.x)
    stress = std.add(
      stress,
      gummyParticleViscousStress(
        state.affine,
        gummyParticleDeterminant(state.deformation),
        viscosity,
      ),
    )
  } else {
    stress = gummyParticleStress(
      state.deformation,
      params.material.x,
      params.material.y,
      state.history.x,
    )
  }
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
  const index = gummyParticleGridCoordinates(gid.x, n)
  let mass = d.f32(0)
  let momentum = d.vec3f(0)
  let pinned = false
  let contactNormal = d.vec3f(0)
  let contactMass = d.f32(0)
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
            if (
              (params.colliderPosition.w > 0 || params.counts.w > 0) &&
              state.contact.w <= 0
            ) {
              contactNormal = std.add(
                contactNormal,
                std.mul(state.contact.xyz, weightedMass),
              )
              contactMass += weightedMass
            }
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
  const nodalLimit = gummyParticleViscousSpeedLimit(
    params.geometry.x,
    params.geometry.y,
    params.rheology.w,
    params.limits.w,
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
      let friction = d.f32(0.8)
      if (params.rheology.x > 0)
        friction = std.exp(-params.interaction.w * params.geometry.x)
      velocity.x *= friction
      velocity.z *= friction
    }
    if (
      params.press.z > 0 &&
      std.abs(point.x) < params.press.y &&
      std.abs(point.z) < params.press.y &&
      point.y > params.press.x - params.geometry.w
    )
      velocity.y = std.min(velocity.y, params.press.w)
    // Material proximity gates contact, so overlapping grid supports alone cannot push the victim.
    if (
      params.colliderPosition.w > 0 &&
      contactMass > 0 &&
      std.length(contactNormal) > 0.000001
    )
      velocity = gummyRookContactVelocity(
        velocity,
        params.colliderVelocity.xyz,
        std.normalize(contactNormal),
        0,
        params.colliderVelocity.w,
      )
    // Apply Dirichlet data last, on the full finite support of actual fixed material.
    if (pinned) velocity = d.vec3f(0)
    rawSpeed = std.length(velocity)
    if (rawSpeed > nodalLimit)
      velocity = std.mul(velocity, nodalLimit / rawSpeed)
  }
  gummyParticleLayout.$.grid[gid.x]!.mass = mass
  gummyParticleLayout.$.grid[gid.x]!.pinned = std.select(
    d.u32(0),
    d.u32(1),
    pinned,
  )
  gummyParticleLayout.$.grid[gid.x]!.contact = d.vec4f(
    contactNormal,
    contactMass,
  )
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
  const flow = d.vec4f(previous.flow)
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
  const nodalLimit = gummyParticleViscousSpeedLimit(
    params.geometry.x,
    dx,
    params.rheology.w,
    params.limits.w,
  )
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
  let jacobian = gummyParticleDeterminant(deformation)
  if (params.rheology.x > 0 && jacobian > 0) {
    const returned = gummyParticleCavitationReturn(
      deformation,
      previous.history.x,
    )
    deformation = d.mat3x3f(
      returned.column0,
      returned.column1,
      returned.column2,
    )
    flow.y += returned.opening
    if (returned.opening > 0) flow.z += 1
    jacobian = gummyParticleDeterminant(deformation)
  }
  if (previous.history.x >= 1 && jacobian > 0) {
    if (params.rheology.x > 0) {
      deformation = gummyParticleCavitatedVolumeState(deformation)
      // Test the returned elastic state. Large void dilation is no longer a
      // positive-pressure state or an elastic-gradient rejection in this phase.
      jacobian = gummyParticleDeterminant(deformation)
    } else {
      deformation = gummyParticleVolumeState(deformation)
    }
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
    // iOS WebKit can leave storage matrix columns packed. Scalar loads avoid
    // passing PackedVec3 values to Metal's matrix constructor (WebKit bug 320443).
    deformation = d.mat3x3f(
      previous.deformation.columns[0].x,
      previous.deformation.columns[0].y,
      previous.deformation.columns[0].z,
      previous.deformation.columns[1].x,
      previous.deformation.columns[1].y,
      previous.deformation.columns[1].z,
      previous.deformation.columns[2].x,
      previous.deformation.columns[2].y,
      previous.deformation.columns[2].z,
    )
    flow.y = previous.flow.y
    flow.z = previous.flow.z
    diagnostics.x += 1
  }
  const stretch = gummyParticleStretch(deformation)
  history.y = std.max(history.y, stretch)
  if (params.rheology.x > 0) {
    if (stretch > params.fracture.x && rest.w > 0) {
      // Yield gradually, retaining bulk pressure and objectivity throughout a thinning neck.
      const activation =
        (stretch - params.fracture.x) / std.max(0.001, stretch - 1)
      const yielded = gummyParticleFlowStep(
        deformation,
        params.geometry.x,
        params.rheology.y,
        activation,
      )
      deformation = d.mat3x3f(yielded.column0, yielded.column1, yielded.column2)
      flow.x += yielded.plasticStrain
      diagnostics.w += 1
    }
    if (params.material.w > 0) {
      // Yield must not erase the history that drives rupture. Equivalent plastic
      // strain equals true axial strain for isochoric uniaxial necking.
      const damageStretch = gummyParticleDamageStretch(
        history.y,
        stretch,
        flow.x + flow.y / 3,
      )
      history.x = gummyParticleWarmDamage(
        history.x,
        damageStretch,
        params.geometry.x,
        params.rheology.z,
        params.fracture.y,
        params.fracture.z,
      )
    }
  } else if (params.material.w > 0) {
    history.x = gummyParticleDamage(history.x, history.y)
  }
  if (guarded) transfer.w += 1
  const speed = std.length(velocity)
  peakSpeed = std.max(peakSpeed, speed)
  if (speed > params.limits.x) {
    velocity = std.mul(velocity, params.limits.x / speed)
    guarded = true
    transfer.z += 1
  }
  let position = std.add(oldPosition, std.mul(velocity, params.geometry.x))
  if (params.colliderPosition.w > 0 && rest.w > 0) {
    const local = std.sub(
      position,
      currentColliderPosition(
        gummyParticleLayout.$.clock[0]! + params.geometry.x,
      ),
    )
    if (gummyRookMayContact(local, params.geometry.w)) {
      const contact = gummyRookContact(local)
      position = std.add(
        position,
        gummyRookContactCorrection(
          contact,
          params.geometry.w,
          params.geometry.w * 0.5,
        ),
      )
      velocity = gummyRookContactVelocity(
        velocity,
        params.colliderVelocity.xyz,
        contact.xyz,
        contact.w - params.geometry.w,
        params.colliderVelocity.w,
      )
    }
  }
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
    flow,
    contact: d.vec4f(0),
  })
})
