/** GPU XPBD strain, signed-volume and cohesive-interface kernels for the gummy study. */
import { d, std, tgpu } from 'typegpu'

export const GummyPositions = d.arrayOf(d.vec4f)
export const GummyDamage = d.arrayOf(d.f32)
export const GummyTet = d.struct({
  ids: d.vec4u,
  lengthsA: d.vec4f,
  lengthsB: d.vec4f,
})
export const GummyTetLambda = d.struct({ a: d.vec4f, b: d.vec4f })
export const GummyInterface = d.struct({ a: d.vec4u, b: d.vec4u })
export const GummyParameters = d.struct({
  material: d.vec4f,
  gripCenter: d.vec4f,
  gripTarget: d.vec4f,
  counts: d.vec4u,
  fracture: d.vec4f,
  press: d.vec4f,
  controls: d.vec4f,
})
export const gummyNodeLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParameters },
  positions: { storage: GummyPositions, access: 'mutable' },
  previous: { storage: GummyPositions, access: 'mutable' },
  velocities: { storage: GummyPositions, access: 'mutable' },
  grip: { storage: GummyPositions, access: 'mutable' },
})
export const gummyTetLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParameters },
  positions: { storage: GummyPositions, access: 'mutable' },
  tets: { storage: d.arrayOf(GummyTet) },
  multipliers: { storage: d.arrayOf(GummyTetLambda), access: 'mutable' },
})
export const gummyInterfaceLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParameters },
  positions: { storage: GummyPositions, access: 'mutable' },
  interfaces: { storage: d.arrayOf(GummyInterface) },
  damage: { storage: GummyDamage, access: 'mutable' },
  multipliers: { storage: GummyPositions, access: 'mutable' },
})
export const gummyBatchLayout = tgpu.bindGroupLayout({
  range: { uniform: d.vec4u },
  order: { storage: d.arrayOf(d.u32) },
})

const TetProjection = d.struct({
  p0: d.vec4f,
  p1: d.vec4f,
  p2: d.vec4f,
  p3: d.vec4f,
  a: d.vec4f,
  b: d.vec4f,
})

/** Rotation-invariant XPBD distance constraint; xyz is the mass-unscaled correction. */
export const gummyEdgeProjection = (
  a: d.v4f,
  b: d.v4f,
  rest: number,
  lambda: number,
  alpha: number,
) => {
  'use gpu'
  const delta = std.sub(a.xyz, b.xyz)
  const length = std.length(delta)
  const denominator = a.w + b.w + alpha
  if (length < 0.0000001 || denominator < 0.0000001)
    return d.vec4f(0, 0, 0, lambda)
  const increment = (rest - length - alpha * lambda) / denominator
  return d.vec4f(std.mul(delta, increment / length), lambda + increment)
}

export const gummySignedVolume = (a: d.v3f, b: d.v3f, c: d.v3f, e: d.v3f) => {
  'use gpu'
  return std.dot(std.sub(b, a), std.cross(std.sub(c, a), std.sub(e, a))) / 6
}

/** Six elastic edge strains and signed volume; this is not a Neo-Hookean FEM energy. */
export const solveGummyTet = (
  p0: d.v4f,
  p1: d.v4f,
  p2: d.v4f,
  p3: d.v4f,
  restA: d.v4f,
  restB: d.v4f,
  lambdaA: d.v4f,
  lambdaB: d.v4f,
  stretchAlpha: number,
  volumeAlpha: number,
) => {
  'use gpu'
  const p = d.arrayOf(
    d.vec4f,
    4,
  )([d.vec4f(p0), d.vec4f(p1), d.vec4f(p2), d.vec4f(p3)])
  const lengths = d.arrayOf(
    d.f32,
    6,
  )([restA.x, restA.y, restA.z, restA.w, restB.x, restB.y])
  const lambda = d.arrayOf(
    d.f32,
    7,
  )([
    lambdaA.x,
    lambdaA.y,
    lambdaA.z,
    lambdaA.w,
    lambdaB.x,
    lambdaB.y,
    lambdaB.z,
  ])
  const edgePairs = d.arrayOf(
    d.vec2u,
    6,
  )([
    d.vec2u(0, 1),
    d.vec2u(0, 2),
    d.vec2u(0, 3),
    d.vec2u(1, 2),
    d.vec2u(1, 3),
    d.vec2u(2, 3),
  ])
  for (const edge of std.range(6)) {
    const pair = edgePairs[edge]!
    const q = gummyEdgeProjection(
      p[pair.x]!,
      p[pair.y]!,
      lengths[edge]!,
      lambda[edge]!,
      stretchAlpha,
    )
    p[pair.x] = d.vec4f(
      std.add(p[pair.x]!.xyz, std.mul(q.xyz, p[pair.x]!.w)),
      p[pair.x]!.w,
    )
    p[pair.y] = d.vec4f(
      std.sub(p[pair.y]!.xyz, std.mul(q.xyz, p[pair.y]!.w)),
      p[pair.y]!.w,
    )
    lambda[edge] = q.w
  }
  // C=V/Vrest-1 retains its sign through inversion. Gradients sum to zero.
  const e1 = std.sub(p[1]!.xyz, p[0]!.xyz)
  const e2 = std.sub(p[2]!.xyz, p[0]!.xyz)
  const e3 = std.sub(p[3]!.xyz, p[0]!.xyz)
  const scale = 1 / (6 * restB.z)
  const g1 = std.mul(std.cross(e2, e3), scale)
  const g2 = std.mul(std.cross(e3, e1), scale)
  const g3 = std.mul(std.cross(e1, e2), scale)
  const g0 = std.mul(std.add(std.add(g1, g2), g3), -1)
  const denominator =
    p[0]!.w * std.dot(g0, g0) +
    p[1]!.w * std.dot(g1, g1) +
    p[2]!.w * std.dot(g2, g2) +
    p[3]!.w * std.dot(g3, g3) +
    volumeAlpha
  if (denominator > 0.0000001) {
    const c = std.dot(e1, std.cross(e2, e3)) * scale - 1
    const increment = (-c - volumeAlpha * lambda[6]!) / denominator
    p[0] = d.vec4f(
      std.add(p[0]!.xyz, std.mul(g0, increment * p[0]!.w)),
      p[0]!.w,
    )
    p[1] = d.vec4f(
      std.add(p[1]!.xyz, std.mul(g1, increment * p[1]!.w)),
      p[1]!.w,
    )
    p[2] = d.vec4f(
      std.add(p[2]!.xyz, std.mul(g2, increment * p[2]!.w)),
      p[2]!.w,
    )
    p[3] = d.vec4f(
      std.add(p[3]!.xyz, std.mul(g3, increment * p[3]!.w)),
      p[3]!.w,
    )
    lambda[6] = lambda[6]! + increment
  }
  return TetProjection({
    p0: p[0]!,
    p1: p[1]!,
    p2: p[2]!,
    p3: p[3]!,
    a: d.vec4f(lambda[0]!, lambda[1]!, lambda[2]!, lambda[3]!),
    b: d.vec4f(lambda[4]!, lambda[5]!, lambda[6]!, 0),
  })
}

/** Rate-dependent opening damage for this study; irreversible and not material-calibrated. */
export const gummyOpeningDamage = (
  previous: number,
  opening: number,
  dt: number,
  enabled: number,
  onset: number,
  failure: number,
  rate: number,
) => {
  'use gpu'
  if (previous >= 1 || enabled < 0.5) return previous
  if (opening >= failure) return d.f32(1)
  const drive = std.max(0, opening / onset - 1)
  return std.min(1, previous + dt * rate * drive)
}

/** Study-unit cohesive traction: normalized masses and redundant face bonds are not SI forces. */
export const GUMMY_COHESIVE_YIELD = 1400
export const gummyScaledTractionDamage = (
  previous: number,
  opening: number,
  force: number,
  dt: number,
  enabled: number,
  onset: number,
  failure: number,
  rate: number,
  strengthScale: number,
) => {
  'use gpu'
  const opened = gummyOpeningDamage(
    previous,
    opening,
    dt,
    enabled,
    onset,
    failure,
    rate,
  )
  if (opened >= 1 || enabled < 0.5) return opened
  // A closed XPBD seam carries load in its multiplier; weakening lowers its remaining strength.
  const strength =
    GUMMY_COHESIVE_YIELD * strengthScale * std.max(0.15, 1 - previous)
  const drive = std.max(0, force / strength - 1)
  return std.min(1, opened + dt * 1.2 * drive)
}

/** Compatibility entry point retains the arm-pull study calibration. */
export const gummyTractionDamage = (
  previous: number,
  opening: number,
  force: number,
  dt: number,
  enabled: number,
  onset: number,
  failure: number,
  rate: number,
) => {
  'use gpu'
  return gummyScaledTractionDamage(
    previous,
    opening,
    force,
    dt,
    enabled,
    onset,
    failure,
    rate,
    1,
  )
}

/** Compression is excluded while tangential sliding still contributes to the fine-study law. */
export const gummyTensionShear = (value: d.v3f, normal: d.v3f) => {
  'use gpu'
  const signed = std.dot(value, normal)
  const tangent = std.sub(value, std.mul(normal, signed))
  const tension = std.max(0, signed)
  return std.sqrt(tension * tension + std.dot(tangent, tangent))
}

/** Point-node plane contact beneath a finite square press; the old floor is unchanged. */
export const gummyPressContact = (position: d.v3f, press: d.v4f) => {
  'use gpu'
  const p = d.vec3f(position)
  if (press.z > 0.5 && std.abs(p.x) <= press.y && std.abs(p.z) <= press.y)
    p.y = std.min(p.y, press.x)
  p.y = std.max(p.y, 0.006)
  return d.vec3f(p)
}

export const gummyCaptureGrip = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  if (id >= gummyNodeLayout.$.params.counts.x) return
  const p = gummyNodeLayout.$.positions[id]!
  const center = gummyNodeLayout.$.params.gripCenter
  const offset = std.sub(p.xyz, center.xyz)
  const t = std.clamp(1 - std.length(offset) / std.max(center.w, 0.001), 0, 1)
  let weight = t * t * (3 - 2 * t)
  if (p.w <= 0) weight = d.f32(0)
  gummyNodeLayout.$.grip[id] = d.vec4f(offset, weight)
})

export const gummyPredict = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  if (id >= gummyNodeLayout.$.params.counts.x) return
  const p = gummyNodeLayout.$.positions[id]!
  gummyNodeLayout.$.previous[id] = d.vec4f(p)
  if (p.w <= 0) return
  const dt = gummyNodeLayout.$.params.material.x
  const v = std.mul(
    std.add(gummyNodeLayout.$.velocities[id]!.xyz, d.vec3f(0, -9.81 * dt, 0)),
    std.exp(-gummyNodeLayout.$.params.material.w * dt),
  )
  const next = std.add(p.xyz, std.mul(v, dt))
  gummyNodeLayout.$.positions[id] = d.vec4f(
    next.x,
    std.max(next.y, 0.006),
    next.z,
    p.w,
  )
})

export const gummyGripAndFloor = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  if (id >= gummyNodeLayout.$.params.counts.x) return
  const p = gummyNodeLayout.$.positions[id]!
  if (p.w <= 0) return
  let next = d.vec3f(p.xyz)
  const target = gummyNodeLayout.$.params.gripTarget
  const grip = gummyNodeLayout.$.grip[id]!
  if (target.w > 0.5 && grip.w > 0) {
    const delta = std.sub(std.add(target.xyz, grip.xyz), p.xyz)
    const length = std.length(delta)
    const fraction = std.min(0.22 * grip.w, 0.018 / std.max(length, 0.000001))
    next = std.add(next, std.mul(delta, fraction))
  }
  next = gummyPressContact(next, gummyNodeLayout.$.params.press)
  gummyNodeLayout.$.positions[id] = d.vec4f(next, p.w)
})

export const gummyFinish = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  if (id >= gummyNodeLayout.$.params.counts.x) return
  const p = gummyNodeLayout.$.positions[id]!
  const dt = gummyNodeLayout.$.params.material.x
  let velocity = std.div(
    std.sub(p.xyz, gummyNodeLayout.$.previous[id]!.xyz),
    dt,
  )
  if (p.w <= 0) velocity = d.vec3f(0)
  if (p.y <= 0.0061) {
    velocity.y = std.max(0, velocity.y)
    velocity.x *= 0.82
    velocity.z *= 0.82
  }
  const press = gummyNodeLayout.$.params.press
  if (
    press.z > 0.5 &&
    std.abs(p.x) <= press.y &&
    std.abs(p.z) <= press.y &&
    p.y >= press.x - 0.0001
  ) {
    velocity.y = std.min(velocity.y, press.w)
    velocity.x *= 0.85
    velocity.z *= 0.85
  }
  const speed = std.length(velocity)
  velocity = std.mul(velocity, std.min(1, 6 / std.max(speed, 0.000001)))
  gummyNodeLayout.$.velocities[id] = d.vec4f(velocity, 0)
})

export const gummySolveTets = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyBatchLayout.$.range.y) return
  const id = gummyBatchLayout.$.order[gummyBatchLayout.$.range.x + gid.x]!
  const tet = gummyTetLayout.$.tets[id]!
  const lambda = gummyTetLayout.$.multipliers[id]!
  const material = gummyTetLayout.$.params.material
  const dt2 = material.x * material.x
  const result = solveGummyTet(
    gummyTetLayout.$.positions[tet.ids.x]!,
    gummyTetLayout.$.positions[tet.ids.y]!,
    gummyTetLayout.$.positions[tet.ids.z]!,
    gummyTetLayout.$.positions[tet.ids.w]!,
    tet.lengthsA,
    tet.lengthsB,
    lambda.a,
    lambda.b,
    material.y / dt2,
    material.z / dt2,
  )
  gummyTetLayout.$.positions[tet.ids.x] = d.vec4f(result.p0)
  gummyTetLayout.$.positions[tet.ids.y] = d.vec4f(result.p1)
  gummyTetLayout.$.positions[tet.ids.z] = d.vec4f(result.p2)
  gummyTetLayout.$.positions[tet.ids.w] = d.vec4f(result.p3)
  gummyTetLayout.$.multipliers[id] = GummyTetLambda({
    a: result.a,
    b: result.b,
  })
})

export const gummyUpdateDamage = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  if (id >= gummyInterfaceLayout.$.params.counts.z) return
  const face = gummyInterfaceLayout.$.interfaces[id]!
  const p = gummyInterfaceLayout.$.positions
  let opening = std.max(
    std.distance(p[face.a.x]!.xyz, p[face.a.y]!.xyz),
    std.max(
      std.distance(p[face.a.z]!.xyz, p[face.a.w]!.xyz),
      std.distance(p[face.b.x]!.xyz, p[face.b.y]!.xyz),
    ),
  )
  const dt = gummyInterfaceLayout.$.params.material.x
  const multipliers = gummyInterfaceLayout.$.multipliers
  let force =
    std.max(
      std.length(multipliers[id * 3]!.xyz),
      std.max(
        std.length(multipliers[id * 3 + 1]!.xyz),
        std.length(multipliers[id * 3 + 2]!.xyz),
      ),
    ) /
    (dt * dt)
  if (gummyInterfaceLayout.$.params.controls.y > 0.5) {
    const faceNormal = std.cross(
      std.sub(p[face.a.z]!.xyz, p[face.a.x]!.xyz),
      std.sub(p[face.b.x]!.xyz, p[face.a.x]!.xyz),
    )
    const normal = std.div(
      faceNormal,
      std.max(std.length(faceNormal), 0.000000001),
    )
    opening = std.max(
      gummyTensionShear(std.sub(p[face.a.y]!.xyz, p[face.a.x]!.xyz), normal),
      std.max(
        gummyTensionShear(std.sub(p[face.a.w]!.xyz, p[face.a.z]!.xyz), normal),
        gummyTensionShear(std.sub(p[face.b.y]!.xyz, p[face.b.x]!.xyz), normal),
      ),
    )
    force =
      std.max(
        gummyTensionShear(multipliers[id * 3]!.xyz, normal),
        std.max(
          gummyTensionShear(multipliers[id * 3 + 1]!.xyz, normal),
          gummyTensionShear(multipliers[id * 3 + 2]!.xyz, normal),
        ),
      ) /
      (dt * dt)
  }
  const f = gummyInterfaceLayout.$.params.fracture
  gummyInterfaceLayout.$.damage[id] = gummyScaledTractionDamage(
    gummyInterfaceLayout.$.damage[id]!,
    opening,
    force,
    dt,
    f.x,
    f.y,
    f.z,
    f.w,
    gummyInterfaceLayout.$.params.controls.x,
  )
})

export const gummySolveInterfaces = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyBatchLayout.$.range.y) return
  const id = gummyBatchLayout.$.order[gummyBatchLayout.$.range.x + gid.x]!
  const damage = gummyInterfaceLayout.$.damage[id]!
  if (damage >= 1) return
  const face = gummyInterfaceLayout.$.interfaces[id]!
  const ids = d.arrayOf(
    d.vec2u,
    3,
  )([
    d.vec2u(face.a.x, face.a.y),
    d.vec2u(face.a.z, face.a.w),
    d.vec2u(face.b.x, face.b.y),
  ])
  const dt = gummyInterfaceLayout.$.params.material.x
  const alpha = (0.0000003 + 0.000035 * damage * damage) / (dt * dt)
  for (const pair of std.range(3)) {
    const index = id * 3 + d.u32(pair)
    const a = gummyInterfaceLayout.$.positions[ids[pair]!.x]!
    const b = gummyInterfaceLayout.$.positions[ids[pair]!.y]!
    const old = gummyInterfaceLayout.$.multipliers[index]!
    const increment = std.div(
      std.sub(std.sub(b.xyz, a.xyz), std.mul(old.xyz, alpha)),
      std.max(a.w + b.w + alpha, 0.0000001),
    )
    gummyInterfaceLayout.$.positions[ids[pair]!.x] = d.vec4f(
      std.add(a.xyz, std.mul(increment, a.w)),
      a.w,
    )
    gummyInterfaceLayout.$.positions[ids[pair]!.y] = d.vec4f(
      std.sub(b.xyz, std.mul(increment, b.w)),
      b.w,
    )
    gummyInterfaceLayout.$.multipliers[index] = d.vec4f(
      std.add(old.xyz, increment),
      0,
    )
  }
})
