/** Actual material proximity gates equal/opposite contact between two independently transferred MPM grids. */
import { d, std, tgpu } from 'typegpu'
import { gummyPairContactImpulse, gummyPairSweptContact, } from './gummyParticlePairMath'
import { GummyParticleGrid, GummyParticleState } from './gummyParticleShaders'

export const GummyParticlePairParameters = d.struct({
  /** Microstep, grid spacing, particle diameter, friction. */
  geometry: d.vec4f,
  origin: d.vec4f,
  /** A particle count, B particle count, grid width, node count. */
  counts: d.vec4u,
})
export const gummyPairProximityLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParticlePairParameters },
  positionsA: { storage: d.arrayOf(d.vec4f) },
  positionsB: { storage: d.arrayOf(d.vec4f) },
  velocitiesA: { storage: d.arrayOf(d.vec4f) },
  velocitiesB: { storage: d.arrayOf(d.vec4f) },
  statesA: { storage: d.arrayOf(GummyParticleState), access: 'mutable' },
  statesB: { storage: d.arrayOf(GummyParticleState) },
  gridB: { storage: d.arrayOf(GummyParticleGrid), access: 'mutable' },
})

/** Only contact detection reads across bodies; all constitutive and APIC transfers remain independent. */
export const gummyParticlePairProximity = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = gummyPairProximityLayout.$.params
  if (gid.x >= params.counts.x) return
  const point = gummyPairProximityLayout.$.positionsA[gid.x]!.xyz
  const velocity = gummyPairProximityLayout.$.velocitiesA[gid.x]!.xyz
  const base = d.vec3i(
    std.floor(
      std.sub(
        std.div(std.sub(point, params.origin.xyz), params.geometry.y),
        d.vec3f(0.5),
      ),
    ),
  )
  const n = d.i32(params.counts.z)
  let best = d.vec4f(0, 0, 0, 1000000)
  for (const z of std.range(-1, 2))
    for (const y of std.range(-1, 2))
      for (const x of std.range(-1, 2)) {
        const cell = std.add(base, d.vec3i(x, y, z))
        if (
          cell.x < 0 ||
          cell.y < 0 ||
          cell.z < 0 ||
          cell.x >= n ||
          cell.y >= n ||
          cell.z >= n
        )
          continue
        const index = d.u32(cell.x + n * (cell.y + n * cell.z))
        let link = std.atomicLoad(gummyPairProximityLayout.$.gridB[index]!.head)
        while (link > 0) {
          const id = link - 1
          const contact = gummyPairSweptContact(
            std.sub(gummyPairProximityLayout.$.positionsB[id]!.xyz, point),
            std.sub(gummyPairProximityLayout.$.velocitiesB[id]!.xyz, velocity),
            params.geometry.z,
            params.geometry.x,
          )
          if (contact.w < best.w) best = d.vec4f(contact)
          link = gummyPairProximityLayout.$.statesB[id]!.links.x
        }
      }
  gummyPairProximityLayout.$.statesA[gid.x]!.contact = d.vec4f(best)
})

export const gummyPairContactLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParticlePairParameters },
  gridA: { storage: d.arrayOf(GummyParticleGrid), access: 'mutable' },
  gridB: { storage: d.arrayOf(GummyParticleGrid), access: 'mutable' },
  velocitiesA: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  velocitiesB: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
})

/** One invocation owns both nodal velocities, so the reaction is exactly opposite without float atomics. */
export const gummyParticlePairContact = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = gummyPairContactLayout.$.params
  if (gid.x >= params.counts.w) return
  const nodeA = gummyPairContactLayout.$.gridA[gid.x]!
  const nodeB = gummyPairContactLayout.$.gridB[gid.x]!
  if (nodeA.mass <= 0 || nodeB.mass <= 0 || nodeA.contact.w <= 0) return
  const length = std.length(nodeA.contact.xyz)
  if (length <= 0.000001) return
  const normal = std.div(nodeA.contact.xyz, length)
  let inverseA = d.f32(0)
  let inverseB = d.f32(0)
  if (nodeA.pinned === 0) inverseA = 1 / nodeA.mass
  if (nodeB.pinned === 0) inverseB = 1 / nodeB.mass
  const previousA = gummyPairContactLayout.$.velocitiesA[gid.x]!
  const previousB = gummyPairContactLayout.$.velocitiesB[gid.x]!
  const impulse = gummyPairContactImpulse(
    previousA.xyz,
    previousB.xyz,
    inverseA,
    inverseB,
    normal,
    0,
    params.geometry.w,
  )
  const velocityA = std.sub(previousA.xyz, std.mul(impulse, inverseA))
  const velocityB = std.add(previousB.xyz, std.mul(impulse, inverseB))
  gummyPairContactLayout.$.velocitiesA[gid.x] = d.vec4f(
    velocityA,
    std.max(previousA.w, std.length(velocityA)),
  )
  gummyPairContactLayout.$.velocitiesB[gid.x] = d.vec4f(
    velocityB,
    std.max(previousB.w, std.length(velocityB)),
  )
})
