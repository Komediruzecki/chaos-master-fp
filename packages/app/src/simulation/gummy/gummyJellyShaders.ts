/** Coupled shear/volume XPBD for the stable Neo-Hookean energy; no pre-cut seams or material memory. */
import { d, std, tgpu } from 'typegpu'
import { gummyBatchLayout, GummyParameters, GummyPositions, GummyTetLambda, } from './gummySolverShaders'

export const GummyJellyTet = d.struct({
  ids: d.vec4u,
  b0: d.vec4f,
  b1: d.vec4f,
  b2: d.vec4f,
})
export const gummyJellyLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParameters },
  positions: { storage: GummyPositions, access: 'mutable' },
  tets: { storage: d.arrayOf(GummyJellyTet) },
  multipliers: { storage: d.arrayOf(GummyTetLambda), access: 'mutable' },
})
const JellyStrain = d.struct({
  shear: d.f32,
  volume: d.f32,
  s0: d.vec3f,
  s1: d.vec3f,
  s2: d.vec3f,
  s3: d.vec3f,
  h0: d.vec3f,
  h1: d.vec3f,
  h2: d.vec3f,
  h3: d.vec3f,
})
const JellyProjection = d.struct({
  p0: d.vec4f,
  p1: d.vec4f,
  p2: d.vec4f,
  p3: d.vec4f,
  lambda: d.vec2f,
})

/** F = Ds Dm^-1, with b0..b2 the gradients of the three non-anchor shape functions. */
export const gummyJellyStrain = (
  p0: d.v3f,
  p1: d.v3f,
  p2: d.v3f,
  p3: d.v3f,
  b0: d.v3f,
  b1: d.v3f,
  b2: d.v3f,
) => {
  'use gpu'
  const e0 = std.sub(p1, p0)
  const e1 = std.sub(p2, p0)
  const e2 = std.sub(p3, p0)
  const f0 = std.add(
    std.add(std.mul(e0, b0.x), std.mul(e1, b1.x)),
    std.mul(e2, b2.x),
  )
  const f1 = std.add(
    std.add(std.mul(e0, b0.y), std.mul(e1, b1.y)),
    std.mul(e2, b2.y),
  )
  const f2 = std.add(
    std.add(std.mul(e0, b0.z), std.mul(e1, b1.z)),
    std.mul(e2, b2.z),
  )
  const norm = std.sqrt(std.dot(f0, f0) + std.dot(f1, f1) + std.dot(f2, f2))
  const inverseNorm = 1 / std.max(norm, 0.00000001)
  const co0 = std.cross(f1, f2)
  const co1 = std.cross(f2, f0)
  const co2 = std.cross(f0, f1)
  const s1 = std.mul(
    std.add(std.add(std.mul(f0, b0.x), std.mul(f1, b0.y)), std.mul(f2, b0.z)),
    inverseNorm,
  )
  const s2 = std.mul(
    std.add(std.add(std.mul(f0, b1.x), std.mul(f1, b1.y)), std.mul(f2, b1.z)),
    inverseNorm,
  )
  const s3 = std.mul(
    std.add(std.add(std.mul(f0, b2.x), std.mul(f1, b2.y)), std.mul(f2, b2.z)),
    inverseNorm,
  )
  const h1 = std.add(
    std.add(std.mul(co0, b0.x), std.mul(co1, b0.y)),
    std.mul(co2, b0.z),
  )
  const h2 = std.add(
    std.add(std.mul(co0, b1.x), std.mul(co1, b1.y)),
    std.mul(co2, b1.z),
  )
  const h3 = std.add(
    std.add(std.mul(co0, b2.x), std.mul(co1, b2.y)),
    std.mul(co2, b2.z),
  )
  return JellyStrain({
    shear: norm,
    volume: std.dot(f0, co0),
    s0: std.mul(std.add(std.add(s1, s2), s3), -1),
    s1,
    s2,
    s3,
    h0: std.mul(std.add(std.add(h1, h2), h3), -1),
    h1,
    h2,
    h3,
  })
}

/** A 2x2 block balances deviatoric pre-stress against pressure, including in an undeformed element. */
export const solveGummyJellyTet = (
  p0: d.v4f,
  p1: d.v4f,
  p2: d.v4f,
  p3: d.v4f,
  b0: d.v3f,
  b1: d.v3f,
  b2: d.v3f,
  lambda: d.v2f,
  shearAlpha: number,
  bulkAlpha: number,
) => {
  'use gpu'
  const strain = gummyJellyStrain(p0.xyz, p1.xyz, p2.xyz, p3.xyz, b0, b1, b2)
  const s = d.arrayOf(d.vec3f, 4)([strain.s0, strain.s1, strain.s2, strain.s3])
  const h = d.arrayOf(d.vec3f, 4)([strain.h0, strain.h1, strain.h2, strain.h3])
  const p = d.arrayOf(
    d.vec4f,
    4,
  )([d.vec4f(p0), d.vec4f(p1), d.vec4f(p2), d.vec4f(p3)])
  let ss = d.f32(0)
  let sh = d.f32(0)
  let hh = d.f32(0)
  for (const i of std.range(4)) {
    ss += p[i]!.w * std.dot(s[i]!, s[i]!)
    sh += p[i]!.w * std.dot(s[i]!, h[i]!)
    hh += p[i]!.w * std.dot(h[i]!, h[i]!)
  }
  // Stable NH: mu/2*(||F||²-3) + lambda/2*(J-1-mu/lambda)².
  const restShift = bulkAlpha / std.max(shearAlpha, 0.000000000001)
  const rhsS = -strain.shear - shearAlpha * lambda.x
  const rhsH = -(strain.volume - 1 - restShift) - bulkAlpha * lambda.y
  // Expanded determinant avoids cancellation when the two gradients are nearly parallel at rest.
  const determinant =
    std.max(0, ss * hh - sh * sh) +
    ss * bulkAlpha +
    hh * shearAlpha +
    shearAlpha * bulkAlpha
  let ds = d.f32(0)
  let dh = d.f32(0)
  if (determinant > 0.000000000001) {
    ds = (rhsS * (hh + bulkAlpha) - rhsH * sh) / determinant
    dh = (rhsH * (ss + shearAlpha) - rhsS * sh) / determinant
  }
  for (const i of std.range(4))
    p[i] = d.vec4f(
      std.add(
        p[i]!.xyz,
        std.mul(std.add(std.mul(s[i]!, ds), std.mul(h[i]!, dh)), p[i]!.w),
      ),
      p[i]!.w,
    )
  return JellyProjection({
    p0: p[0]!,
    p1: p[1]!,
    p2: p[2]!,
    p3: p[3]!,
    lambda: d.vec2f(lambda.x + ds, lambda.y + dh),
  })
}

export const gummySolveJellyTets = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x >= gummyBatchLayout.$.range.y) return
  const id = gummyBatchLayout.$.order[gummyBatchLayout.$.range.x + gid.x]!
  const tet = gummyJellyLayout.$.tets[id]!
  const material = gummyJellyLayout.$.params.material
  const scale = 1 / (material.x * material.x * tet.b0.w)
  const result = solveGummyJellyTet(
    gummyJellyLayout.$.positions[tet.ids.x]!,
    gummyJellyLayout.$.positions[tet.ids.y]!,
    gummyJellyLayout.$.positions[tet.ids.z]!,
    gummyJellyLayout.$.positions[tet.ids.w]!,
    tet.b0.xyz,
    tet.b1.xyz,
    tet.b2.xyz,
    gummyJellyLayout.$.multipliers[id]!.a.xy,
    material.y * scale,
    material.z * scale,
  )
  gummyJellyLayout.$.positions[tet.ids.x] = d.vec4f(result.p0)
  gummyJellyLayout.$.positions[tet.ids.y] = d.vec4f(result.p1)
  gummyJellyLayout.$.positions[tet.ids.z] = d.vec4f(result.p2)
  gummyJellyLayout.$.positions[tet.ids.w] = d.vec4f(result.p3)
  gummyJellyLayout.$.multipliers[id] = GummyTetLambda({
    a: d.vec4f(result.lambda, 0, 0),
    b: d.vec4f(),
  })
})
