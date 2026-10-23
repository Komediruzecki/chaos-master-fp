/** GPU XPBD entrypoints for elastic tetrahedra, cohesive interfaces, and interaction. */
import { d, std, tgpu } from 'typegpu'
import { gummyBatchLayout, gummyInterfaceLayout, gummyNodeLayout, GummyTetLambda, gummyTetLayout, } from './gummySolverLayouts'
import { gummyPressContact, gummyScaledTractionDamage, gummyTensionShear, solveGummyTet, } from './gummySolverProjection'

export * from './gummySolverLayouts'
export * from './gummySolverProjection'

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

/** Preserve the original contact retention per 1/120 second under temporal refinement. */
export const gummyContactRetention = (retention: number, dt: number) => {
  'use gpu'
  return std.pow(retention, dt * d.f32(120))
}

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
    const retention = gummyContactRetention(0.82, dt)
    velocity.x *= retention
    velocity.z *= retention
  }
  const press = gummyNodeLayout.$.params.press
  if (
    press.z > 0.5 &&
    std.abs(p.x) <= press.y &&
    std.abs(p.z) <= press.y &&
    p.y >= press.x - 0.0001
  ) {
    velocity.y = std.min(velocity.y, press.w)
    const retention = gummyContactRetention(0.85, dt)
    velocity.x *= retention
    velocity.z *= retention
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
