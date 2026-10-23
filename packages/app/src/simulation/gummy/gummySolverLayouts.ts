/** XPBD storage schemas and bind-group layouts shared by solver kernels. */
import { d, tgpu } from 'typegpu'

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
